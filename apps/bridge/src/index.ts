import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { createReadStream } from "node:fs";
import { mkdir, rm, writeFile, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve, sep as pathSep } from "node:path";
import type {
  ChatAttachment,
  ChatMessagePart,
  BridgeCapabilitiesResponse,
  BridgeChatRequest,
  BridgeChatResponse,
  BridgeSessionCreateResponse,
  BridgeHealthResponse,
  BridgeSessionListResponse,
  BridgeSessionAdapterRequest,
  BridgeSessionAdapterResponse,
  BridgeSessionMessagesResponse,
  BridgeSessionRun,
  BridgeSessionRunCancelResponse,
  BridgeSessionRunCreateRequest,
  BridgeSessionRunCreateResponse,
  BridgeSessionRunResponse,
  BridgeSessionRunsResponse,
  BridgeSessionRenameRequest,
  BridgeSessionRenameResponse,
  BridgeSessionRunApprovalDecisionRequest,
  BridgeSessionRunApprovalDecisionResponse,
  BridgeSessionRunApprovalsResponse,
  BridgeSessionRunEventsResponse,
  BridgeRunStreamEvent,
  BridgeSessionSendMessageResponse,
  BridgeUploadCreateResponse,
  BridgeSessionStarRequest,
  BridgeModelsResponse,
  BridgeModelsUpdateRequest,
  BridgeTtsRequest,
  BridgeTtsResponse
} from "@surf-ai/shared";
import { readConfig } from "./core/config";
import { AdapterRegistry } from "./core/registry";
import { BridgeStore, type StoredAttachment } from "./core/store";
import { SessionManager } from "./core/session-manager";
import { FixedWindowRateLimiter } from "./core/rate-limit";
import { synthesizeWithMiniMax, TtsError } from "./tts/minimax";
import { RunEventBus } from "./core/run-event-bus";
import { RuntimeManager } from "./core/runtime-manager";

const config = readConfig();
const registry = new AdapterRegistry();
const store = new BridgeStore(config.dbPath, config.users);
const sessionManager = new SessionManager(store, registry);
const rateLimiter = new FixedWindowRateLimiter(config.security.rateLimit);
const runEventBus = new RunEventBus();
const runtimeManager = new RuntimeManager(store, runEventBus);
const activeRunControllers = new Map<string, AbortController>();
const MAX_IMAGE_COUNT_PER_MESSAGE = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_ROOT_DIR = resolve(dirname(resolve(config.dbPath)), "uploads");
const recoveredInterruptedRuns = store.recoverInterruptedRuns("bridge_restarted_before_run_completed");
const recoveredInterruptedApprovals = store.recoverPendingApprovals(
  "bridge_restarted_before_approval_decision"
);

const app = Fastify({
  logger: true,
  trustProxy: config.security.trustProxy,
  bodyLimit: MAX_IMAGE_BYTES + 1024 * 1024
});

await mkdir(UPLOAD_ROOT_DIR, { recursive: true });

app.addContentTypeParser(/^image\/[\w.+-]+$/u, { parseAs: "buffer" }, (_request, payload, done) => {
  done(null, payload);
});

app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, payload, done) => {
  done(null, payload);
});

if (recoveredInterruptedRuns > 0) {
  app.log.warn(
    { recoveredInterruptedRuns },
    "Marked interrupted session runs as failed after bridge restart"
  );
  recordAuditEvent({
    eventType: "bridge_restarted_abort_run",
    level: "WARN",
    details: {
      count: recoveredInterruptedRuns
    }
  });
}

if (recoveredInterruptedApprovals > 0) {
  app.log.warn(
    { recoveredInterruptedApprovals },
    "Marked pending approvals as failed after bridge restart"
  );
  recordAuditEvent({
    eventType: "bridge_restarted_abort_approval",
    level: "WARN",
    details: {
      count: recoveredInterruptedApprovals
    }
  });
}

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
    adapters: registry.listNativeAdapters(),
    now: new Date().toISOString()
  };
  return response;
});

app.get("/models", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const response: BridgeModelsResponse = { models: store.listModels(userId) };
  return response;
});

