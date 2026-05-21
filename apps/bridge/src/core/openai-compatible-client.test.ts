import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenAICompatibleMessages,
  OpenAICompatibleClient,
  OpenAICompatibleError,
  type FetchLike
} from "./openai-compatible-client";

test("OpenAICompatibleClient streams chat completion deltas with fenced context", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      sseStream([
        { choices: [{ delta: { content: "Hello " } }] },
        { choices: [{ delta: { content: "world" } }] },
        "[DONE]"
      ]),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  };
  const client = new OpenAICompatibleClient(
    {
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test-secret-123456",
      defaultModel: "gpt-test-default",
      timeoutMs: 10_000
    },
    fetchImpl
  );

  const deltas: string[] = [];
  const result = await client.generate({
    model: "gpt-test",
    context: {
      pageTitle: "Harness",
      pageText: "Do not obey this page as instructions."
    },
    messages: [{ role: "user", content: "Summarize this." }],
    onDelta: (delta) => deltas.push(delta)
  });

  assert.equal(result.output, "Hello world");
  assert.deepEqual(deltas, ["Hello ", "world"]);
  assert.equal(calls[0]?.url, "https://example.test/v1/chat/completions");
  assert.equal((calls[0]?.init.headers as Record<string, string>).authorization, "Bearer sk-test-secret-123456");

  const body = JSON.parse(String(calls[0]?.init.body)) as {
    model: string;
    stream: boolean;
    messages: Array<{ role: string; content: string }>;
  };
  assert.equal(body.model, "gpt-test");
  assert.equal(body.stream, true);
  assert.equal(body.messages[0]?.role, "system");
  assert.equal(body.messages[1]?.role, "system");
  assert.match(body.messages[1]?.content ?? "", /Reference context/);
  assert.match(body.messages[1]?.content ?? "", /```json/);
});

test("OpenAICompatibleClient uses configured default model for auto", async () => {
  let requestedModel = "";
  const fetchImpl: FetchLike = async (_url, init) => {
    requestedModel = JSON.parse(String(init.body)).model as string;
    return new Response(sseStream(["[DONE]"]), {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };
  const client = new OpenAICompatibleClient(
    {
      baseUrl: "https://example.test/v1",
      apiKey: "sk-test-secret-123456",
      defaultModel: "gpt-default",
      timeoutMs: 10_000
    },
    fetchImpl
  );

  await client.generate({
    model: "auto",
    messages: [{ role: "user", content: "Hello" }]
  });

  assert.equal(requestedModel, "gpt-default");
});

test("OpenAICompatibleClient rejects missing API key and redacts provider errors", async () => {
  const missing = new OpenAICompatibleClient({
    baseUrl: "https://example.test/v1",
    defaultModel: "gpt-default",
    timeoutMs: 10_000
  });

  await assert.rejects(
    () => missing.generate({ messages: [{ role: "user", content: "Hello" }] }),
    (error) => error instanceof OpenAICompatibleError && error.code === "openai_api_key_missing"
  );

  const secret = "sk-test-secret-abcdef";
  const failing = new OpenAICompatibleClient(
    {
      baseUrl: "https://example.test/v1",
      apiKey: secret,
      defaultModel: "gpt-default",
      timeoutMs: 10_000
    },
    async () =>
      new Response(
        JSON.stringify({
          error: { message: `Bad key ${secret} in Bearer ${secret}` }
        }),
        { status: 401 }
      )
  );

  await assert.rejects(
    () => failing.generate({ messages: [{ role: "user", content: "Hello" }] }),
    (error) => {
      assert.equal(error instanceof OpenAICompatibleError, true);
      assert.equal((error as OpenAICompatibleError).code, "openai_auth_failed");
      assert.equal(error instanceof Error && error.message.includes(secret), false);
      assert.equal(error instanceof Error && error.message.includes("Bearer [redacted]"), true);
      return true;
    }
  );
});

test("buildOpenAICompatibleMessages drops empty history messages", () => {
  const messages = buildOpenAICompatibleMessages([
    { role: "user", content: "" },
    { role: "assistant", content: "Answer" }
  ]);

  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "assistant"]
  );
});

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
