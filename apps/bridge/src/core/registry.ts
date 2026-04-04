import type { BridgeChatRequest, BridgeModel } from "@surf-ai/shared";
import type { AgentAdapter } from "../agents/types";
import { MockAdapter } from "../agents/mock-adapter";
import { CodexAdapter } from "../agents/codex-adapter";
import { ClaudeAdapter } from "../agents/claude-adapter";

export class AdapterRegistry {
  private readonly adapters: Record<string, AgentAdapter>;

  public constructor() {
    const available = [new MockAdapter(), new CodexAdapter(), new ClaudeAdapter()];
    this.adapters = Object.fromEntries(available.map((adapter) => [adapter.name, adapter]));
  }

  public listModels(): BridgeModel[] {
    return [
      { id: "mock/default", label: "Mock (local)", adapter: "mock" },
      { id: "codex/default", label: "Codex CLI", adapter: "codex" },
      { id: "claude/default", label: "Claude Code CLI", adapter: "claude" }
    ];
  }

  public async generate(request: BridgeChatRequest, fallback: "mock" | "codex" | "claude"): Promise<string> {
    const adapterName = request.adapter === "openai-compatible" || request.adapter === "anthropic" || request.adapter === "gemini"
      ? fallback
      : request.adapter;

    const adapter = this.adapters[adapterName];
    if (!adapter) {
      throw new Error(`No adapter found for '${adapterName}'`);
    }

    return await adapter.generate(request);
  }
}
