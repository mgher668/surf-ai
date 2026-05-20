import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMessage } from "@surf-ai/shared";
import { ContextEngine } from "./context-engine";
import { MemoryService } from "./memory-service";
import type { AdapterRegistry } from "./registry";
import { BridgeStore } from "./store";

test("ContextEngine builds compatibility handoff with memory, retrieval, and clipped page context", async () => {
  await usingFixture(async ({ store, memory, engine }) => {
    const session = store.createSession("local", "context engine handoff");
    store.upsertSessionMemory("local", {
      sessionId: session.id,
      kind: "facts",
      content: "Pinned fact: user prefers Chinese answers.",
      sourceSeqStart: 1,
      sourceSeqEnd: 1
    });
    store.upsertSessionMemory("local", {
      sessionId: session.id,
      kind: "todos",
      content: "Open todo: keep provider JSON compatible.",
      sourceSeqStart: 2,
      sourceSeqEnd: 2
    });

    const history: ChatMessage[] = [
      message(1, "user", "Please remember alpha decision: use SQLite for backend storage."),
      message(2, "assistant", "Alpha decision recorded: SQLite remains source of truth."),
      ...Array.from({ length: 21 }, (_, index) =>
        message(index + 3, index % 2 === 0 ? "user" : "assistant", `Unrelated short exchange ${index + 3}.`)
      ),
      message(24, "assistant", "Unrelated short exchange 24."),
      message(25, "user", "之前 alpha 决定是什么？")
    ];

    const handoff = await engine.buildHandoff({
      userId: "local",
      sessionId: session.id,
      summaryAdapter: "codex",
      fallbackAdapter: "mock",
      history,
      deltaMessages: [history[24]!],
      context: {
        pageTitle: "Example page",
        pageUrl: "https://example.test/page",
        selectedText: "s".repeat(4_010),
        pageText: "p".repeat(100_010),
        pageTextSource: "dom"
      }
    });

    assert.deepEqual(handoff.latest_user_request, {
      content: "之前 alpha 决定是什么？",
      truncated: false
    });
    assert.equal(handoff.delta_summary, undefined);
    assert.equal(handoff.pinned_facts, "Pinned fact: user prefers Chinese answers.");
    assert.equal(handoff.open_todos, "Open todo: keep provider JSON compatible.");
    assert.deepEqual(
      handoff.recent_verbatim.map((item) => item.seq),
      [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
    );
    assert.ok(handoff.retrieved_context, "older context should be retrieved for history cues");
    assert.ok(
      handoff.retrieved_context.items.some((item) => item.seq === 1 || item.seq === 2),
      "retrieval should include older alpha evidence outside recent window"
    );
    assert.deepEqual([...handoff.evidence_refs], [...new Set(handoff.evidence_refs)].sort((a, b) => a - b));
    assert.ok(handoff.evidence_refs.includes(25));
    assert.ok(handoff.page_context);
    assert.ok(handoff.page_context.selectedText);
    assert.ok(handoff.page_context.pageText);
    assert.equal(handoff.page_context.pageTitle, "Example page");
    assert.equal(handoff.page_context.pageUrl, "https://example.test/page");
    assert.equal(handoff.page_context.selectedText.content.length, 4_000);
    assert.equal(handoff.page_context.selectedText.truncated, true);
    assert.equal(handoff.page_context.pageText.content.length, 100_000);
    assert.equal(handoff.page_context.pageText.truncated, true);
    assert.equal(handoff.page_context.pageTextSource, "dom");

    assert.equal(memory.getSessionMemory("local", session.id, "summary"), null);
  });
});

test("ContextEngine reuses cached summary when it covers the delta range", async () => {
  await usingFixture(async ({ store, memory, engine }) => {
    const session = store.createSession("local", "context cached summary");
    memory.upsertSessionSummary({
      userId: "local",
      sessionId: session.id,
      content: "Cached summary: prior handoff already exists.",
      sourceSeqStart: 1,
      sourceSeqEnd: 8
    });

    const history = [
      message(1, "user", "one"),
      message(2, "assistant", "two"),
      message(3, "user", "three"),
      message(4, "assistant", "four")
    ];

    const handoff = await engine.buildHandoff({
      userId: "local",
      sessionId: session.id,
      summaryAdapter: "codex",
      fallbackAdapter: "mock",
      history,
      deltaMessages: history.slice(1, 3)
    });

    assert.deepEqual(handoff.delta_summary, {
      content: "Cached summary: prior handoff already exists.",
      source_seq_start: 1,
      source_seq_end: 8
    });
  });
});

test("ContextEngine generates and persists summary only after threshold", async () => {
  const registry = {
    async generate() {
      return "Generated compact summary.";
    }
  } as unknown as AdapterRegistry;

  await usingFixture(async ({ store, memory }) => {
    const session = store.createSession("local", "context generated summary");
    const engine = new ContextEngine(memory, registry);
    const history = Array.from({ length: 6 }, (_, index) =>
      message(index + 1, index % 2 === 0 ? "user" : "assistant", `message ${index + 1}`)
    );

    const handoff = await engine.buildHandoff({
      userId: "local",
      sessionId: session.id,
      summaryAdapter: "codex",
      fallbackAdapter: "mock",
      history,
      deltaMessages: history
    });

    assert.deepEqual(handoff.delta_summary, {
      content: "Generated compact summary.",
      source_seq_start: 1,
      source_seq_end: 6
    });
    assert.equal(
      memory.getSessionMemory("local", session.id, "summary")?.content,
      "Generated compact summary."
    );
  });
});

test("ContextEngine preview retrieves even when rule trigger is false", async () => {
  await usingFixture(async ({ engine }) => {
    const preview = engine.preview(
      [
        message(1, "user", "The project codename is Surf Runtime."),
        message(2, "assistant", "Recorded Surf Runtime as the codename.")
      ],
      "Surf Runtime"
    );

    assert.equal(preview.triggered, false);
    assert.equal(preview.query, "Surf Runtime");
    assert.ok(preview.queryTokens.length > 0);
    assert.ok(preview.items.length > 0);
    assert.equal(preview.items[0]?.snippet.includes("Surf Runtime"), true);

    const triggered = engine.preview([message(1, "user", "old decision")], "上次的结论是什么？");
    assert.equal(triggered.triggered, true);
  });
});

function message(seq: number, role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `msg-${seq}`,
    sessionId: "session-1",
    seq,
    role,
    content,
    createdAt: seq
  };
}

async function usingFixture(
  fn: (fixture: {
    store: BridgeStore;
    memory: MemoryService;
    engine: ContextEngine;
  }) => void | Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "surf-ai-context-engine-test-"));
  try {
    const store = new BridgeStore(join(dir, "test.sqlite"), [{ id: "local", name: "Local" }]);
    const memory = new MemoryService(store);
    const registry = {
      async generate() {
        throw new Error("unexpected_summary_generation");
      }
    } as unknown as AdapterRegistry;
    const engine = new ContextEngine(memory, registry);
    await fn({ store, memory, engine });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
