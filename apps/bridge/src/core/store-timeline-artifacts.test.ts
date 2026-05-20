import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { BridgeRunStreamEvent } from "@surf-ai/shared";
import { BridgeStore } from "./store";

test("BridgeStore persists run events in insertion order and ignores heartbeats/duplicates", () => {
  usingFixture(({ store, run }) => {
    const events = [
      makeEvent(run.sessionId, run.id, "event-1", 300, "assistant.delta", { delta: "first" }),
      makeEvent(run.sessionId, run.id, "event-2", 100, "assistant.delta", { delta: "second" }),
      makeEvent(run.sessionId, run.id, "event-3", 200, "error", { message: "third" }),
      makeEvent(run.sessionId, run.id, "event-2", 400, "assistant.delta", { delta: "duplicate" }),
      makeEvent(run.sessionId, run.id, "heartbeat-1", 500, "heartbeat", {})
    ];

    for (const event of events) {
      store.appendRunEvent("local", event);
    }

    const stored = store.listRunEvents("local", run.sessionId, run.id);
    assert.deepEqual(
      stored.map((event) => event.eventId),
      ["event-1", "event-2", "event-3"]
    );
    assert.deepEqual(
      stored.map((event) => event.ts),
      [300, 100, 200],
      "ordering must follow DB insertion sequence, not timestamps"
    );
  });
});

test("BridgeStore limits run event replay from the oldest side of the selected window", () => {
  usingFixture(({ store, run }) => {
    for (let index = 1; index <= 5; index += 1) {
      store.appendRunEvent(
        "local",
        makeEvent(run.sessionId, run.id, `event-${index}`, index, "assistant.delta", {
          delta: String(index)
        })
      );
    }

    assert.deepEqual(
      store.listRunEvents("local", run.sessionId, run.id, 2).map((event) => event.eventId),
      ["event-4", "event-5"]
    );
  });
});

test("BridgeStore creates owner-scoped artifacts and returns run artifact metadata", () => {
  usingFixture(({ store, run }) => {
    const artifact = store.createArtifact({
      userId: "local",
      sessionId: run.sessionId,
      runId: run.id,
      kind: "tool_output",
      mimeType: "text/plain",
      content: "tool output",
      metadata: { source: "test" }
    });

    assert.equal(artifact.byteSize, Buffer.byteLength("tool output", "utf8"));
    assert.equal(artifact.metadata?.source, "test");
    assert.equal(store.getArtifact("local", artifact.id)?.content, "tool output");
    assert.equal(store.getArtifact("other", artifact.id), null);
    assert.deepEqual(store.listArtifactsByRun("local", run.sessionId, run.id), [artifact]);
    assert.throws(
      () => store.listArtifactsByRun("other", run.sessionId, run.id),
      /session_not_found/
    );
  });
});

test("BridgeStore offloads large run event payloads into run_event_payload artifacts", () => {
  usingFixture(({ store, run }) => {
    const largeDelta = "x".repeat(40 * 1024);
    store.appendRunEvent(
      "local",
      makeEvent(run.sessionId, run.id, "event-large", 100, "assistant.delta", {
        delta: largeDelta,
        phase: "final_answer"
      })
    );

    const [event] = store.listRunEvents("local", run.sessionId, run.id, 2000, {
      hydrateArtifacts: false
    });
    assert.equal(event?.type, "assistant.delta");
    const data = event?.data as Record<string, unknown>;
    assert.equal(data.originalEventType, "assistant.delta");
    const artifactRef = data.artifactRef as Record<string, unknown>;
    assert.equal(artifactRef.kind, "run_event_payload");
    assert.equal(artifactRef.mimeType, "application/json");
    assert.equal(typeof artifactRef.artifactId, "string");

    const artifact = store.getArtifact("local", String(artifactRef.artifactId));
    assert.equal(artifact?.artifact.kind, "run_event_payload");
    assert.equal(artifact?.artifact.runId, run.id);
    assert.ok(artifact?.content.includes(largeDelta.slice(0, 128)));

    const [hydrated] = store.listRunEvents("local", run.sessionId, run.id);
    assert.equal((hydrated?.data as { delta?: string }).delta, largeDelta);
  });
});

function makeEvent<Type extends BridgeRunStreamEvent["type"]>(
  sessionId: string,
  runId: string,
  eventId: string,
  ts: number,
  type: Type,
  data: Extract<BridgeRunStreamEvent, { type: Type }>["data"]
): BridgeRunStreamEvent {
  return {
    eventId,
    sessionId,
    runId,
    type,
    ts,
    data
  } as Extract<BridgeRunStreamEvent, { type: Type }>;
}

function usingFixture(
  fn: (fixture: {
    store: BridgeStore;
    run: { id: string; sessionId: string };
  }) => void
): void {
  const dir = mkdtempSync(join(tmpdir(), "surf-ai-store-timeline-test-"));
  try {
    const store = new BridgeStore(join(dir, "test.sqlite"), [
      { id: "local", name: "Local" },
      { id: "other", name: "Other" }
    ]);
    const session = store.createSession("local", "timeline test");
    const otherSession = store.createSession("other", "other timeline test");
    const userMessage = store.appendMessage("local", session.id, "user", "Run timeline");
    store.appendMessage("other", otherSession.id, "user", "Other timeline");
    const run = store.createSessionRun({
      userId: "local",
      sessionId: session.id,
      adapter: "codex",
      status: "RUNNING",
      userMessageId: userMessage.id
    });
    fn({ store, run: { id: run.id, sessionId: session.id } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