app.get("/capabilities", async () => {
  const response: BridgeCapabilitiesResponse = {
    version: "0.1.0",
    now: new Date().toISOString(),
    chat: {
      adapters: registry.listAdapterCapabilities(config.defaultAdapter),
      defaultAdapter: config.defaultAdapter,
      supportsModelOverride: true
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

app.post("/uploads", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = createUploadQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const session = store.getSession(userId, parsed.data.sessionId);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const body = request.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    reply.code(400);
    return { error: "empty_upload_body" };
  }
  if (body.length > MAX_IMAGE_BYTES) {
    reply.code(413);
    return { error: "image_too_large", maxBytes: MAX_IMAGE_BYTES };
  }

  const detectedMime = detectImageMimeType(body);
  if (!detectedMime) {
    reply.code(415);
    return { error: "image_type_not_allowed" };
  }

  const declaredMime = normalizeMimeType(request.headers["content-type"]);
  if (declaredMime && declaredMime !== detectedMime) {
    reply.code(415);
    return { error: "image_type_not_allowed" };
  }

  const extension = extensionFromMimeType(detectedMime);
  const fileNameFromHeader = decodeHeaderFileName(normalizeHeaderValue(request.headers["x-surf-file-name"]));
  const requestedFileName = parsed.data.fileName || fileNameFromHeader;

  const now = new Date();
  const relPath = `${userId}/${String(now.getUTCFullYear())}/${String(
    now.getUTCMonth() + 1
  ).padStart(2, "0")}/${randomUUID()}.${extension}`;
  const absPath = resolveUploadPath(relPath);
  if (!absPath) {
    reply.code(500);
    return { error: "upload_path_invalid" };
  }

  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, body);

  const attachment = store.createAttachment({
    userId,
    sessionId: parsed.data.sessionId,
    storagePath: relPath,
    mimeType: detectedMime,
    byteSize: body.length,
    ...(requestedFileName ? { fileName: requestedFileName } : {}),
    sha256: createHash("sha256").update(body).digest("hex")
  });

  const response: BridgeUploadCreateResponse = {
    attachment: toChatAttachment(attachment)
  };
  return response;
});

app.get("/uploads/:id", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const attachmentId = String((request.params as { id: string }).id);
  const attachment = store.getAttachment(userId, attachmentId);
  if (!attachment) {
    reply.code(404);
    return { error: "attachment_not_found" };
  }

  const absPath = resolveUploadPath(attachment.storagePath);
  if (!absPath) {
    reply.code(500);
    return { error: "attachment_path_invalid" };
  }

  try {
    const fileStat = await stat(absPath);
    if (!fileStat.isFile()) {
      reply.code(404);
      return { error: "attachment_file_missing" };
    }
  } catch {
    reply.code(404);
    return { error: "attachment_file_missing" };
  }

  reply.header("cache-control", "private, max-age=31536000, immutable");
  reply.type(attachment.mimeType);
  return reply.send(createReadStream(absPath));
});

const chatContextSchema = z.object({
  pageTitle: z.string().optional(),
  pageUrl: z.string().optional(),
  selectedText: z.string().optional(),
  pageText: z.string().optional(),
  pageTextSource: z.enum(["readability", "dom"]).optional()
});

const codexReasoningEffortSchema = z.enum(["minimal", "low", "medium", "high", "xhigh"]);

const bridgeModelSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(120),
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"]),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  modelReasoningEffort: codexReasoningEffortSchema.optional()
});
type BridgeModelInput = z.infer<typeof bridgeModelSchema>;

