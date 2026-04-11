import { randomUUID } from "node:crypto";
import type {
  BridgeAssistantMessagePhase,
  BridgeApprovalKind,
  BridgeApprovalStatus,
  BridgeRunApproval,
  BridgeRunStreamEvent,
  ChatMessage
} from "@surf-ai/shared";
import { CodexAppServerClient } from "../core/codex-app-server-client";
import { BridgeStore } from "../core/store";
import type {
  AgentRuntime,
  RuntimeApprovalDecisionInput,
  RuntimeApprovalResult,
  RuntimeEventSink,
  RuntimeRunResult,
  RuntimeStartRunInput
} from "./types";

const APPROVAL_TIMEOUT_MS = 600_000;
const RECONNECT_INTERVAL_MS = 2_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const MAX_HANDOFF_MESSAGES = 20;

type JsonRpcId = string | number;

type SupportedApprovalMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/permissions/requestApproval"
  | "item/tool/requestUserInput"
  | "mcpServer/elicitation/request";

interface ActiveRunContext {
  userId: string;
  sessionId: string;
  runId: string;
  threadId: string;
  turnId: string;
  output: string;
  assistantTextByPhase: Record<BridgeAssistantMessagePhase, string>;
  assistantPhaseByItemId: Map<string, BridgeAssistantMessagePhase>;
  completed: boolean;
  resolve: (value: RuntimeRunResult) => void;
  reject: (reason: unknown) => void;
  pendingApprovals: Set<string>;
}

interface PendingApprovalContext {
  userId: string;
  sessionId: string;
  runId: string;
  threadId: string;
  turnId: string;
  approvalRequestId: string;
  rpcRequestId: JsonRpcId;
  method: SupportedApprovalMethod;
  kind: BridgeApprovalKind;
  availableDecisions: unknown[];
  payload: Record<string, unknown>;
  timer: NodeJS.Timeout;
}

export class CodexAppServerRuntime implements AgentRuntime {
  private readonly client = new CodexAppServerClient();
  private readonly activeRunsByRunId = new Map<string, ActiveRunContext>();
  private readonly activeRunsByTurnKey = new Map<string, ActiveRunContext>();
  private readonly activeRunsByThreadId = new Map<string, ActiveRunContext>();
  private readonly pendingApprovals = new Map<string, PendingApprovalContext>();
  private reconnecting = false;
  private started = false;

  public constructor(
    private readonly store: BridgeStore,
    private readonly eventSink: RuntimeEventSink
  ) {
    this.client.onNotification((message) => {
      this.handleNotification(message.method, message.params);
    });
    this.client.onRequest((message) => {
      void this.handleServerRequest(message.id, message.method, message.params);
    });
    this.client.onClose((error) => {
      void this.handleClientClosed(error);
    });
  }

  public async run(input: RuntimeStartRunInput): Promise<RuntimeRunResult> {
    await this.ensureReady();
    await this.reloadMcpServerConfig();

    const { threadId, isFreshThread } = await this.resolveThread(input);
    const turnInput = this.buildTurnInputText(input, isFreshThread);

    const turnStart = (await this.client.call("turn/start", {
      threadId,
      input: [
        {
          type: "text",
          text: turnInput,
          text_elements: []
        }
      ],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      ...(normalizeModelOverride(input.model) ? { model: normalizeModelOverride(input.model) } : {}),
      ...(input.modelReasoningEffort ? { effort: input.modelReasoningEffort } : {})
    })) as { turn?: { id?: string } };

    const turnId = turnStart?.turn?.id;
    if (typeof turnId !== "string" || turnId.length === 0) {
      throw new Error("codex_turn_id_missing");
    }

    const run = this.store.getSessionRun(input.userId, input.runId);
    if (!run) {
      throw new Error("run_not_found_after_turn_start");
    }

    this.publish(input.sessionId, input.runId, "run.started", {
      run,
      threadId,
      turnId
    });

    const output = await new Promise<RuntimeRunResult>((resolve, reject) => {
      const context: ActiveRunContext = {
        userId: input.userId,
        sessionId: input.sessionId,
        runId: input.runId,
        threadId,
        turnId,
        output: "",
        assistantTextByPhase: {
          commentary: "",
          final_answer: "",
          unknown: ""
        },
        assistantPhaseByItemId: new Map<string, BridgeAssistantMessagePhase>(),
        completed: false,
        resolve,
        reject,
        pendingApprovals: new Set<string>()
      };
      this.activeRunsByRunId.set(input.runId, context);
      this.activeRunsByTurnKey.set(makeTurnKey(threadId, turnId), context);
      this.activeRunsByThreadId.set(threadId, context);
    });

    return output;
  }

