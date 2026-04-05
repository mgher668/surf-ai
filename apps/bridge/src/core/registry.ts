import type {
  BridgeAdapterCapability,
  BridgeChatRequest,
  BridgeModel,
  LocalBridgeAdapter
} from "@surf-ai/shared";
import type { AgentAdapter } from "../agents/types";
import { MockAdapter } from "../agents/mock-adapter";
import { CodexAdapter } from "../agents/codex-adapter";
import { ClaudeAdapter } from "../agents/claude-adapter";

export class AdapterRegistry {
  private readonly adapters: Record<string, AgentAdapter>;
  private readonly models: BridgeModel[];

  public constructor() {
    const available = [new MockAdapter(), new CodexAdapter(), new ClaudeAdapter()];
    this.adapters = Object.fromEntries(available.map((adapter) => [adapter.name, adapter]));
    this.models = [
      { id: "mock/default", label: "Mock (local)", adapter: "mock" },
      { id: "codex/default", label: "Codex CLI", adapter: "codex" },
      { id: "claude/default", label: "Claude Code CLI", adapter: "claude" }
    ];
  }

  public listModels(): BridgeModel[] {
    return this.models;
  }

  public listAdapterCapabilities(defaultAdapter: LocalBridgeAdapter): BridgeAdapterCapability[] {
    const native = this.models.map((model) => ({
      adapter: model.adapter,
      label: model.label,
      kind: "native" as const,
      enabled: Boolean(this.adapters[model.adapter])
    }));

    const compatibility: BridgeAdapterCapability[] = [
      {
        adapter: "openai-compatible",
        label: "OpenAI Compatible (fallback)",
        kind: "compatibility",
        enabled: true,
        routedTo: defaultAdapter
      },
      {
        adapter: "anthropic",
        label: "Anthropic (fallback)",
        kind: "compatibility",
        enabled: true,
        routedTo: defaultAdapter
      },
      {
        adapter: "gemini",
        label: "Gemini (fallback)",
        kind: "compatibility",
        enabled: true,
        routedTo: defaultAdapter
      }
    ];

    return [...native, ...compatibility];
  }

  public resolveAdapterName(
    adapter: BridgeChatRequest["adapter"],
    fallback: LocalBridgeAdapter
  ): LocalBridgeAdapter {
    if (adapter === "openai-compatible" || adapter === "anthropic" || adapter === "gemini") {
      return fallback;
    }
    return adapter;
  }

  public getAdapter(name: LocalBridgeAdapter): AgentAdapter | undefined {
    return this.adapters[name];
  }

  public async generate(request: BridgeChatRequest, fallback: "mock" | "codex" | "claude"): Promise<string> {
    const adapterName = this.resolveAdapterName(request.adapter, fallback);

    const adapter = this.adapters[adapterName];
    if (!adapter) {
      throw new Error(`No adapter found for '${adapterName}'`);
    }

    return await adapter.generate(request);
  }
}