const chatRequestSchema = z.object({
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"]),
  model: z.string().optional(),
  modelReasoningEffort: codexReasoningEffortSchema.optional(),
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

const updateTitleSchema = z.object({
  title: z.string().trim().min(1).max(120)
});

const updateStarSchema = z.object({
  starred: z.boolean()
});

const updateAdapterSchema = z.object({
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"])
});

const sendSessionMessageSchema = z.object({
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"]),
  model: z.string().optional(),
  modelReasoningEffort: codexReasoningEffortSchema.optional(),
  content: z.string().max(40_000),
  attachmentIds: z.array(z.string().uuid()).max(MAX_IMAGE_COUNT_PER_MESSAGE).optional(),
  context: chatContextSchema.optional()
});

const createSessionRunSchema = z.object({
  adapter: z.enum(["codex", "claude", "openai-compatible", "anthropic", "gemini", "mock"]),
  model: z.string().optional(),
  modelReasoningEffort: codexReasoningEffortSchema.optional(),
  content: z.string().max(40_000),
  attachmentIds: z.array(z.string().uuid()).max(MAX_IMAGE_COUNT_PER_MESSAGE).optional(),
  context: chatContextSchema.optional()
});

const createUploadQuerySchema = z.object({
  sessionId: z.string().min(1),
  fileName: z.string().trim().max(240).optional()
});

const listSessionRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional()
});

const listRunApprovalsQuerySchema = z.object({
  status: z.enum(["pending", "all"]).optional()
});

const listRunEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(5000).optional()
});

