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
import { FixedWindowRateLimiter } from "./core/rate-limit";
import { synthesizeWithMiniMax, TtsError } from "./tts/minimax";

const config = readConfig();
const registry = new AdapterRegistry();
const store = new BridgeStore(config.dbPath, config.users);
const sessionManager = new SessionManager(store, registry);
const rateLimiter = new FixedWindowRateLimiter(config.security.rateLimit);

const app = Fastify({
  logger: true,
  trustProxy: config.security.trustProxy
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (isOriginAllowed(origin, config.security.corsAllowedOriginPatterns)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed"), false);
  }
});

app.addHook("onRequest", async (request, reply) => {
  if (config.security.requireHttps && !isHttpsRequest(request.protocol, request.headers)) {
    recordAuditEvent({
      userId: resolveAuditUserId(request.headers),
      eventType: "https_required_blocked",
      level: "WARN",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 426,
      ip: request.ip,
      details: {
        protocol: request.protocol,
        forwardedProto: normalizeHeaderValue(request.headers["x-forwarded-proto"])
      }
    });
    return reply.code(426).send({
      error: "https_required",
      message: "HTTPS is required. Use a TLS reverse proxy or set SURF_AI_REQUIRE_HTTPS=0."
    });
  }
});

app.addHook("onRequest", async (request, reply) => {
  if (!config.token) {
    return;
  }

  const token = request.headers["x-surf-token"];
  if (token !== config.token) {
    recordAuditEvent({
      userId: resolveAuditUserId(request.headers),
      eventType: "token_auth_failed",
      level: "WARN",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 401,
      ip: request.ip
    });
    return reply.code(401).send({ error: "unauthorized" });
  }
});

app.addHook("onRequest", async (request, reply) => {
  const bucket = getRateLimitBucket(request.method, request.url);
  if (!bucket) {
    return;
  }

  const userHint = normalizeHeaderValue(request.headers["x-surf-user-id"]) ?? "-";
  const key = `${bucket}:${request.ip}:${userHint}`;
  const decision = rateLimiter.check(key);

  reply.header("x-ratelimit-limit", String(decision.limit));
  reply.header("x-ratelimit-remaining", String(decision.remaining));
  reply.header("x-ratelimit-reset-ms", String(decision.resetAfterMs));

  if (decision.allowed) {
    return;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1_000));
  reply.header("retry-after", String(retryAfterSeconds));
  recordAuditEvent({
    userId: resolveAuditUserId(request.headers),
    eventType: "rate_limited",
    level: "WARN",
    route: getPathFromUrl(request.url),
    method: request.method,
    statusCode: 429,
    ip: request.ip,
    details: {
      bucket,
      retryAfterMs: decision.retryAfterMs
    }
  });
  return reply.code(429).send({
    error: "rate_limited",
    bucket,
    retryAfterMs: decision.retryAfterMs
  });
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

const previewContextQuerySchema = z.object({
  query: z.string().trim().min(1).max(800)
});

const listAuditEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  eventType: z.string().trim().min(1).max(120).optional()
});

const purgeMaintenanceSchema = z.object({
  dryRun: z.boolean().optional(),
  includeSessions: z.boolean().optional(),
  includeAudit: z.boolean().optional(),
  sessionDays: z.coerce.number().int().min(1).max(3_650).optional(),
  auditDays: z.coerce.number().int().min(1).max(3_650).optional()
});

app.get("/sessions", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const response: BridgeSessionListResponse = {
    sessions: store.listSessions(userId)
  };
  return response;
});

app.post("/sessions", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
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
  const userId = requireAuthedUserId(request, reply);
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
  const userId = requireAuthedUserId(request, reply);
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
  const userId = requireAuthedUserId(request, reply);
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

app.get("/sessions/:id/context", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = previewContextQuerySchema.safeParse(request.query);
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

  const context = sessionManager.previewContext(userId, sessionId, parsed.data.query);
  return { session, context };
});

app.get("/audit/events", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = listAuditEventsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const events = store.listAuditEvents(
    userId,
    parsed.data.limit ?? 100,
    parsed.data.eventType
  );
  return { events };
});

app.post("/admin/maintenance/purge", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = purgeMaintenanceSchema.safeParse((request.body ?? {}) as unknown);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  if (!config.security.retention.enabled) {
    reply.code(409);
    return {
      error: "retention_disabled",
      message: "Set SURF_AI_RETENTION_ENABLED=1 to enable purge endpoint."
    };
  }

  const dryRun = parsed.data.dryRun ?? true;
  const includeSessions = parsed.data.includeSessions ?? true;
  const includeAudit = parsed.data.includeAudit ?? true;
  if (!includeSessions && !includeAudit) {
    reply.code(400);
    return { error: "invalid_scope", message: "At least one of includeSessions/includeAudit must be true." };
  }

  const sessionDays = parsed.data.sessionDays ?? config.security.retention.sessionDays;
  const auditDays = parsed.data.auditDays ?? config.security.retention.auditDays;
  const now = Date.now();

  const result = store.purgeExpiredData(userId, {
    dryRun,
    includeSessions,
    includeAudit,
    sessionCutoffMs: now - daysToMs(sessionDays),
    auditCutoffMs: now - daysToMs(auditDays)
  });

  recordAuditEvent({
    userId,
    eventType: dryRun ? "retention_purge_preview" : "retention_purge_executed",
    level: "INFO",
    route: getPathFromUrl(request.url),
    method: request.method,
    statusCode: 200,
    ip: request.ip,
    details: {
      includeSessions,
      includeAudit,
      sessionDays,
      auditDays,
      counts: result.counts
    }
  });

  return {
    retention: {
      enabled: config.security.retention.enabled,
      sessionDays,
      auditDays
    },
    result,
    cutoffs: {
      sessionBefore: new Date(result.sessionCutoffMs).toISOString(),
      auditBefore: new Date(result.auditCutoffMs).toISOString()
    }
  };
});