  public async cancelRun(userId: string, runId: string): Promise<void> {
    const context = this.activeRunsByRunId.get(runId);
    if (!context || context.userId !== userId) {
      return;
    }

    for (const approvalRequestId of context.pendingApprovals) {
      const pending = this.pendingApprovals.get(makeApprovalKey(runId, approvalRequestId));
      if (!pending) {
        continue;
      }
      await this.applyApprovalDecision(
        pending,
        "cancel",
        "CANCELLED",
        "system",
        "run_cancelled"
      );
    }

    await this.client
      .call("turn/interrupt", {
        threadId: context.threadId,
        turnId: context.turnId
      })
      .catch(() => undefined);
  }

  public async submitApprovalDecision(
    input: RuntimeApprovalDecisionInput
  ): Promise<RuntimeApprovalResult> {
    const key = makeApprovalKey(input.runId, input.approvalRequestId);
    const pending = this.pendingApprovals.get(key);
    if (!pending) {
      const existing = this.store.getApprovalEvent(input.userId, input.runId, input.approvalRequestId);
      if (!existing) {
        throw new Error("approval_request_not_found");
      }
      if (existing.status === "PENDING") {
        throw new Error("approval_request_not_active");
      }
      return { approval: existing };
    }

    if (pending.userId !== input.userId) {
      throw new Error("approval_user_mismatch");
    }

    if (
      pending.availableDecisions.length > 0 &&
      !pending.availableDecisions.some((candidate) => decisionsEqual(candidate, input.decision))
    ) {
      throw new Error("approval_decision_invalid");
    }

    const status = approvalStatusFromDecision(input.decision);
    const approval = await this.applyApprovalDecision(
      pending,
      input.decision,
      status,
      input.decidedBy,
      input.reason
    );
    return { approval };
  }

  private async ensureReady(): Promise<void> {
    if (this.started) {
      return;
    }
    await this.tryStartWithRetry();
    this.started = true;
  }