const approvalDecisionSchema = z.object({
  decision: z.unknown(),
  reason: z.string().trim().min(1).max(500).optional()
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

const updateModelsSchema = z.object({
  models: z.array(bridgeModelSchema).max(500)
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

app.put("/models", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = updateModelsSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const payload = parsed.data;
  const response: BridgeModelsResponse = {
    models: store.replaceModels(
      userId,
      payload.models.map((item) => normalizeBridgeModel(item))
    )
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

app.patch("/sessions/:id", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = updateTitleSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const sessionId = String((request.params as { id: string }).id);
  const payload: BridgeSessionRenameRequest = parsed.data;
  const session = store.updateSessionTitle(userId, sessionId, payload.title);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const response: BridgeSessionRenameResponse = { session };
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

app.post("/sessions/:id/adapter", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = updateAdapterSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const sessionId = String((request.params as { id: string }).id);
  const payload: BridgeSessionAdapterRequest = parsed.data;
  const session = store.updateSessionLastAdapter(userId, sessionId, payload.adapter);
  if (!session) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const response: BridgeSessionAdapterResponse = { session };
  return response;
});

app.delete("/sessions/:id", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const sessionId = String((request.params as { id: string }).id);
  const existingSession = store.getSession(userId, sessionId);
  if (!existingSession) {
    reply.code(404);
    return { error: "session_not_found" };
  }
  const sessionAttachments = store.listAttachmentsBySession(userId, sessionId);
  const deleted = store.deleteSession(userId, sessionId);
  if (!deleted) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  await removeStoredFiles(sessionAttachments.map((item) => item.storagePath));

  return { ok: true, deletedSessionId: sessionId };
});

app.get("/sessions/:id/messages", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const sessionId = String((request.params as { id: string }).id);
  const existingSession = store.getSession(userId, sessionId);
  if (!existingSession) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const session = existingSession;

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

app.get("/sessions/:id/runs", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = listSessionRunsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const sessionId = String((request.params as { id: string }).id);
  const existingSession = store.getSession(userId, sessionId);
  if (!existingSession) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const response: BridgeSessionRunsResponse = {
    runs: store.listSessionRuns(userId, sessionId, parsed.data.limit ?? 20)
  };
  return response;
});

app.post("/sessions/:id/runs", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = createSessionRunSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const sessionId = String((request.params as { id: string }).id);
  const existingSession = store.getSession(userId, sessionId);
  if (!existingSession) {
    reply.code(404);
    return { error: "session_not_found" };
  }

  const inFlightRun = store.getLatestActiveSessionRun(userId, sessionId);
  if (inFlightRun) {
    reply.code(409);
    return { error: "session_run_in_progress", run: inFlightRun };
  }

  if (store.countActiveRuns(userId) >= 10) {
    reply.code(429);
    return {
      error: "too_many_concurrent_turns",
      message: "Reached per-user concurrent run limit (10)."
    };
  }

  const sessionWithAdapter =
    store.updateSessionLastAdapter(userId, sessionId, parsed.data.adapter) ?? existingSession;
  const requestedModel = normalizeRequestedModel(parsed.data.model);
  const normalizedContent = normalizeComposerContent(parsed.data.content);
  const attachmentIds = normalizeAttachmentIds(parsed.data.attachmentIds);
  if (!normalizedContent && attachmentIds.length === 0) {
    reply.code(400);
    return {
      error: "empty_message",
      message: "Message content is empty and no attachments were provided."
    };
  }

  const attachments = store.listAttachmentsByIds(userId, sessionId, attachmentIds);
  if (attachments.length !== attachmentIds.length) {
    reply.code(400);
    return { error: "attachment_not_found_or_not_owned" };
  }
  const messageParts = buildMessageParts(normalizedContent, attachments);
  const messageContent = buildMessageContent(normalizedContent, attachments.length);
  const runtimeAttachments = toRuntimeAttachments(attachments);
  if (runtimeAttachments.length !== attachments.length) {
    reply.code(500);
    return { error: "attachment_path_invalid" };
  }

  store.updateSessionStatus(userId, sessionId, "RUNNING");
  const userMessage = store.appendMessage(
    userId,
    sessionId,
    "user",
    messageContent,
    parsed.data.adapter,
    requestedModel,
    messageParts
  );
  const session = store.updateSessionStatus(userId, sessionId, "RUNNING") ?? sessionWithAdapter;
  const run = store.createSessionRun({
    userId,
    sessionId,
    adapter: parsed.data.adapter,
    model: requestedModel,
    status: "QUEUED",
    userMessageId: userMessage.id
  });
  publishRunStatusEvent(userId, run.id);

  const normalizedContext = normalizeChatContext(parsed.data.context);
  const modelReasoningEffort = normalizeCodexReasoningEffort(
    parsed.data.adapter,
    parsed.data.modelReasoningEffort
  );
  void executeSessionRun({
    userId,
    sessionId,
    runId: run.id,
    adapter: parsed.data.adapter,
    content: normalizedContent,
    model: requestedModel,
    ...(runtimeAttachments.length > 0 ? { attachments: runtimeAttachments } : {}),
    ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    ...(normalizedContext ? { context: normalizedContext } : {})
  });

  reply.code(202);
  const response: BridgeSessionRunCreateResponse = {
    session,
    run,
    userMessage
  };
  return response;
});

app.get("/sessions/:id/runs/:runId/stream", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const params = request.params as { id: string; runId: string };
  const sessionId = String(params.id);
  const runId = String(params.runId);
  const run = store.getSessionRun(userId, runId);
  if (!run || run.sessionId !== sessionId) {
    reply.code(404);
    return { error: "run_not_found" };
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });

  const writeEvent = (event: BridgeRunStreamEvent): void => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = runtimeManager.subscribeRunEvents(
    userId,
    sessionId,
    runId,
    writeEvent,
    true
  );
  const heartbeat = setInterval(() => {
    writeEvent({
      eventId: randomEventId(),
      sessionId,
      runId,
      type: "heartbeat",
      ts: Date.now(),
      data: {}
    });
  }, 15_000);

  const close = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
    try {
      reply.raw.end();
    } catch {
      // ignore close errors
    }
  };

  request.raw.once("close", close);
  request.raw.once("aborted", close);
});

app.get("/sessions/:id/runs/:runId/approvals", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const params = request.params as { id: string; runId: string };
  const sessionId = String(params.id);
  const runId = String(params.runId);
  const run = store.getSessionRun(userId, runId);
  if (!run || run.sessionId !== sessionId) {
    reply.code(404);
    return { error: "run_not_found" };
  }

  const parsed = listRunApprovalsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const response: BridgeSessionRunApprovalsResponse = {
    approvals: store.listRunApprovals(
      userId,
      sessionId,
      runId,
      parsed.data.status ?? "all"
    )
  };
  return response;
});

app.get("/sessions/:id/runs/:runId/events", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const params = request.params as { id: string; runId: string };
  const sessionId = String(params.id);
  const runId = String(params.runId);
  const run = store.getSessionRun(userId, runId);
  if (!run || run.sessionId !== sessionId) {
    reply.code(404);
    return { error: "run_not_found" };
  }

  const parsed = listRunEventsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }

  const response: BridgeSessionRunEventsResponse = {
    events: store.listRunEvents(
      userId,
      sessionId,
      runId,
      parsed.data.limit ?? 2000
    )
  };
  return response;
});

