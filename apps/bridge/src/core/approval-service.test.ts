import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import type { BridgeRunStreamEvent } from "@surf-ai/shared";
import {
  ApprovalService,
  decisionsEqual,
  fallbackTimeoutDecision
} from "./approval-service";
import { BridgeStore } from "./store";

test("ApprovalService creates pending approvals and publishes requested event", () => {
  usingFixture(({ service, events, run }) => {
    const result = service.createPendingApproval({
      userId: "local",
      sessionId: run.sessionId,
      runId: run.id,
      adapter: "codex",
      threadId: "thread-1",
      turnId: "turn-1",
      approvalRequestId: "approval-1",
      kind: "commandExecution",
      title: "npm test",
      payload: { command: "npm test" },
      availableDecisions: ["accept", "decline"],
      requestedAt: 1000,
      expiresAt: 2000
    });

    assert.equal(result.created, true);
    assert.equal(result.approval.status, "PENDING");
    assert.equal(result.approval.title, "npm test");
    assert.equal(result.approval.expiresAt, 2000);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "approval.requested");
  });
});

test("ApprovalService completes approvals with atomic terminal transition", () => {
  usingFixture(({ service, store, events, run }) => {
    seedPendingApproval(service, run.id, run.sessionId);

    const first = service.completePendingApproval({
      userId: "local",
      runId: run.id,
      approvalRequestId: "approval-1",
      decision: "acceptForSession",
      decidedBy: "local",
      decidedAt: 3000
    });

    assert.equal(first.transitioned, true);
    assert.equal(first.approval.status, "APPROVED");
    assert.equal(first.approval.decision, "acceptForSession");
    assert.equal(first.approval.decidedAt, 3000);
    assert.equal(events.filter((event) => event.type === "approval.updated").length, 1);

    const duplicate = service.completePendingApproval({
      userId: "local",
      runId: run.id,
      approvalRequestId: "approval-1",
      decision: "decline",
      decidedBy: "local",
      decidedAt: 4000
    });

    assert.equal(duplicate.transitioned, false);
    assert.equal(duplicate.approval.status, "APPROVED");
    assert.equal(duplicate.approval.decision, "acceptForSession");
    assert.equal(duplicate.approval.decidedAt, 3000);
    assert.equal(events.filter((event) => event.type === "approval.updated").length, 1);
    assert.equal(
      store.getApprovalEvent("local", run.id, "approval-1")?.decision,
      "acceptForSession"
    );
  });
});

test("ApprovalService rejects invalid user decisions without mutating pending approval", () => {
  usingFixture(({ service, store, events, run }) => {
    seedPendingApproval(service, run.id, run.sessionId);

    assert.throws(
      () =>
        service.completePendingApproval({
          userId: "local",
          runId: run.id,
          approvalRequestId: "approval-1",
          decision: "cancel",
          decidedBy: "local"
        }),
      /approval_decision_invalid/
    );

    const approval = store.getApprovalEvent("local", run.id, "approval-1");
    assert.equal(approval?.status, "PENDING");
    assert.equal(events.filter((event) => event.type === "approval.updated").length, 0);
  });
});

test("ApprovalService supports system terminal decisions without user decision validation", () => {
  usingFixture(({ service, run }) => {
    seedPendingApproval(service, run.id, run.sessionId);

    const result = service.completePendingApproval({
      userId: "local",
      runId: run.id,
      approvalRequestId: "approval-1",
      decision: "bridge_disconnected",
      status: "FAILED",
      decidedBy: "system",
      reason: "bridge_runtime_disconnected",
      validateDecision: false
    });

    assert.equal(result.transitioned, true);
    assert.equal(result.approval.status, "FAILED");
    assert.equal(result.approval.decision, "bridge_disconnected");
    assert.equal(result.approval.decisionReason, "bridge_runtime_disconnected");
  });
});

test("ApprovalService preserves user isolation", () => {
  usingFixture(({ service, run }) => {
    seedPendingApproval(service, run.id, run.sessionId);

    assert.throws(
      () =>
        service.completePendingApproval({
          userId: "other",
          runId: run.id,
          approvalRequestId: "approval-1",
          decision: "accept",
          decidedBy: "other"
        }),
      /approval_request_not_found/
    );
  });
});

test("approval helper decisions are stable for timeout and structured values", () => {
  assert.equal(fallbackTimeoutDecision(["accept", "decline"], "commandExecution"), "decline");
  assert.equal(fallbackTimeoutDecision(["accept", "cancel"], "toolUserInput"), "cancel");
  assert.equal(
    decisionsEqual({ b: 2, a: 1 }, { a: 1, b: 2 }),
    true
  );
});

function seedPendingApproval(
  service: ApprovalService,
  runId: string,
  sessionId: string
): void {
  service.createPendingApproval({
    userId: "local",
    sessionId,
    runId,
    adapter: "codex",
    threadId: "thread-1",
    turnId: "turn-1",
    approvalRequestId: "approval-1",
    kind: "commandExecution",
    title: "npm test",
    payload: { command: "npm test" },
    availableDecisions: ["accept", "acceptForSession", "decline"],
    requestedAt: 1000,
    expiresAt: 2000
  });
}

function usingFixture(
  fn: (fixture: {
    store: BridgeStore;
    service: ApprovalService;
    events: BridgeRunStreamEvent[];
    run: { id: string; sessionId: string };
  }) => void
): void {
  const dir = mkdtempSync(join(tmpdir(), "surf-ai-approval-service-test-"));
  try {
    const store = new BridgeStore(join(dir, "test.sqlite"), [
      { id: "local", name: "Local" },
      { id: "other", name: "Other" }
    ]);
    const session = store.createSession("local", "approval test");
    const userMessage = store.appendMessage("local", session.id, "user", "Run a command");
    const run = store.createSessionRun({
      userId: "local",
      sessionId: session.id,
      adapter: "codex",
      status: "RUNNING",
      userMessageId: userMessage.id
    });
    const events: BridgeRunStreamEvent[] = [];
    const service = new ApprovalService(
      store,
      {
        publish(event) {
          events.push(event);
        }
      },
      { timeoutMs: 1000 }
    );

    fn({
      store,
      service,
      events,
      run: { id: run.id, sessionId: session.id }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