app.post("/sessions/:id/messages", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
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

    if (sessionReply.agentLink) {
      sessionManager.syncAgentLink(
        userId,
        sessionId,
        sessionReply.agentLink.provider,
        sessionReply.agentLink.providerSessionId,
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
    recordAuditEvent({
      userId,
      eventType: "session_adapter_failed",
      level: "ERROR",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 500,
      ip: request.ip,
      details: {
        sessionId,
        adapter: parsed.data.adapter,
        message: error instanceof Error ? error.message.slice(0, 500) : "unknown adapter error"
      }
    });
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
    recordAuditEvent({
      userId: resolveAuditUserId(request.headers),
      eventType: "chat_adapter_failed",
      level: "ERROR",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 500,
      ip: request.ip,
      details: {
        adapter: parsed.data.adapter,
        sessionId: parsed.data.sessionId,
        message: error instanceof Error ? error.message.slice(0, 500) : "unknown adapter error"
      }
    });
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
      recordAuditEvent({
        userId: resolveAuditUserId(request.headers),
        eventType: "tts_failed",
        level: "WARN",
        route: getPathFromUrl(request.url),
        method: request.method,
        statusCode: error.statusCode,
        ip: request.ip,
        details: {
          code: error.code,
          message: error.message.slice(0, 500)
        }
      });
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
    recordAuditEvent({
      userId: resolveAuditUserId(request.headers),
      eventType: "tts_internal_error",
      level: "ERROR",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 500,
      ip: request.ip,
      details: {
        message: error instanceof Error ? error.message.slice(0, 500) : "Unknown TTS error"
      }
    });
    reply.code(500);
    return {
      error: "tts_internal_error",
      message: error instanceof Error ? error.message : "Unknown TTS error"
    };
  }
});

function requireAuthedUserId(
  request: {
    headers: Record<string, unknown>;
    method: string;
    url: string;
    ip: string;
  },
  reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }
): string | null {
  const headerUserId = normalizeHeaderValue(request.headers["x-surf-user-id"]);
  const headerToken = normalizeHeaderValue(request.headers["x-surf-token"]);

  if (config.users.length > 1 && !headerUserId) {
    recordAuditEvent({
      eventType: "missing_user_id",
      level: "WARN",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 401,
      ip: request.ip
    });
    reply.code(401).send({ error: "missing_user_id" });
    return null;
  }

  const userId = store.authenticateUser(headerUserId, headerToken);
  if (!userId) {
    recordAuditEvent({
      eventType: "unauthorized_user",
      level: "WARN",
      route: getPathFromUrl(request.url),
      method: request.method,
      statusCode: 401,
      ip: request.ip,
      details: {
        providedUserId: headerUserId ?? null
      }
    });
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

function isOriginAllowed(origin: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => {
    if (!pattern) {
      return false;
    }
    if (!pattern.includes("*")) {
      return origin === pattern;
    }

    const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`, "i");
    return regex.test(origin);
  });
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isHttpsRequest(protocol: string, headers: Record<string, unknown>): boolean {
  if (protocol === "https") {
    return true;
  }

  const forwarded =
    normalizeHeaderValue(headers["x-forwarded-proto"]) ??
    normalizeHeaderValue(headers["x-forwarded-protocol"]) ??
    normalizeHeaderValue(headers["x-forwarded-scheme"]);

  if (!forwarded) {
    return false;
  }

  const primary = forwarded.split(",")[0]?.trim().toLowerCase();
  return primary === "https";
}

function getRateLimitBucket(method: string, rawUrl: string): string | null {
  const path = getPathFromUrl(rawUrl);
  if (method !== "POST") {
    return null;
  }

  if (path === "/chat") {
    return "chat";
  }
  if (path === "/tts") {
    return "tts";
  }
  if (path === "/admin/maintenance/purge") {
    return "maintenance-purge";
  }
  if (/^\/sessions\/[^/]+\/messages$/.test(path)) {
    return "session-message";
  }

  return null;
}

function getPathFromUrl(rawUrl: string): string {
  return rawUrl.split("?")[0] ?? "/";
}

function daysToMs(days: number): number {
  return Math.max(1, days) * 24 * 60 * 60 * 1_000;
}

function resolveAuditUserId(headers: Record<string, unknown>): string | undefined {
  const headerUserId = normalizeHeaderValue(headers["x-surf-user-id"]);
  const headerToken = normalizeHeaderValue(headers["x-surf-token"]);
  const userId = store.authenticateUser(headerUserId, headerToken);
  return userId ?? undefined;
}

function recordAuditEvent(input: {
  userId?: string | undefined;
  eventType: string;
  level: "INFO" | "WARN" | "ERROR";
  route?: string | undefined;
  method?: string | undefined;
  statusCode?: number | undefined;
  ip?: string | undefined;
  details?: Record<string, unknown> | undefined;
}): void {
  try {
    store.appendAuditEvent(input);
  } catch (error) {
    app.log.warn(
      {
        eventType: input.eventType,
        error: error instanceof Error ? error.message : "unknown error"
      },
      "Failed to persist audit event"
    );
  }
}

await app.listen({ host: config.host, port: config.port });
app.log.info(`surf-ai bridge listening on http://${config.host}:${config.port}`);