app.post("/sessions/:id/runs/:runId/approvals/:approvalRequestId/decision", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = approvalDecisionSchema.safeParse(request.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: "invalid_request", details: parsed.error.flatten() };
  }
  const payload: BridgeSessionRunApprovalDecisionRequest = {
    decision: parsed.data.decision,
    ...(parsed.data.reason ? { reason: parsed.data.reason } : {})
  };

  const params = request.params as {
    id: string;
    runId: string;
    approvalRequestId: string;
  };
  const sessionId = String(params.id);
  const runId = String(params.runId);
  const approvalRequestId = String(params.approvalRequestId);
  const run = store.getSessionRun(userId, runId);
  if (!run || run.sessionId !== sessionId) {
    reply.code(404);
    return { error: "run_not_found" };
  }
  if (run.adapter !== "codex") {
    reply.code(409);
    return { error: "approval_not_supported_for_adapter" };
  }

  try {
    const result = await runtimeManager.submitCodexApprovalDecision({
      userId,
      runId,
      approvalRequestId,
      decision: payload.decision,
      ...(payload.reason ? { reason: payload.reason } : {}),
      decidedBy: userId
    });
    const response: BridgeSessionRunApprovalDecisionResponse = {
      approval: result.approval
    };
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "approval_decision_failed";
    if (message === "approval_request_not_found") {
      reply.code(404);
      return { error: message };
    }
    if (message === "approval_decision_invalid") {
      reply.code(400);
      return { error: message };
    }
    if (message === "approval_request_not_active") {
      reply.code(409);
      return { error: message };
    }
    reply.code(500);
    return { error: "approval_decision_failed", message };
  }
});

app.get("/runs/:id", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const runId = String((request.params as { id: string }).id);
  const run = store.getSessionRun(userId, runId);
  if (!run) {
    reply.code(404);
    return { error: "run_not_found" };
  }

  const response: BridgeSessionRunResponse = { run };
  return response;
});

