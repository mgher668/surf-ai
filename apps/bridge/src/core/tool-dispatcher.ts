import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  BridgeRunStreamEvent,
  BridgeToolCallResponse,
  BridgeToolDefinition
} from "@surf-ai/shared";
import { retrieveSessionMessages } from "./retrieval";
import type { BridgeStore } from "./store";
import type { SessionManager } from "./session-manager";
import type { ToolRegistry } from "./tool-registry";

export interface ToolDispatcherEventSink {
  publish(event: BridgeRunStreamEvent): void;
}

export interface ToolDispatcherInput {
  userId: string;
  toolId: string;
  sessionId?: string;
  runId?: string;
  input?: Record<string, unknown>;
}

export interface ToolDispatcherOptions {
  registry: ToolRegistry;
  store: BridgeStore;
  sessionManager: SessionManager;
  eventSink: ToolDispatcherEventSink;
}

type ToolOutputKind = BridgeToolDefinition["outputKind"];

interface ToolHandler {
  inputSchema: z.ZodType<Record<string, unknown>>;
  runRequired: boolean;
  execute(input: {
    userId: string;
    sessionId: string;
    runId?: string;
    input: Record<string, unknown>;
  }): unknown;
}

const contextPreviewSchema = z.object({
  query: z.string().trim().min(1).max(800)
});

const messageSearchSchema = z.object({
  query: z.string().trim().min(1).max(800),
  limit: z.number().int().min(1).max(20).optional()
});

const emptyInputSchema = z.object({}).strict();

export class ToolDispatchError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export class ToolDispatcher {
  private readonly handlers: Record<string, ToolHandler>;

  public constructor(private readonly options: ToolDispatcherOptions) {
    this.handlers = {
      "session.context_preview": {
        inputSchema: contextPreviewSchema,
        runRequired: false,
        execute: ({ userId, sessionId, input }) =>
          this.options.sessionManager.previewContext(
            userId,
            sessionId,
            input.query as string
          )
      },
      "session.messages.search": {
        inputSchema: messageSearchSchema,
        runRequired: false,
        execute: ({ userId, sessionId, input }) => {
          const messages = this.options.store.listAllMessagesBySession(userId, sessionId);
          const retrieval = retrieveSessionMessages({
            messages,
            query: input.query as string,
            ...(typeof input.limit === "number" ? { topDirectLimit: input.limit } : {}),
            neighborWindow: 1
          });

          return {
            query: retrieval.query,
            queryTokens: retrieval.queryTokens,
            topScore: Number(retrieval.topScore.toFixed(4)),
            lowConfidence: retrieval.lowConfidence,
            expanded: retrieval.expanded,
            items: retrieval.items.map((item) => ({
              seq: item.seq,
              role: item.role,
              source: item.source,
              score: item.score,
              snippet: item.content.slice(0, 500)
            }))
          };
        }
      },
      "runtime.event_timeline": {
        inputSchema: emptyInputSchema,
        runRequired: true,
        execute: ({ userId, sessionId, runId }) => ({
          events: this.options.store
            .listRunEvents(userId, sessionId, requireRunId(runId), 5000)
            .map(redactTimelineEvent),
          approvals: this.options.store
            .listRunApprovals(userId, sessionId, requireRunId(runId), "all")
            .map((approval) => ({
              id: approval.id,
              approvalRequestId: approval.approvalRequestId,
              kind: approval.kind,
              title: approval.title,
              status: approval.status,
              requestedAt: approval.requestedAt,
              decidedAt: approval.decidedAt,
              expiresAt: approval.expiresAt
            })),
          artifacts: this.options.store.listArtifactsByRun(userId, sessionId, requireRunId(runId))
        })
      },
      "runtime.artifact_metadata": {
        inputSchema: emptyInputSchema,
        runRequired: true,
        execute: ({ userId, sessionId, runId }) => ({
          artifacts: this.options.store.listArtifactsByRun(userId, sessionId, requireRunId(runId))
        })
      }
    };
  }

