import type {
  BridgeApprovalKind,
  BridgeAdapter,
  BridgeChatRequest,
  ChatAttachment,
  BridgeRunApproval,
  BridgeRunStreamEvent
} from "@surf-ai/shared";

export interface RuntimeInputAttachment extends ChatAttachment {
  path: string;
}

export interface RuntimeStartRunInput {
  userId: string;
  sessionId: string;
  runId: string;
  adapter: BridgeAdapter;
  model?: string;
  modelReasoningEffort?: BridgeChatRequest["modelReasoningEffort"];
  content: string;
  attachments?: RuntimeInputAttachment[];
  context?: BridgeChatRequest["context"];
}

export interface RuntimeRunResult {
  threadId: string;
  turnId: string;
  output: string;
}

export interface RuntimeApprovalDecisionInput {
  userId: string;
  runId: string;
  approvalRequestId: string;
  decision: unknown;
  reason?: string;
  decidedBy: string;
}

export interface RuntimeApprovalRequest {
  userId: string;
  sessionId: string;
  runId: string;
  adapter: BridgeAdapter;
  threadId: string;
  turnId: string;
  approvalRequestId: string;
  kind: BridgeApprovalKind;
  title?: string;
  payload: Record<string, unknown>;
  availableDecisions: unknown[];
}

export interface RuntimeEventSink {
  publish(event: BridgeRunStreamEvent): void;
}

export interface RuntimeApprovalResult {
  approval: BridgeRunApproval;
}

export interface AgentRuntime {
  run(input: RuntimeStartRunInput): Promise<RuntimeRunResult>;
  cancelRun(userId: string, runId: string): Promise<void>;
  submitApprovalDecision(input: RuntimeApprovalDecisionInput): Promise<RuntimeApprovalResult>;
}
