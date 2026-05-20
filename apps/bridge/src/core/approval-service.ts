import { randomUUID } from "node:crypto";
import type {
  BridgeAdapter,
  BridgeApprovalKind,
  BridgeApprovalStatus,
  BridgeRunApproval,
  BridgeRunStreamEvent
} from "@surf-ai/shared";
import { BridgeStore } from "./store";
import type { RuntimeEventSink } from "../runtimes/types";

export interface ApprovalServiceOptions {
  timeoutMs?: number;
}

export interface CreatePendingApprovalInput {
  userId: string;
  sessionId: string;
  runId: string;
  adapter: BridgeAdapter;
  threadId?: string;
  turnId?: string;
  approvalRequestId: string;
  kind: BridgeApprovalKind;
  title?: string;
  payload: Record<string, unknown>;
  availableDecisions: unknown[];
  requestedAt?: number;
  expiresAt?: number;
}

export interface CompletePendingApprovalInput {
  userId: string;
  runId: string;
  approvalRequestId: string;
  decision: unknown;
  status?: Exclude<BridgeApprovalStatus, "PENDING">;
  availableDecisions?: unknown[];
  decidedBy: string;
  reason?: string;
  decidedAt?: number;
  validateDecision?: boolean;
  publish?: boolean;
}

export interface ApprovalCreateResult {
  approval: BridgeRunApproval;
  created: boolean;
}

export interface ApprovalTransitionResult {
  approval: BridgeRunApproval;
  transitioned: boolean;
}

export class ApprovalService {
  private readonly timeoutMs: number;

  public constructor(
    private readonly store: BridgeStore,
    private readonly eventSink: RuntimeEventSink,
    options: ApprovalServiceOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 600_000;
  }

  public getApproval(
    userId: string,
    runId: string,
    approvalRequestId: string
  ): BridgeRunApproval | null {
    return this.store.getApprovalEvent(userId, runId, approvalRequestId);
  }

  public createPendingApproval(input: CreatePendingApprovalInput): ApprovalCreateResult {
    const existing = this.store.getApprovalEvent(
      input.userId,
      input.runId,
      input.approvalRequestId
    );
    if (existing) {
      return { approval: existing, created: false };
    }

    const requestedAt = input.requestedAt ?? Date.now();
    const approval = this.store.createApprovalEvent({
      userId: input.userId,
      sessionId: input.sessionId,
      runId: input.runId,
      adapter: input.adapter,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
      approvalRequestId: input.approvalRequestId,
      kind: input.kind,
      ...(input.title ? { title: input.title } : {}),
      payload: input.payload,
      availableDecisions: input.availableDecisions,
      requestedAt,
      expiresAt: input.expiresAt ?? requestedAt + this.timeoutMs
    });

    this.publishApprovalRequested(approval);
    return { approval, created: true };
  }

  public completePendingApproval(input: CompletePendingApprovalInput): ApprovalTransitionResult {
    const existing = this.store.getApprovalEvent(
      input.userId,
      input.runId,
      input.approvalRequestId
    );
    if (!existing) {
      throw new Error("approval_request_not_found");
    }
    if (existing.status !== "PENDING") {
      return { approval: existing, transitioned: false };
    }

    const availableDecisions = input.availableDecisions ?? existing.availableDecisions;
    if (
      input.validateDecision !== false &&
      availableDecisions.length > 0 &&
      !availableDecisions.some((candidate) => decisionsEqual(candidate, input.decision))
    ) {
      throw new Error("approval_decision_invalid");
    }

    const transition = this.store.transitionPendingApprovalEvent({
      userId: input.userId,
      runId: input.runId,
      approvalRequestId: input.approvalRequestId,
      status: input.status ?? approvalStatusFromDecision(input.decision),
      decision: input.decision,
      decidedBy: input.decidedBy,
      ...(input.reason ? { decisionReason: input.reason } : {}),
      decidedAt: input.decidedAt ?? Date.now()
    });

    if (!transition.approval) {
      throw new Error("approval_event_update_failed");
    }

    if (transition.transitioned && input.publish !== false) {
      this.publishApprovalUpdated(transition.approval);
    }

    return {
      approval: transition.approval,
      transitioned: transition.transitioned
    };
  }

  public publishApprovalUpdated(approval: BridgeRunApproval): void {
    this.publish(approval.sessionId, approval.runId, "approval.updated", { approval });
  }

  private publishApprovalRequested(approval: BridgeRunApproval): void {
    this.publish(approval.sessionId, approval.runId, "approval.requested", { approval });
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

export function fallbackTimeoutDecision(decisions: unknown[], kind: BridgeApprovalKind): unknown {
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

export function approvalStatusFromDecision(
  decision: unknown
): Exclude<BridgeApprovalStatus, "PENDING"> {
  if (decision === "decline") {
    return "DENIED";
  }
  if (decision === "cancel") {
    return "CANCELLED";
  }
  return "APPROVED";
}

export function decisionsEqual(left: unknown, right: unknown): boolean {
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