app.post("/runs/:id/cancel", async (request, reply) => {
  const userId = requireAuthedUserId(request, reply);
  if (!userId) {
    return;
  }

  const runId = String((request.params as { id: string }).id);
  const run = store.getSessionRun(userId, runId);
  if (!run) {
    reply.code(404);
    return { error: "run_not_found" };
  }

  if (isRunTerminal(run.status)) {
    const response: BridgeSessionRunCancelResponse = { run };
    return response;
  }

  if (run.status === "QUEUED") {
    const cancelled =
      store.updateSessionRunStatus(userId, runId, {
        status: "CANCELLED",
        errorMessage: "cancelled_by_user",
        finishedAt: Date.now()
      }) ?? run;
    store.updateSessionStatus(userId, run.sessionId, "IDLE");
    publishRunStatusEvent(userId, runId);
    const response: BridgeSessionRunCancelResponse = { run: cancelled };
    return response;
  }

  const cancelling =
    store.updateSessionRunStatus(userId, runId, {
      status: "CANCELLING",
      errorMessage: "cancel_requested"
    }) ?? run;
  publishRunStatusEvent(userId, runId);

  const controller = activeRunControllers.get(runId);
  if (controller) {
    controller.abort();
    if (run.adapter === "codex") {
      await runtimeManager.cancelCodexRun(userId, runId).catch(() => undefined);
    }
  } else {
    store.updateSessionRunStatus(userId, runId, {
      status: "CANCELLED",
      errorMessage: "cancelled_without_active_process",
      finishedAt: Date.now()
    });
    store.updateSessionStatus(userId, run.sessionId, "IDLE");
    publishRunStatusEvent(userId, runId);
  }

  const response: BridgeSessionRunCancelResponse = { run: cancelling };
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
  const existingSession = store.getSession(userId, sessionId);
  if (!existingSession) {
    reply.code(404);
    return { error: "session_not_found" };
  }
  const session = existingSession;

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
  const existingSession = store.getSession(userId, sessionId);
  if (!existingSession) {
    reply.code(404);
    return { error: "session_not_found" };
  }
  const session =
    store.updateSessionLastAdapter(userId, sessionId, parsed.data.adapter) ?? existingSession;
  const requestedModel = normalizeRequestedModel(parsed.data.model);
  const normalizedContent = normalizeComposerContent(parsed.data.content);
  const attachmentIds = normalizeAttachmentIds(parsed.data.attachmentIds);
  if (!normalizedContent && attachmentIds.length === 0) {
    reply.code(400);
    return {
      error: "empty_message",
      message: "Message content is empty and no attachments were provided."
    };
  }
  const attachments = store.listAttachmentsByIds(userId, sessionId, attachmentIds);
  if (attachments.length !== attachmentIds.length) {
    reply.code(400);
    return { error: "attachment_not_found_or_not_owned" };
  }
  const messageParts = buildMessageParts(normalizedContent, attachments);
  const messageContent = buildMessageContent(normalizedContent, attachments.length);

  const userMessage = store.appendMessage(
    userId,
    sessionId,
    "user",
    messageContent,
    parsed.data.adapter,
    requestedModel,
    messageParts
  );
  const normalizedContext = normalizeChatContext(parsed.data.context);
  const modelOverride = toModelOverride(requestedModel);
  const modelReasoningEffort = normalizeCodexReasoningEffort(
    parsed.data.adapter,
    parsed.data.modelReasoningEffort
  );

  try {
    const sessionReply = await sessionManager.generateReply({
      userId,
      sessionId,
      adapter: parsed.data.adapter,
      fallbackAdapter: config.defaultAdapter,
      ...(modelOverride ? { model: modelOverride } : {}),
      ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
      ...(normalizedContext ? { context: normalizedContext } : {})
    });

    const output = sessionReply.output;
    const assistantMessage = store.appendMessage(
      userId,
      sessionId,
      "assistant",
      output,
      parsed.data.adapter,
      requestedModel
    );

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

function toModelOverride(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }
  const normalized = model.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.toLowerCase() === "auto") {
    return undefined;
  }
  return normalized;
}

function normalizeRequestedModel(model: string | undefined): string {
  return toModelOverride(model) ?? "auto";
}

function normalizeCodexReasoningEffort(
  adapter: BridgeChatRequest["adapter"],
  value: BridgeChatRequest["modelReasoningEffort"] | undefined
): BridgeChatRequest["modelReasoningEffort"] | undefined {
  if (adapter !== "codex") {
    return undefined;
  }
  return value;
}

function normalizeBridgeModel(model: BridgeModelInput): BridgeModelsUpdateRequest["models"][number] {
  const normalized = {
    id: model.id,
    label: model.label,
    adapter: model.adapter,
    enabled: model.enabled,
    isDefault: model.isDefault
  };

  if (model.adapter === "codex" && model.modelReasoningEffort) {
    return {
      ...normalized,
      modelReasoningEffort: model.modelReasoningEffort
    };
  }

  return normalized;
}

async function executeSessionRun(input: {
  userId: string;
  sessionId: string;
  runId: string;
  adapter: BridgeSessionRunCreateRequest["adapter"];
  content: string;
  attachments?: Array<ChatAttachment & { path: string }>;
  model?: string;
  modelReasoningEffort?: BridgeSessionRunCreateRequest["modelReasoningEffort"];
  context?: BridgeChatRequest["context"];
}): Promise<void> {
  const latestRun = store.getSessionRun(input.userId, input.runId);
  if (!latestRun || isRunTerminal(latestRun.status)) {
    return;
  }

  const controller = new AbortController();
  activeRunControllers.set(input.runId, controller);

  try {
    store.updateSessionRunStatus(input.userId, input.runId, {
      status: "RUNNING",
      startedAt: Date.now()
    });
    store.updateSessionStatus(input.userId, input.sessionId, "RUNNING");
    publishRunStatusEvent(input.userId, input.runId);

    if (store.getSessionRun(input.userId, input.runId)?.status === "CANCELLING") {
      controller.abort();
    }

    let output = "";
    if (input.adapter === "codex") {
      const runtimeResult = await runtimeManager.runWithCodex({
        userId: input.userId,
        sessionId: input.sessionId,
        runId: input.runId,
        adapter: input.adapter,
        content: input.content,
        ...(input.attachments && input.attachments.length > 0
          ? { attachments: input.attachments }
          : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelReasoningEffort
          ? { modelReasoningEffort: input.modelReasoningEffort }
          : {}),
        ...(input.context ? { context: input.context } : {})
      });
      output = runtimeResult.output;
      const syncedSeq = store.listAllMessagesBySession(input.userId, input.sessionId).at(-1)?.seq ?? 0;
      sessionManager.syncAgentLink(
        input.userId,
        input.sessionId,
        "codex",
        runtimeResult.threadId,
        syncedSeq
      );
    } else {
      if (!input.content.trim()) {
        throw new Error("adapter_does_not_support_image_only_message");
      }
      const modelOverride = toModelOverride(input.model);
      const sessionReply = await sessionManager.generateReply({
        userId: input.userId,
        sessionId: input.sessionId,
        adapter: input.adapter,
        fallbackAdapter: config.defaultAdapter,
        ...(modelOverride ? { model: modelOverride } : {}),
        ...(input.modelReasoningEffort
          ? { modelReasoningEffort: input.modelReasoningEffort }
          : {}),
        ...(input.context ? { context: input.context } : {}),
        signal: controller.signal
      });
      output = sessionReply.output;

      if (sessionReply.agentLink) {
        const syncedSeq =
          store.listAllMessagesBySession(input.userId, input.sessionId).at(-1)?.seq ?? 0;
        sessionManager.syncAgentLink(
          input.userId,
          input.sessionId,
          sessionReply.agentLink.provider,
          sessionReply.agentLink.providerSessionId,
          syncedSeq
        );
      }
    }

    const assistantMessage = store.appendMessage(
      input.userId,
      input.sessionId,
      "assistant",
      output,
      input.adapter,
      normalizeRequestedModel(input.model)
    );

    store.updateSessionRunStatus(input.userId, input.runId, {
      status: "SUCCEEDED",
      assistantMessageId: assistantMessage.id,
      finishedAt: Date.now()
    });
    store.updateSessionStatus(input.userId, input.sessionId, "IDLE");
    publishRunStatusEvent(input.userId, input.runId);
  } catch (error) {
    const latest = store.getSessionRun(input.userId, input.runId);
    const cancelled =
      controller.signal.aborted || isAbortLikeError(error) || latest?.status === "CANCELLING";

    if (cancelled) {
      store.updateSessionRunStatus(input.userId, input.runId, {
        status: "CANCELLED",
        errorMessage: "cancelled_by_user",
        finishedAt: Date.now()
      });
      store.updateSessionStatus(input.userId, input.sessionId, "IDLE");
      publishRunStatusEvent(input.userId, input.runId);
      return;
    }

    const message = toRunErrorMessage(error);
    store.updateSessionRunStatus(input.userId, input.runId, {
      status: "FAILED",
      errorMessage: message,
      finishedAt: Date.now()
    });
    store.updateSessionStatus(input.userId, input.sessionId, "ERROR");
    publishRunStatusEvent(input.userId, input.runId);
    publishRunErrorEvent(input.userId, input.runId, message);
    recordAuditEvent({
      userId: input.userId,
      eventType: "session_run_failed",
      level: "ERROR",
      details: {
        sessionId: input.sessionId,
        runId: input.runId,
        adapter: input.adapter,
        message
      }
    });
  } finally {
    activeRunControllers.delete(input.runId);
  }
}

function isRunTerminal(status: BridgeSessionRun["status"]): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("aborted") || message.includes("abort");
}

function toRunErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return "unknown session run error";
}

function publishRunStatusEvent(userId: string, runId: string): void {
  const run = store.getSessionRun(userId, runId);
  if (!run) {
    return;
  }
  const event: BridgeRunStreamEvent = {
    eventId: randomEventId(),
    sessionId: run.sessionId,
    runId: run.id,
    type: "run.status",
    ts: Date.now(),
    data: { run }
  };
  store.appendRunEvent(userId, event);
  runEventBus.publish(event);
}

function publishRunErrorEvent(userId: string, runId: string, message: string): void {
  const run = store.getSessionRun(userId, runId);
  if (!run) {
    return;
  }
  const event: BridgeRunStreamEvent = {
    eventId: randomEventId(),
    sessionId: run.sessionId,
    runId: run.id,
    type: "error",
    ts: Date.now(),
    data: { message }
  };
  store.appendRunEvent(userId, event);
  runEventBus.publish(event);
}

function randomEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function normalizeComposerContent(content: string): string {
  return content.trim();
}

function normalizeAttachmentIds(attachmentIds: string[] | undefined): string[] {
  if (!attachmentIds || attachmentIds.length === 0) {
    return [];
  }
  const unique = new Set<string>();
  for (const id of attachmentIds) {
    const normalized = id.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
    if (unique.size >= MAX_IMAGE_COUNT_PER_MESSAGE) {
      break;
    }
  }
  return [...unique];
}