  private async tryStartWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.client.ensureStarted({ cwd: process.cwd() });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < RECONNECT_MAX_ATTEMPTS) {
          await sleep(RECONNECT_INTERVAL_MS);
        }
      }
    }
    throw new Error(
      `codex_app_server_unavailable: ${
        lastError instanceof Error ? lastError.message : "unknown error"
      }`
    );
  }

  private async reloadMcpServerConfig(): Promise<void> {
    try {
      await this.client.call("config/mcpServer/reload");
    } catch {
      // Best effort: if reload is unsupported or fails transiently, keep serving the run.
    }
  }

  private async resolveThread(
    input: RuntimeStartRunInput
  ): Promise<{ threadId: string; isFreshThread: boolean }> {
    const existingLink = this.store.getAgentSessionLink(input.userId, input.sessionId, "codex");
    if (existingLink?.state === "READY") {
      try {
        await this.client.call("thread/resume", {
          threadId: existingLink.providerSessionId,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          persistExtendedHistory: false
        });
        return {
          threadId: existingLink.providerSessionId,
          isFreshThread: false
        };
      } catch (error) {
        this.store.markAgentSessionLinkBroken(
          input.userId,
          input.sessionId,
          "codex",
          error instanceof Error ? error.message : "codex_thread_resume_failed"
        );
      }
    }

    const threadStart = (await this.client.call("thread/start", {
      cwd: process.cwd(),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      experimentalRawEvents: false,
      persistExtendedHistory: false
    })) as { thread?: { id?: string } };

    const threadId = threadStart?.thread?.id;
    if (typeof threadId !== "string" || threadId.length === 0) {
      throw new Error("codex_thread_id_missing");
    }

    const lastSeq = this.store.listAllMessagesBySession(input.userId, input.sessionId).at(-1)?.seq ?? 0;
    this.store.upsertAgentSessionLink(input.userId, {
      sessionId: input.sessionId,
      provider: "codex",
      providerSessionId: threadId,
      syncedSeq: lastSeq,
      state: "READY"
    });

    return { threadId, isFreshThread: true };
  }

  private buildTurnInputText(input: RuntimeStartRunInput, isFreshThread: boolean): string {
    const sections: string[] = [];
    const context = input.context ?? {};

    if (isFreshThread) {
      const history = this.store.listAllMessagesBySession(input.userId, input.sessionId);
      const recent = history.slice(-MAX_HANDOFF_MESSAGES).map((item) => ({
        role: item.role,
        content: item.content
      }));
      if (recent.length > 1) {
        sections.push(
          "You are continuing an existing Surf AI conversation. Use this recent history snapshot for context."
        );
        sections.push(JSON.stringify({ recent_messages: recent }, null, 2));
      }
    }

    if (context.pageTitle || context.pageUrl || context.selectedText || context.pageText) {
      sections.push("Page context:");
      sections.push(
        JSON.stringify(
          {
            ...(context.pageTitle ? { pageTitle: context.pageTitle } : {}),
            ...(context.pageUrl ? { pageUrl: context.pageUrl } : {}),
            ...(context.selectedText ? { selectedText: context.selectedText } : {}),
            ...(context.pageText ? { pageText: context.pageText } : {}),
            ...(context.pageTextSource ? { pageTextSource: context.pageTextSource } : {})
          },
          null,
          2
        )
      );
    }

    sections.push("Latest user request:");
    sections.push(input.content);
    return sections.join("\n\n");
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "item/started" || method === "item/completed") {
      const payload = asRecord(params);
      const threadId = asString(payload.threadId);
      const turnId = asString(payload.turnId);
      if (!threadId || !turnId) {
        return;
      }

      const context = this.activeRunsByTurnKey.get(makeTurnKey(threadId, turnId));
      if (!context) {
        return;
      }

      const item = asRecord(payload.item);
      const itemType = asString(item.type);
      if (itemType !== "agentMessage") {
        return;
      }

      const itemId = asString(item.id);
      const phase = normalizeAssistantPhase(item.phase);
      if (itemId) {
        context.assistantPhaseByItemId.set(itemId, phase);
      }

      if (method === "item/completed") {
        const text = asText(item.text);
        if (typeof text === "string" && text.length > 0) {
          context.assistantTextByPhase[phase] = text;
        }
        this.publish(context.sessionId, context.runId, "assistant.completed", {
          ...(typeof text === "string" ? { content: text } : {}),
          ...(itemId ? { itemId } : {}),
          phase
        });
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const payload = asRecord(params);
      const threadId = asString(payload.threadId);
      const turnId = asString(payload.turnId);
      const itemId = asString(payload.itemId);
      const delta = asText(payload.delta) ?? "";
      if (!threadId || !turnId || delta.length === 0) {
        return;
      }
      const context = this.activeRunsByTurnKey.get(makeTurnKey(threadId, turnId));
      if (!context) {
        return;
      }
      const phase =
        (itemId ? context.assistantPhaseByItemId.get(itemId) : undefined) ?? "unknown";
      context.output += delta;
      context.assistantTextByPhase[phase] += delta;
      this.publish(context.sessionId, context.runId, "assistant.delta", {
        delta,
        ...(itemId ? { itemId } : {}),
        phase
      });
      return;
    }

    if (
      method === "item/reasoning/summaryTextDelta" ||
      method === "item/reasoning/textDelta" ||
      method === "item/commandExecution/outputDelta"
    ) {
      const payload = asRecord(params);
      const threadId = asString(payload.threadId);
      const turnId = asString(payload.turnId);
      const itemId = asString(payload.itemId) ?? "";
      const delta = asText(payload.delta) ?? "";
      if (!threadId || !turnId || delta.length === 0) {
        return;
      }
      const context = this.activeRunsByTurnKey.get(makeTurnKey(threadId, turnId));
      if (!context) {
        return;
      }
      if (method === "item/reasoning/summaryTextDelta") {
        this.publish(context.sessionId, context.runId, "reasoning.summary.delta", {
          itemId,
          delta
        });
        return;
      }
      if (method === "item/reasoning/textDelta") {
        this.publish(context.sessionId, context.runId, "reasoning.text.delta", {
          itemId,
          delta
        });
        return;
      }
      this.publish(context.sessionId, context.runId, "command.output.delta", {
        itemId,
        delta
      });
      return;
    }

    if (method === "error") {
      const payload = asRecord(params);
      const threadId = asString(payload.threadId);
      const turnId = asString(payload.turnId);
      if (!threadId || !turnId) {
        return;
      }
      const context = this.activeRunsByTurnKey.get(makeTurnKey(threadId, turnId));
      if (!context) {
        return;
      }
      const errorObject = asRecord(payload.error);
      const message = asString(errorObject.message) ?? "codex_runtime_error";
      this.publish(context.sessionId, context.runId, "error", {
        message
      });
      return;
    }

    if (method === "turn/completed") {
      const payload = asRecord(params);
      const threadId = asString(payload.threadId);
      const turn = asRecord(payload.turn);
      const turnId = asString(turn.id);
      if (!threadId || !turnId) {
        return;
      }

      const context = this.activeRunsByTurnKey.get(makeTurnKey(threadId, turnId));
      if (!context || context.completed) {
        return;
      }
      context.completed = true;

      const status = asString(turn.status);
      const errorPayload = asRecord(turn.error);
      const errorMessage =
        asString(errorPayload.message) ??
        (status === "completed" ? undefined : `codex_turn_${status ?? "failed"}`);

      if (status === "completed") {
        const completedMessage = pickCompletedAssistantMessage(context);
        this.publish(context.sessionId, context.runId, "assistant.completed", {
          content: completedMessage.content,
          phase: completedMessage.phase
        });
        this.cleanupRunContext(context);
        context.resolve({
          threadId: context.threadId,
          turnId: context.turnId,
          output: completedMessage.content
        });
        return;
      }

      this.publish(context.sessionId, context.runId, "error", {
        message: errorMessage ?? "codex_turn_failed"
      });
      this.cleanupRunContext(context);
      context.reject(new Error(errorMessage ?? "codex_turn_failed"));
    }
  }

  private async handleServerRequest(
    rpcRequestId: JsonRpcId,
    method: string,
    params: unknown
  ): Promise<void> {
    if (!isSupportedApprovalMethod(method)) {
      this.client.respondError(rpcRequestId, -32601, `unsupported_server_request:${method}`);
      return;
    }

    const payload = asRecord(params);
    const threadId = asString(payload.threadId);
    const turnId = asString(payload.turnId);
    const itemId = asString(payload.itemId);
    if (!threadId) {
      this.client.respondError(rpcRequestId, -32602, "approval_request_invalid_context");
      return;
    }

    const context = this.resolveActiveRunContext(threadId, turnId);
    if (!context) {
      this.client.respondError(rpcRequestId, -32001, "approval_run_context_not_found");
      return;
    }

    const approvalRequestId =
      asString(payload.approvalId) ??
      asString(payload.requestId) ??
      asString(payload.elicitationId) ??
      itemId ??
      String(rpcRequestId);
    const kind = approvalKindFromMethod(method);
    const availableDecisions = resolveAvailableDecisions(method, payload);
    const title = resolveApprovalTitle(method, payload);
    const requestedAt = Date.now();
    const expiresAt = requestedAt + APPROVAL_TIMEOUT_MS;

    const approval = this.store.createApprovalEvent({
      userId: context.userId,
      sessionId: context.sessionId,
      runId: context.runId,
      adapter: "codex",
      threadId,
      turnId: turnId ?? context.turnId,
      approvalRequestId,
      kind,
      ...(title ? { title } : {}),
      payload,
      availableDecisions,
      requestedAt,
      expiresAt
    });

    this.publish(context.sessionId, context.runId, "approval.requested", { approval });

    const timer = setTimeout(() => {
      const pending = this.pendingApprovals.get(makeApprovalKey(context.runId, approvalRequestId));
      if (!pending) {
        return;
      }
      void this.applyApprovalDecision(
        pending,
        fallbackTimeoutDecision(pending.availableDecisions, pending.kind),
        "TIMEOUT",
        "system",
        "approval_timeout"
      );
    }, APPROVAL_TIMEOUT_MS);

    const pending: PendingApprovalContext = {
      userId: context.userId,
      sessionId: context.sessionId,
      runId: context.runId,
      threadId,
      turnId: turnId ?? context.turnId,
      approvalRequestId,
      rpcRequestId,
      method,
      kind,
      availableDecisions,
      payload,
      timer
    };
    context.pendingApprovals.add(approvalRequestId);
    this.pendingApprovals.set(makeApprovalKey(context.runId, approvalRequestId), pending);
  }

  private async applyApprovalDecision(
    pending: PendingApprovalContext,
    decision: unknown,
    status: Exclude<BridgeApprovalStatus, "PENDING">,
    decidedBy: string,
    reason?: string
  ): Promise<BridgeRunApproval> {
    clearTimeout(pending.timer);

    const responsePayload = buildApprovalResponsePayload(
      pending.kind,
      pending.method,
      decision,
      pending.payload
    );
    this.client.respond(pending.rpcRequestId, responsePayload);

    const updated = this.store.updateApprovalEvent({
      userId: pending.userId,
      runId: pending.runId,
      approvalRequestId: pending.approvalRequestId,
      status,
      decision,
      decidedBy,
      ...(reason ? { decisionReason: reason } : {}),
      decidedAt: Date.now()
    });

    const context = this.activeRunsByRunId.get(pending.runId);
    context?.pendingApprovals.delete(pending.approvalRequestId);
    this.pendingApprovals.delete(makeApprovalKey(pending.runId, pending.approvalRequestId));

    if (!updated) {
      throw new Error("approval_event_update_failed");
    }

    this.publish(pending.sessionId, pending.runId, "approval.updated", {
      approval: updated
    });
    return updated;
  }

  private async handleClientClosed(error?: Error): Promise<void> {
    if (this.reconnecting) {
      return;
    }
    this.reconnecting = true;
    this.started = false;

    for (const context of this.activeRunsByRunId.values()) {
      this.publish(context.sessionId, context.runId, "error", {
        message: error?.message ?? "codex_app_server_disconnected"
      });
      this.cleanupRunContext(context);
      context.reject(new Error(error?.message ?? "codex_app_server_disconnected"));
    }

    for (const pending of this.pendingApprovals.values()) {
      clearTimeout(pending.timer);
      const updated = this.store.updateApprovalEvent({
        userId: pending.userId,
        runId: pending.runId,
        approvalRequestId: pending.approvalRequestId,
        status: "FAILED",
        decision: "bridge_disconnected",
        decidedBy: "system",
        decisionReason: "bridge_runtime_disconnected",
        decidedAt: Date.now()
      });
      if (updated) {
        this.publish(pending.sessionId, pending.runId, "approval.updated", {
          approval: updated
        });
      }
    }
    this.pendingApprovals.clear();

    await this.tryStartWithRetry().catch(() => undefined);
    this.reconnecting = false;
  }

  private cleanupRunContext(context: ActiveRunContext): void {
    this.activeRunsByRunId.delete(context.runId);
    this.activeRunsByTurnKey.delete(makeTurnKey(context.threadId, context.turnId));
    if (this.activeRunsByThreadId.get(context.threadId) === context) {
      this.activeRunsByThreadId.delete(context.threadId);
    }
    for (const approvalRequestId of context.pendingApprovals) {
      const key = makeApprovalKey(context.runId, approvalRequestId);
      const pending = this.pendingApprovals.get(key);
      if (!pending) {
        continue;
      }
      clearTimeout(pending.timer);
      this.pendingApprovals.delete(key);
    }
    context.pendingApprovals.clear();
  }

  private resolveActiveRunContext(
    threadId: string,
    turnId: string | undefined
  ): ActiveRunContext | undefined {
    if (turnId) {
      return this.activeRunsByTurnKey.get(makeTurnKey(threadId, turnId));
    }
    return this.activeRunsByThreadId.get(threadId);
  }

  private publish<Type extends BridgeRunStreamEvent["type"]>(
    sessionId: string,
    runId: string,
    type: Type,
    data: Extract<BridgeRunStreamEvent, { type: Type }>["data"]
  ): void {
    this.eventSink.publish({
      eventId: randomUUID(),
      sessionId,
      runId,
      type,
      ts: Date.now(),
      data
    } as Extract<BridgeRunStreamEvent, { type: Type }>);
  }
}

