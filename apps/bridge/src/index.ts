import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import type {
  BridgeCapabilitiesResponse,
  BridgeChatRequest,
  BridgeChatResponse,
  BridgeSessionCreateResponse,
  BridgeHealthResponse,
  BridgeSessionListResponse,
  BridgeSessionMessagesResponse,
  BridgeSessionSendMessageResponse,
  BridgeSessionStarRequest,
  BridgeModelsResponse,
  BridgeTtsRequest,
  BridgeTtsResponse
} from "@surf-ai/shared";
import { readConfig } from "./core/config";
import { AdapterRegistry } from "./core/registry";
import { BridgeStore } from "./core/store";
import { SessionManager } from "./core/session-manager";
import { synthesizeWithMiniMax, TtsError } from "./tts/minimax";

const config = readConfig();
const registry = new AdapterRegistry();
const store = new BridgeStore(config.dbPath, config.users);
const sessionManager = new SessionManager(store, registry);

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

const chatContextSchema = z.object({
  pageTitle: z.string().optional(),
  pageUrl: z.string().optional(),
  selectedText: z.string().optional(),
  pageText: z.string().optional(),
  pageTextSource: z.enum(["readability", "dom"]).optional()
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
  context: chatContextSchema.optional()
});

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(120).optional()
});

const updateStarSchema = z.object({
  starred: z.boolean()
});

const sendSessionMessageSchema = z.object({
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"]),
  model: z.string().optional(),
  content: z.string().trim().min(1),
  context: chatContextSchema.optional()
});

const listSessionMessagesQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

app.get("/sessions", async (request, reply) => {
  const userId = requireAuthedUserId(request.headers, reply);
  if (!userId) {
    return;
  }

  const response: BridgeSessionListResponse = {
    sessions: store.listSessions(userId)
  };
  return response;
});

app.post("/sessions", async (request, reply) => {
  const userId = requireAuthedUserId(request.headers, reply);
  if (!userId) {
    return;
  }

  const parsed = createSessionSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const title = parsed.data.title;
  const response: BridgeSessionCreateResponse = {
    session: store.createSession(userId, title ?? "New chat")
  };
  return response;
});

app.post("/sessions/:id/star", async (request, reply) => {
  const userId = requireAuthedUserId(request.headers, reply);
  if (!userId) {
    return;
  }

  const parsed = updateStarSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const sessionId = String((request.params as { id: string }).id);
  const payload: BridgeSessionStarRequest = parsed.data;
  const session = store.updateSessionStar(userId, sessionId, payload.starred);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  return { session };
});

app.post("/sessions/:id/close", async (request, reply) => {
  const userId = requireAuthedUserId(request.headers, reply);
  if (!userId) {
    return;
  }

  const sessionId = String((request.params as { id: string }).id);
  const session = store.closeSession(userId, sessionId);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  return { session };
});

app.get("/sessions/:id/messages", async (request, reply) => {
  const userId = requireAuthedUserId(request.headers, reply);
  if (!userId) {
    return;
  }

  const sessionId = String((request.params as { id: string }).id);
  const session = store.getSession(userId, sessionId);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const parsed = listSessionMessagesQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const messages = store.listMessages(
    userId,
    sessionId,
    parsed.data.afterSeq ?? 0,
    parsed.data.limit ?? 200
  );
  const response: BridgeSessionMessagesResponse = { session, messages };
  return response;
});

app.post("/sessions/:id/messages", async (request, reply) => {
  const userId = requireAuthedUserId(request.headers, reply);
  if (!userId) {
    return;
  }

  const parsed = sendSessionMessageSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const sessionId = String((request.params as { id: string }).id);
  const session = store.getSession(userId, sessionId);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }
  if (session.status === "CLOSED") {
    reply.code(409);
    return { error: "session_closed" };
  }

  const userMessage = store.appendMessage(userId, sessionId, "user", parsed.data.content);
  const normalizedContext = normalizeChatContext(parsed.data.context);

  try {
    const sessionReply = await sessionManager.generateReply({
      userId,
      sessionId,
      adapter: parsed.data.adapter,
      fallbackAdapter: config.defaultAdapter,
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
      ...(normalizedContext ? { context: normalizedContext } : {})
    });

    const output = sessionReply.output;
    const assistantMessage = store.appendMessage(userId, sessionId, "assistant", output);

    if (sessionReply.resolvedAdapter === "codex" && sessionReply.codexLink) {
      sessionManager.syncCodexLink(
        userId,
        sessionId,
        sessionReply.codexLink.providerSessionId,
        assistantMessage.seq ?? userMessage.seq ?? 0
      );
    }

    const latestSession = store.getSession(userId, sessionId);
    const response: BridgeSessionSendMessageResponse = {
      session: latestSession ?? session,
      userMessage,
      assistantMessage
    };
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

function requireAuthedUserId(
  headers: Record<string, unknown>,
  reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }
): string | null {
  const headerUserId = normalizeHeaderValue(headers["x-surf-user-id"]);
  const headerToken = normalizeHeaderValue(headers["x-surf-token"]);

  if (config.users.length > 1 && !headerUserId) {
    reply.code(401).send({ error: "missing_user_id" });
    return null;
  }

  const userId = store.authenticateUser(headerUserId, headerToken);
  if (!userId) {
    reply.code(401).send({ error: "unauthorized_user" });
    return null;
  }
  return userId;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function normalizeChatContext(
  context:
    | {
        pageTitle?: string | undefined;
        pageUrl?: string | undefined;
        selectedText?: string | undefined;
        pageText?: string | undefined;
        pageTextSource?: "readability" | "dom" | undefined;
      }
    | undefined
): BridgeChatRequest["context"] | undefined {
  if (!context) {
    return undefined;
  }
  const normalized: NonNullable<BridgeChatRequest["context"]> = {};
  if (context.pageTitle) normalized.pageTitle = context.pageTitle;
  if (context.pageUrl) normalized.pageUrl = context.pageUrl;
  if (context.selectedText) normalized.selectedText = context.selectedText;
  if (context.pageText) normalized.pageText = context.pageText;
  if (context.pageTextSource) normalized.pageTextSource = context.pageTextSource;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

app.setErrorHandler((error, _request, reply) => {
  const message = error instanceof Error ? error.message : "unknown error";
  reply.code(500).send({ error: "internal_error", message });
});

await app.listen({ host: config.host, port: config.port });
app.log.info(`surf-ai bridge listening on http://${config.host}:${config.port}`);