function buildMessageContent(text: string, attachmentCount: number): string {
  if (text) {
    return text;
  }
  if (attachmentCount > 0) {
    return `[${attachmentCount} image${attachmentCount > 1 ? "s" : ""}]`;
  }
  return "";
}

function buildMessageParts(
  text: string,
  attachments: StoredAttachment[]
): ChatMessagePart[] | undefined {
  const parts: ChatMessagePart[] = [];
  if (text) {
    parts.push({
      type: "text",
      text
    });
  }
  for (const attachment of attachments) {
    parts.push({
      type: "image",
      attachment: toChatAttachment(attachment)
    });
  }
  return parts.length > 0 ? parts : undefined;
}

function toChatAttachment(attachment: StoredAttachment): ChatAttachment {
  return {
    id: attachment.id,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    ...(attachment.fileName ? { fileName: attachment.fileName } : {}),
    url: `/uploads/${attachment.id}`,
    createdAt: attachment.createdAt
  };
}

function toRuntimeAttachments(attachments: StoredAttachment[]): Array<ChatAttachment & { path: string }> {
  const mapped: Array<ChatAttachment & { path: string }> = [];
  for (const attachment of attachments) {
    const path = resolveUploadPath(attachment.storagePath);
    if (!path) {
      continue;
    }
    mapped.push({
      ...toChatAttachment(attachment),
      path
    });
  }
  return mapped;
}

function normalizeMimeType(raw: unknown): string | undefined {
  const value = normalizeHeaderValue(raw);
  if (!value) {
    return undefined;
  }
  const normalized = value.split(";")[0]?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "image/jpg") {
    return "image/jpeg";
  }
  return normalized;
}

function detectImageMimeType(body: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (body.length >= 8) {
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (pngSignature.every((item, index) => body[index] === item)) {
      return "image/png";
    }
  }

  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    body.length >= 12 &&
    body.toString("ascii", 0, 4) === "RIFF" &&
    body.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  if (body.length >= 6) {
    const magic = body.toString("ascii", 0, 6);
    if (magic === "GIF87a" || magic === "GIF89a") {
      return "image/gif";
    }
  }

  return null;
}

function extensionFromMimeType(mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "gif";
}

function decodeHeaderFileName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const decoded = decodeURIComponentSafe(value).trim();
  if (!decoded) {
    return undefined;
  }
  return decoded.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 240);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function resolveUploadPath(storagePath: string): string | null {
  const normalized = storagePath.trim().replace(/\\/g, "/");
  if (!normalized) {
    return null;
  }
  const absolute = resolve(UPLOAD_ROOT_DIR, normalized);
  const uploadRootWithSlash = UPLOAD_ROOT_DIR.endsWith(pathSep) ? UPLOAD_ROOT_DIR : `${UPLOAD_ROOT_DIR}${pathSep}`;
  if (absolute !== UPLOAD_ROOT_DIR && !absolute.startsWith(uploadRootWithSlash)) {
    return null;
  }
  return absolute;
}

async function removeStoredFiles(storagePaths: string[]): Promise<void> {
  const uniquePaths = [...new Set(storagePaths)];
  for (const storagePath of uniquePaths) {
    const absolute = resolveUploadPath(storagePath);
    if (!absolute) {
      continue;
    }
    await rm(absolute, { force: true }).catch(() => undefined);
  }
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
  if (/^\/sessions\/[^/]+\/runs$/.test(path)) {
    return "session-message";
  }
  if (path === "/uploads") {
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