function makeTurnKey(threadId: string, turnId: string): string {
  return `${threadId}::${turnId}`;
}

function makeApprovalKey(runId: string, approvalRequestId: string): string {
  return `${runId}::${approvalRequestId}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isSupportedApprovalMethod(method: string): method is SupportedApprovalMethod {
  return (
    method === "item/commandExecution/requestApproval" ||
    method === "item/fileChange/requestApproval" ||
    method === "item/permissions/requestApproval" ||
    method === "item/tool/requestUserInput" ||
    method === "mcpServer/elicitation/request"
  );
}

function approvalKindFromMethod(method: SupportedApprovalMethod): BridgeApprovalKind {
  if (method === "item/commandExecution/requestApproval") {
    return "commandExecution";
  }
  if (method === "item/fileChange/requestApproval") {
    return "fileChange";
  }
  if (method === "item/permissions/requestApproval") {
    return "permissions";
  }
  return "toolUserInput";
}

function resolveApprovalTitle(method: SupportedApprovalMethod, payload: Record<string, unknown>): string {
  if (method === "item/commandExecution/requestApproval") {
    return asString(payload.command) ?? "Command approval requested";
  }
  if (method === "item/fileChange/requestApproval") {
    return "File change approval requested";
  }
  if (method === "item/permissions/requestApproval") {
    return "Permissions approval requested";
  }
  if (method === "mcpServer/elicitation/request") {
    const serverName = asString(payload.serverName);
    const message = asString(payload.message);
    if (message) {
      return serverName ? `[${serverName}] ${message}` : message;
    }
    return serverName
      ? `[${serverName}] MCP approval requested`
      : "MCP approval requested";
  }
  return "Tool input requested";
}

function resolveAvailableDecisions(
  method: SupportedApprovalMethod,
  payload: Record<string, unknown>
): unknown[] {
  if (method === "item/commandExecution/requestApproval") {
    const raw = payload.availableDecisions;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw;
    }
    return ["accept", "acceptForSession", "decline", "cancel"];
  }

  if (method === "item/fileChange/requestApproval") {
    return ["accept", "acceptForSession", "decline", "cancel"];
  }

  if (method === "item/permissions/requestApproval") {
    return ["accept", "acceptForSession", "decline"];
  }

  if (method === "mcpServer/elicitation/request") {
    return ["accept", "decline", "cancel"];
  }

  return ["cancel"];
}

function fallbackTimeoutDecision(decisions: unknown[], kind: BridgeApprovalKind): unknown {
  if (decisions.some((item) => decisionsEqual(item, "decline"))) {
    return "decline";
  }
  if (decisions.some((item) => decisionsEqual(item, "cancel"))) {
    return "cancel";
  }
  if (kind === "toolUserInput") {
    return "cancel";
  }
  return "decline";
}

function approvalStatusFromDecision(decision: unknown): Exclude<BridgeApprovalStatus, "PENDING"> {
  if (decision === "decline") {
    return "DENIED";
  }
  if (decision === "cancel") {
    return "CANCELLED";
  }
  return "APPROVED";
}

function decisionsEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value, sortObjectKeys);
  } catch {
    return String(value);
  }
}

function sortObjectKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const input = value as Record<string, unknown>;
  const sortedEntries = Object.keys(input)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => [key, input[key]] as const);
  return Object.fromEntries(sortedEntries);
}

function buildApprovalResponsePayload(
  kind: BridgeApprovalKind,
  method: SupportedApprovalMethod,
  decision: unknown,
  payload: Record<string, unknown>
): Record<string, unknown> {
  if (method === "mcpServer/elicitation/request") {
    const normalized = normalizeElicitationResponse(decision, payload);
    return {
      action: normalized.action,
      content: normalized.content,
      _meta: normalized.meta
    };
  }

  if (kind === "commandExecution" || kind === "fileChange") {
    return { decision };
  }

  if (kind === "permissions") {
    if (decision === "acceptForSession") {
      return {
        permissions: payload.permissions ?? {},
        scope: "session"
      };
    }
    if (decision === "accept") {
      return {
        permissions: payload.permissions ?? {},
        scope: "turn"
      };
    }
    return {
      permissions: {},
      scope: "turn"
    };
  }

  return { answers: {} };
}

function normalizeElicitationResponse(
  decision: unknown,
  payload: Record<string, unknown>
): {
  action: "accept" | "decline" | "cancel";
  content: unknown;
  meta: unknown;
} {
  const fallbackMeta = payload._meta ?? null;
  const isFormMode = asString(payload.mode) === "form";

  if (decision && typeof decision === "object" && !Array.isArray(decision)) {
    const input = decision as Record<string, unknown>;
    const action = asString(input.action);
    if (action === "accept" || action === "decline" || action === "cancel") {
      return {
        action,
        content:
          action === "accept"
            ? (Object.prototype.hasOwnProperty.call(input, "content")
                ? (input.content ?? (isFormMode ? {} : null))
                : isFormMode
                  ? {}
                  : null)
            : null,
        meta: Object.prototype.hasOwnProperty.call(input, "_meta")
          ? (input._meta ?? fallbackMeta)
          : fallbackMeta
      };
    }
  }

  if (decision === "accept" || decision === "decline" || decision === "cancel") {
    return {
      action: decision,
      content: decision === "accept" ? (isFormMode ? {} : null) : null,
      meta: fallbackMeta
    };
  }

  return {
    action: "cancel",
    content: null,
    meta: fallbackMeta
  };
}

function normalizeAssistantPhase(value: unknown): BridgeAssistantMessagePhase {
  if (value === "commentary" || value === "final_answer") {
    return value;
  }
  return "unknown";
}

function pickCompletedAssistantMessage(context: ActiveRunContext): {
  content: string;
  phase: BridgeAssistantMessagePhase;
} {
  if (context.assistantTextByPhase.final_answer.length > 0) {
    return {
      content: context.assistantTextByPhase.final_answer,
      phase: "final_answer"
    };
  }

  if (context.assistantTextByPhase.unknown.length > 0) {
    return {
      content: context.assistantTextByPhase.unknown,
      phase: "unknown"
    };
  }

  if (context.assistantTextByPhase.commentary.length > 0) {
    return {
      content: context.assistantTextByPhase.commentary,
      phase: "commentary"
    };
  }

  return {
    content: context.output,
    phase: "unknown"
  };
}

function normalizeModelOverride(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }
  const normalized = model.trim();
  if (!normalized || normalized.toLowerCase() === "auto") {
    return undefined;
  }
  return normalized;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
