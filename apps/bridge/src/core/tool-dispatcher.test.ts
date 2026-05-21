import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { BridgeRunStreamEvent } from "@surf-ai/shared";
import { AdapterRegistry } from "./registry";
import { BridgeStore } from "./store";
import { SessionManager } from "./session-manager";
import { ToolDispatcher, ToolDispatchError } from "./tool-dispatcher";
import { ToolRegistry } from "./tool-registry";

test("ToolDispatcher rejects unknown and metadata-only tools", () => {
  usingFixture(({ dispatcher, session }) => {
    assert.throws(
      () =>
        dispatcher.dispatch({
          userId: "local",
          toolId: "missing.tool",
          sessionId: session.id,
          input: {}
        }),
      (error) => error instanceof ToolDispatchError && error.code === "tool_not_found"
    );

    assert.throws(
      () =>
        dispatcher.dispatch({
          userId: "local",
          toolId: "browser.page.extract_text",
          sessionId: session.id,
          input: {}
        }),
      (error) => error instanceof ToolDispatchError && error.code === "tool_not_callable"
    );
  });
});

test("ToolDispatcher validates input and session ownership", () => {
  usingFixture(({ dispatcher, session }) => {
    assert.throws(
      () =>
        dispatcher.dispatch({
          userId: "local",
          toolId: "session.context_preview",
          sessionId: session.id,
          input: {}
        }),
      (error) => error instanceof ToolDispatchError && error.code === "invalid_tool_input"
    );

    assert.throws(
      () =>
        dispatcher.dispatch({
          userId: "other",
          toolId: "session.context_preview",
          sessionId: session.id,
          input: { query: "SQLite" }
        }),
      (error) => error instanceof ToolDispatchError && error.code === "session_not_found"
    );
  });
});

test("ToolDispatcher executes read-only session search and persists run timeline events", () => {
  usingFixture(({ store, dispatcher, events, session, run }) => {
    const response = dispatcher.dispatch({
      userId: "local",
      toolId: "session.messages.search",
      sessionId: session.id,
      runId: run.id,
      input: { query: "SQLite decision", limit: 3 }
    });

    assert.equal(response.tool.id, "session.messages.search");
    assert.equal(response.result.ok, true);
    assert.equal(response.result.toolId, "session.messages.search");
    assert.equal(response.result.outputKind, "metadata");
    assert.equal(typeof response.result.metadata?.toolCallId, "string");
    assert.equal(response.events.length, 2);
    assert.deepEqual(
      response.events.map((event) => event.type),
      ["tool.started", "tool.output"]
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["tool.started", "tool.output"]
    );
    assert.equal(events[0]?.type, "tool.started");
    assert.equal(events[1]?.type, "tool.output");
    assert.equal(events[0]?.data.toolCallId, events[1]?.data.toolCallId);

    const content = response.result.content as { items?: Array<{ seq: number; snippet: string }> };
    assert.ok(content.items?.some((item) => item.snippet.includes("SQLite")));

    const replayed = store.listRunEvents("local", session.id, run.id, 10);
    assert.deepEqual(
      replayed.map((event) => event.type),
      ["tool.started", "tool.output"]
    );
  });
});

test("ToolDispatcher returns runtime timeline and requires run ownership", () => {
  usingFixture(({ dispatcher, session, run }) => {
    assert.throws(
      () =>
        dispatcher.dispatch({
          userId: "local",
          toolId: "runtime.event_timeline",
          sessionId: session.id,
          input: {}
        }),
      (error) => error instanceof ToolDispatchError && error.code === "run_id_required"
    );

    assert.throws(
      () =>
        dispatcher.dispatch({
          userId: "local",
          toolId: "runtime.event_timeline",
          sessionId: session.id,
          runId: run.id,
          input: { unexpected: true }
        }),
      (error) => error instanceof ToolDispatchError && error.code === "invalid_tool_input"
    );

    const response = dispatcher.dispatch({
      userId: "local",
      toolId: "runtime.event_timeline",
      sessionId: session.id,
      runId: run.id,
      input: {}
    });
    const content = response.result.content as {
      events?: BridgeRunStreamEvent[];
      approvals?: unknown[];
      artifacts?: unknown[];
    };

    assert.ok(Array.isArray(content.events));
    assert.ok(Array.isArray(content.approvals));
    assert.ok(Array.isArray(content.artifacts));
    const outputEvent = response.events.find((event) => event.type === "tool.output");
    assert.equal(outputEvent?.type, "tool.output");
    assert.deepEqual(outputEvent?.data.content, {
      eventCount: 1,
      approvalCount: 0,
      artifactCount: 0,
      redacted: true
    });
  });
});

function usingFixture(
  fn: (fixture: {
    store: BridgeStore;
    dispatcher: ToolDispatcher;
    events: BridgeRunStreamEvent[];
    session: { id: string };
    run: { id: string; sessionId: string };
  }) => void
): void {
  const dir = mkdtempSync(join(tmpdir(), "surf-ai-tool-dispatcher-test-"));
  try {
    const store = new BridgeStore(join(dir, "test.sqlite"), [
      { id: "local", name: "Local" },
      { id: "other", name: "Other" }
    ]);
    const registry = new AdapterRegistry();
    const sessionManager = new SessionManager(store, registry);
    const toolRegistry = new ToolRegistry({ minimaxTtsConfigured: true });
    const events: BridgeRunStreamEvent[] = [];
    const dispatcher = new ToolDispatcher({
      registry: toolRegistry,
      store,
      sessionManager,
      eventSink: {
        publish(event) {
          events.push(event);
        }
      }
    });
    const session = store.createSession("local", "tool dispatcher test");
    store.appendMessage("local", session.id, "user", "Remember the SQLite decision.");
    store.appendMessage("local", session.id, "assistant", "SQLite is the backend source of truth.");
    const userMessage = store.appendMessage("local", session.id, "user", "Search previous storage choices.");
    const run = store.createSessionRun({
      userId: "local",
      sessionId: session.id,
      adapter: "codex",
      status: "RUNNING",
      userMessageId: userMessage.id
    });

    fn({
      store,
      dispatcher,
      events,
      session: { id: session.id },
      run: { id: run.id, sessionId: run.sessionId }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