  public dispatch(input: ToolDispatcherInput): BridgeToolCallResponse {
    const tool = this.options.registry.getTool(input.toolId);
    if (!tool) {
      throw new ToolDispatchError("tool_not_found", "Tool not found.", 404);
    }
    if (!tool.callable) {
      throw new ToolDispatchError("tool_not_callable", "Tool is metadata-only and cannot be called.", 409);
    }
    if (tool.availability === "unconfigured") {
      throw new ToolDispatchError("tool_unconfigured", "Tool is not configured.", 409);
    }
    if (tool.requiresApproval) {
      throw new ToolDispatchError(
        "tool_requires_approval",
        "Approval-required Surf-owned tool dispatch is not enabled for this tool.",
        409
      );
    }

    const handler = this.handlers[tool.id];
    if (!handler) {
      throw new ToolDispatchError("tool_handler_missing", "Tool handler is not registered.", 500);
    }

    const sessionId = this.requireSession(input.userId, input.sessionId);
    const runId = input.runId ? this.requireRun(input.userId, sessionId, input.runId).id : undefined;
    if (handler.runRequired && !runId) {
      throw new ToolDispatchError("run_id_required", "Tool requires a runId.", 400);
    }

    const parsed = handler.inputSchema.safeParse(input.input ?? {});
    if (!parsed.success) {
      throw new ToolDispatchError("invalid_tool_input", "Tool input failed schema validation.", 400, parsed.error.flatten());
    }

    const toolCallId = randomUUID();
    const events: BridgeRunStreamEvent[] = [];
    const startedAt = Date.now();
    if (runId) {
      events.push(this.publishToolEvent(input.userId, sessionId, runId, "tool.started", {
        toolCallId,
        toolId: tool.id,
        input: parsed.data
      }, startedAt));
    }

    try {
      const content = handler.execute({
        userId: input.userId,
        sessionId,
        ...(runId ? { runId } : {}),
        input: parsed.data
      });

      if (runId) {
        events.push(this.publishToolEvent(input.userId, sessionId, runId, "tool.output", {
          toolCallId,
          toolId: tool.id,
          outputKind: tool.outputKind,
          content: summarizeToolOutputForTimeline(tool.id, content)
        }, Date.now()));
      }

      return {
        tool,
        result: {
          ok: true,
          toolId: tool.id,
          outputKind: tool.outputKind as ToolOutputKind,
          content,
          metadata: { toolCallId }
        },
        events
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool dispatch failed.";
      if (runId) {
        events.push(this.publishToolEvent(input.userId, sessionId, runId, "tool.failed", {
          toolCallId,
          toolId: tool.id,
          code: "tool_execution_failed",
          message
        }, Date.now()));
      }
      throw new ToolDispatchError("tool_execution_failed", message, 500);
    }
  }

  private requireSession(userId: string, sessionId: string | undefined): string {
    if (!sessionId) {
      throw new ToolDispatchError("session_id_required", "Tool requires a sessionId.", 400);
    }
    const session = this.options.store.getSession(userId, sessionId);
    if (!session) {
      throw new ToolDispatchError("session_not_found", "Session not found.", 404);
    }
    return session.id;
  }

  private requireRun(userId: string, sessionId: string, runId: string) {
    const run = this.options.store.getSessionRun(userId, runId);
    if (!run || run.sessionId !== sessionId) {
      throw new ToolDispatchError("run_not_found", "Run not found.", 404);
    }
    return run;
  }

  private publishToolEvent<Type extends Extract<BridgeRunStreamEvent["type"], "tool.started" | "tool.output" | "tool.failed">>(
    userId: string,
    sessionId: string,
    runId: string,
    type: Type,
    data: Extract<BridgeRunStreamEvent, { type: Type }>["data"],
    ts: number
  ): Extract<BridgeRunStreamEvent, { type: Type }> {
    const event = {
      eventId: randomUUID(),
      sessionId,
      runId,
      type,
      ts,
      data
    } as Extract<BridgeRunStreamEvent, { type: Type }>;
    this.options.store.appendRunEvent(userId, event);
    this.options.eventSink.publish(event);
    return event;
  }
}

function requireRunId(runId: string | undefined): string {
  if (!runId) {
    throw new ToolDispatchError("run_id_required", "Tool requires a runId.", 400);
  }
  return runId;
}

function summarizeToolOutputForTimeline(toolId: string, content: unknown): unknown {
  if (toolId === "runtime.event_timeline" && isRecord(content)) {
    return {
      eventCount: Array.isArray(content.events) ? content.events.length : 0,
      approvalCount: Array.isArray(content.approvals) ? content.approvals.length : 0,
      artifactCount: Array.isArray(content.artifacts) ? content.artifacts.length : 0,
      redacted: true
    };
  }

  return content;
}

function redactTimelineEvent(event: BridgeRunStreamEvent): Record<string, unknown> {
  const base = {
    eventId: event.eventId,
    type: event.type,
    ts: event.ts
  };

  if (event.type === "run.started" || event.type === "run.status") {
    return {
      ...base,
      runStatus: event.data.run.status,
      adapter: event.data.run.adapter,
      model: event.data.run.model
    };
  }

  if (event.type === "tool.started" || event.type === "tool.output" || event.type === "tool.failed") {
    return {
      ...base,
      toolCallId: event.data.toolCallId,
      toolId: event.data.toolId,
      ...(event.type === "tool.output" ? { outputKind: event.data.outputKind } : {}),
      ...(event.type === "tool.failed" ? { code: event.data.code, message: event.data.message } : {})
    };
  }

  if (event.type === "approval.requested" || event.type === "approval.updated") {
    return {
      ...base,
      approvalRequestId: event.data.approval.approvalRequestId,
      kind: event.data.approval.kind,
      status: event.data.approval.status,
      title: event.data.approval.title
    };
  }

  if (event.type === "assistant.delta") {
    return {
      ...base,
      phase: event.data.phase,
      deltaChars: event.data.delta.length
    };
  }

  if (event.type === "assistant.completed") {
    return {
      ...base,
      phase: event.data.phase,
      contentChars: event.data.content?.length ?? event.data.message?.content.length ?? 0
    };
  }

  if (event.type === "reasoning.summary.delta" || event.type === "reasoning.text.delta" || event.type === "command.output.delta") {
    return {
      ...base,
      itemId: event.data.itemId,
      deltaChars: event.data.delta.length
    };
  }

  if (event.type === "error") {
    return {
      ...base,
      code: event.data.code,
      message: event.data.message
    };
  }

  return base;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
