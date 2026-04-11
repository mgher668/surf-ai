import type { BridgeRunStreamEvent } from "@surf-ai/shared";
import { BridgeStore } from "./store";
import { RunEventBus } from "./run-event-bus";
import { CodexAppServerRuntime } from "../runtimes/codex-app-server-runtime";
import type {
  RuntimeApprovalDecisionInput,
  RuntimeApprovalResult,
  RuntimeRunResult,
  RuntimeStartRunInput
} from "../runtimes/types";

export class RuntimeManager {
  private readonly codexRuntimes = new Map<string, CodexAppServerRuntime>();

  public constructor(
    private readonly store: BridgeStore,
    private readonly runEventBus: RunEventBus
  ) {}

  public subscribeRunEvents(
    userId: string,
    sessionId: string,
    runId: string,
    listener: (event: BridgeRunStreamEvent) => void,
    replay = true
  ): () => void {
    const seenEventIds = new Set<string>();
    if (replay) {
      const events = this.store.listRunEvents(userId, sessionId, runId);
      for (const event of events) {
        seenEventIds.add(event.eventId);
        listener(event);
      }
    }

    return this.runEventBus.subscribe(
      runId,
      (event) => {
        if (seenEventIds.has(event.eventId)) {
          return;
        }
        seenEventIds.add(event.eventId);
        listener(event);
      },
      true
    );
  }

  public runWithCodex(input: RuntimeStartRunInput): Promise<RuntimeRunResult> {
    const runtime = this.getOrCreateCodexRuntime(input.userId);
    return runtime.run(input);
  }

  public cancelCodexRun(userId: string, runId: string): Promise<void> {
    const runtime = this.getOrCreateCodexRuntime(userId);
    return runtime.cancelRun(userId, runId);
  }

  public submitCodexApprovalDecision(
    input: RuntimeApprovalDecisionInput
  ): Promise<RuntimeApprovalResult> {
    const runtime = this.getOrCreateCodexRuntime(input.userId);
    return runtime.submitApprovalDecision(input);
  }

  private getOrCreateCodexRuntime(userId: string): CodexAppServerRuntime {
    const existing = this.codexRuntimes.get(userId);
    if (existing) {
      return existing;
    }

    const runtime = new CodexAppServerRuntime(this.store, {
      publish: (event) => {
        this.store.appendRunEvent(userId, event);
        this.runEventBus.publish(event);
      }
    });
    this.codexRuntimes.set(userId, runtime);
    return runtime;
  }
}
