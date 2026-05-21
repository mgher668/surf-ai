import type {
  BridgeAdapter,
  BridgeAdapterCapability,
  BridgeChatRequest,
  LocalBridgeAdapter
} from "@surf-ai/shared";
import type { AgentAdapter } from "../agents/types";
import { MockAdapter } from "../agents/mock-adapter";
import { CodexAdapter } from "../agents/codex-adapter";
import { ClaudeAdapter } from "../agents/claude-adapter";
import { OpenAICompatibleAdapter } from "../agents/openai-compatible-adapter";
import type { OpenAICompatibleConfig } from "./config";

const NATIVE_ADAPTERS: Array<{
  adapter: LocalBridgeAdapter;
  label: string;
}> = [
  { adapter: "mock", label: "Mock (local)" },
  { adapter: "codex", label: "Codex CLI" },
  { adapter: "claude", label: "Claude Code CLI" }
];

export class AdapterRegistry {
  private readonly adapters: Record<string, AgentAdapter>;

  public constructor(private readonly openai: OpenAICompatibleConfig) {
    const available = [
      new MockAdapter(),
      new CodexAdapter(),
      new ClaudeAdapter(),
      new OpenAICompatibleAdapter(openai)
    ];
    this.adapters = Object.fromEntries(available.map((adapter) => [adapter.name, adapter]));
  }

  public listNativeAdapters(): LocalBridgeAdapter[] {
    return NATIVE_ADAPTERS.map((item) => item.adapter);
  }

  public listAdapterCapabilities(defaultAdapter: LocalBridgeAdapter): BridgeAdapterCapability[] {
    const native = NATIVE_ADAPTERS.map((item) => ({
      adapter: item.adapter,
      label: item.label,
      kind: "native" as const,
      enabled: Boolean(this.adapters[item.adapter])
    }));

    const api: BridgeAdapterCapability[] = [
      {
        adapter: "openai-compatible",
        label: "OpenAI Compatible API",
        kind: "native",
        enabled: Boolean(this.openai.apiKey)
      }
    ];

    const compatibility: BridgeAdapterCapability[] = [
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

    return [...native, ...api, ...compatibility];
  }

  public resolveAdapterName(
    adapter: BridgeChatRequest["adapter"],
    fallback: LocalBridgeAdapter
  ): BridgeAdapter {
    if (adapter === "anthropic" || adapter === "gemini") {
      return fallback;
    }
    return adapter;
  }

  public getAdapter(name: BridgeAdapter): AgentAdapter | undefined {
    return this.adapters[name];
  }

  public async generate(
    request: BridgeChatRequest,
    fallback: "mock" | "codex" | "claude",
    signal?: AbortSignal
  ): Promise<string> {
    const adapterName = this.resolveAdapterName(request.adapter, fallback);

    const adapter = this.adapters[adapterName];
    if (!adapter) {
      throw new Error(`No adapter found for '${adapterName}'`);
    }

    return await adapter.generate(request, signal);
  }
}
