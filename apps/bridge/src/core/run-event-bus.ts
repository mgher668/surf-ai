import type { BridgeRunStreamEvent } from "@surf-ai/shared";

type RunEventListener = (event: BridgeRunStreamEvent) => void;

const MAX_HISTORY_PER_RUN = 600;

export class RunEventBus {
  private readonly listeners = new Map<string, Set<RunEventListener>>();
  private readonly history = new Map<string, BridgeRunStreamEvent[]>();

  public publish(event: BridgeRunStreamEvent): void {
    const runId = event.runId;
    const existing = this.history.get(runId) ?? [];
    const next =
      existing.length >= MAX_HISTORY_PER_RUN
        ? [...existing.slice(existing.length - MAX_HISTORY_PER_RUN + 1), event]
        : [...existing, event];
    this.history.set(runId, next);

    const listeners = this.listeners.get(runId);
    if (!listeners || listeners.size === 0) {
      return;
    }
    for (const listener of listeners) {
      listener(event);
    }
  }

  public subscribe(runId: string, listener: RunEventListener, replay = true): () => void {
    if (replay) {
      const previous = this.history.get(runId) ?? [];
      for (const event of previous) {
        listener(event);
      }
    }

    const group = this.listeners.get(runId) ?? new Set<RunEventListener>();
    group.add(listener);
    this.listeners.set(runId, group);

    return () => {
      const current = this.listeners.get(runId);
      if (!current) {
        return;
      }
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(runId);
      }
    };
  }

  public clear(runId: string): void {
    this.history.delete(runId);
    this.listeners.delete(runId);
  }
}
