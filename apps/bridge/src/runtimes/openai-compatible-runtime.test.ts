import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { BridgeRunStreamEvent } from "@surf-ai/shared";
import { BridgeStore } from "../core/store";
import { OpenAICompatibleRuntime } from "./openai-compatible-runtime";
import type { FetchLike } from "../core/openai-compatible-client";

test("OpenAICompatibleRuntime publishes ordered assistant stream events", async () => {
  await usingFixture(async ({ store, run, sessionId, userMessageId }) => {
    const events: BridgeRunStreamEvent[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      assert.equal(body.messages.at(-1)?.content, "Hello OpenAI");
      return new Response(
        sseStream([
          { choices: [{ delta: { content: "Runtime " } }] },
          { choices: [{ delta: { content: "answer" } }] },
          "[DONE]"
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    };

    const runtime = new OpenAICompatibleRuntime(
      store,
      { publish: (event) => events.push(event) },
      {
        baseUrl: "https://example.test/v1",
        apiKey: "sk-test-secret-123456",
        defaultModel: "gpt-default",
        timeoutMs: 10_000
      },
      { fetchImpl }
    );

    const result = await runtime.run({
      userId: "local",
      sessionId,
      runId: run.id,
      adapter: "openai-compatible",
      model: "gpt-test",
      content: "Hello OpenAI"
    });

    assert.equal(result.threadId, `openai-compatible:${sessionId}`);
    assert.equal(result.turnId, run.id);
    assert.equal(result.output, "Runtime answer");
    assert.equal(run.userMessageId, userMessageId);
    assert.deepEqual(
      events.map((event) => event.type),
      ["run.started", "assistant.delta", "assistant.delta", "assistant.completed"]
    );
  });
});

async function usingFixture(
  fn: (fixture: {
    store: BridgeStore;
    sessionId: string;
    userMessageId: string;
    run: { id: string; userMessageId: string };
  }) => Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "surf-ai-openai-runtime-test-"));
  try {
    const store = new BridgeStore(join(dir, "test.sqlite"), [{ id: "local", name: "Local" }]);
    const session = store.createSession("local", "openai runtime test");
    const userMessage = store.appendMessage(
      "local",
      session.id,
      "user",
      "Hello OpenAI",
      "openai-compatible",
      "gpt-test"
    );
    const run = store.createSessionRun({
      userId: "local",
      sessionId: session.id,
      adapter: "openai-compatible",
      model: "gpt-test",
      status: "RUNNING",
      userMessageId: userMessage.id
    });
    await fn({ store, sessionId: session.id, userMessageId: userMessage.id, run });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function sseStream(items: Array<Record<string, unknown> | string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of items) {
        const data = typeof item === "string" ? item : JSON.stringify(item);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }
      controller.close();
    }
  });
}
