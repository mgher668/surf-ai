import type { BridgeRunStreamEvent, MessageRole } from "@surf-ai/shared";
import type { OpenAICompatibleConfig } from "../core/config";
import {
  OpenAICompatibleClient,
  type FetchLike,
  type OpenAICompatibleMessage
} from "../core/openai-compatible-client";
import { BridgeStore } from "../core/store";
import type {
  AgentRuntime,
  RuntimeApprovalDecisionInput,
  RuntimeApprovalResult,
  RuntimeEventSink,
  RuntimeRunResult,
  RuntimeStartRunInput
} from "./types";

interface OpenAICompatibleRuntimeOptions {
  fetchImpl?: FetchLike;
}

export class OpenAICompatibleRuntime implements AgentRuntime {
  private readonly client: OpenAICompatibleClient;
  private readonly activeRunControllers = new Map<string, AbortController>();

  public constructor(
    private readonly store: BridgeStore,
    private readonly eventSink: RuntimeEventSink,
    config: OpenAICompatibleConfig,
    options: OpenAICompatibleRuntimeOptions = {}
  ) {
    this.client = new OpenAICompatibleClient(config, options.fetchImpl);
  }

  public async run(input: RuntimeStartRunInput): Promise<RuntimeRunResult> {
    const threadId = `openai-compatible:${input.sessionId}`;
    const turnId = input.runId;
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(input.signal?.reason ?? "openai_run_aborted");
    if (input.signal?.aborted) {
      abortFromParent();
    } else {
      input.signal?.addEventListener("abort", abortFromParent, { once: true });
    }
    this.activeRunControllers.set(input.runId, controller);

    try {
      this.publish(input.sessionId, input.runId, "run.started", {
        run: this.requireRun(input.userId, input.runId),
        threadId,
        turnId
      });

      const history = this.store
        .listAllMessagesBySession(input.userId, input.sessionId)
        .map(toOpenAICompatibleMessage);
      const result = await this.client.generate({
        messages: history,
        ...(input.model ? { model: input.model } : {}),
        ...(input.context ? { context: input.context } : {}),
        signal: controller.signal,
        onDelta: (delta) => {
          this.publish(input.sessionId, input.runId, "assistant.delta", {
            delta,
            phase: "final_answer"
          });
        }
      });

      this.publish(input.sessionId, input.runId, "assistant.completed", {
        content: result.output,
        phase: "final_answer"
      });

      return {
        threadId,
        turnId,
        output: result.output
      };
    } finally {
      input.signal?.removeEventListener("abort", abortFromParent);
      this.activeRunControllers.delete(input.runId);
    }
  }

  public async cancelRun(_userId: string, runId: string): Promise<void> {
    this.activeRunControllers.get(runId)?.abort("openai_run_cancelled");
  }

  public async submitApprovalDecision(
    _input: RuntimeApprovalDecisionInput
  ): Promise<RuntimeApprovalResult> {
    throw new Error("approval_not_supported_for_openai_compatible");
  }

  private requireRun(userId: string, runId: string) {
    const run = this.store.getSessionRun(userId, runId);
    if (!run) {
      throw new Error("run_not_found");
    }
    return run;
  }

  private publish<Type extends BridgeRunStreamEvent["type"]>(
    sessionId: string,
    runId: string,
    type: Type,
    data: Extract<BridgeRunStreamEvent, { type: Type }>["data"]
  ): void {
    this.eventSink.publish({
      eventId: randomEventId(),
      sessionId,
      runId,
      type,
      ts: Date.now(),
      data
    } as Extract<BridgeRunStreamEvent, { type: Type }>);
  }
}

function toOpenAICompatibleMessage(message: {
  role: MessageRole;
  content: string;
}): OpenAICompatibleMessage {
  return {
    role: message.role === "system" || message.role === "assistant" ? message.role : "user",
    content: message.content
  };
}

function randomEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
