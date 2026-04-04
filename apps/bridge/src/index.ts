import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type {
  BridgeCapabilitiesResponse,
  BridgeChatRequest,
  BridgeChatResponse,
  BridgeHealthResponse,
  BridgeModelsResponse,
  BridgeTtsRequest,
  BridgeTtsResponse
} from "@surf-ai/shared";
import { readConfig } from "./core/config";
import { AdapterRegistry } from "./core/registry";
import { synthesizeWithMiniMax, TtsError } from "./tts/minimax";

const config = readConfig();
const registry = new AdapterRegistry();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (origin.startsWith("chrome-extension://") || origin.startsWith("http://localhost")) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed"), false);
  }
});

app.addHook("onRequest", async (request, reply) => {
  if (!config.token) {
    return;
  }

  const token = request.headers["x-surf-token"];
  if (token !== config.token) {
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.get("/health", async () => {
  const response: BridgeHealthResponse = {
    ok: true,
    version: "0.1.0",
    adapters: registry.listModels().map((model) => model.adapter),
    now: new Date().toISOString()
  };
  return response;
});

app.get("/models", async () => {
  const response: BridgeModelsResponse = { models: registry.listModels() };
  return response;
});

app.get("/capabilities", async () => {
  const response: BridgeCapabilitiesResponse = {
    version: "0.1.0",
    now: new Date().toISOString(),
    chat: {
      adapters: registry.listAdapterCapabilities(config.defaultAdapter),
      defaultAdapter: config.defaultAdapter,
      supportsModelOverride: false
    },
    tts: {
      minimax: {
        enabled: true,
        configured: Boolean(config.minimaxTts.apiKey)
      }
    }
  };
  return response;
});

const chatRequestSchema = z.object({
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"]),
  model: z.string().optional(),
  sessionId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["system", "user", "assistant"]),
      content: z.string().min(1)
    })
  ).min(1),
  context: z.object({
    pageTitle: z.string().optional(),
    pageUrl: z.string().optional(),
    selectedText: z.string().optional(),
    pageText: z.string().optional(),
    pageTextSource: z.enum(["readability", "dom"]).optional()
  }).optional()
});

app.post("/chat", async (request, reply) => {
  const parsed = chatRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  try {
    const requestPayload: BridgeChatRequest = {
      adapter: parsed.data.adapter,
      sessionId: parsed.data.sessionId,
      messages: parsed.data.messages,
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
      ...(parsed.data.context
        ? {
            context: {
              ...(parsed.data.context.pageTitle ? { pageTitle: parsed.data.context.pageTitle } : {}),
              ...(parsed.data.context.pageUrl ? { pageUrl: parsed.data.context.pageUrl } : {}),
              ...(parsed.data.context.selectedText ? { selectedText: parsed.data.context.selectedText } : {}),
              ...(parsed.data.context.pageText ? { pageText: parsed.data.context.pageText } : {}),
              ...(parsed.data.context.pageTextSource ? { pageTextSource: parsed.data.context.pageTextSource } : {})
            }
          }
        : {})
    };

    const output = await registry.generate(requestPayload, config.defaultAdapter);
    const response: BridgeChatResponse = { output };
    return response;
  } catch (error) {
    request.log.error(error);
    reply.code(500);
    return {
      error: "adapter_failed",
      message: error instanceof Error ? error.message : "unknown adapter error"
    };
  }
});

const ttsRequestSchema = z.object({
  text: z.string().min(1).max(5_000),
  voiceId: z.string().optional()
});

app.post("/tts", async (request, reply) => {
  const parsed = ttsRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  try {
    const ttsRequest: BridgeTtsRequest = {
      text: parsed.data.text,
      ...(parsed.data.voiceId ? { voiceId: parsed.data.voiceId } : {})
    };
    const response: BridgeTtsResponse = await synthesizeWithMiniMax(
      ttsRequest,
      config.minimaxTts
    );
    return response;
  } catch (error) {
    if (error instanceof TtsError) {
      request.log.warn(
        {
          code: error.code,
          statusCode: error.statusCode,
          details: error.details
        },
        "TTS request failed"
      );
      reply.code(error.statusCode);
      return {
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      };
    }

    request.log.error(error, "Unexpected TTS error");
    reply.code(500);
    return {
      error: "tts_internal_error",
      message: error instanceof Error ? error.message : "Unknown TTS error"
    };
  }
});

app.setErrorHandler((error, _request, reply) => {
  const message = error instanceof Error ? error.message : "unknown error";
  reply.code(500).send({ error: "internal_error", message });
});

await app.listen({ host: config.host, port: config.port });
app.log.info(`surf-ai bridge listening on http://${config.host}:${config.port}`);
