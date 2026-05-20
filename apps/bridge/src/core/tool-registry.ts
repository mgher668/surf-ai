import type { BridgeToolDefinition } from "@surf-ai/shared";

export interface ToolRegistryOptions {
  minimaxTtsConfigured: boolean;
}

const STATIC_TOOLS: BridgeToolDefinition[] = [
  {
    id: "browser.selection.read",
    label: "Browser selection context",
    description: "Client-provided selected text with page title and URL.",
    scope: "client",
    risk: "low",
    availability: "available",
    metadataOnly: true,
    callable: false,
    requiresApproval: false,
    inputSource: "browser",
    outputKind: "context",
    tags: ["browser", "selection", "context"]
  },
  {
    id: "browser.page.extract_text",
    label: "Current tab full-page content",
    description: "Client-provided current-tab text extracted by the browser extension.",
    scope: "client",
    risk: "medium",
    availability: "available",
    metadataOnly: true,
    callable: false,
    requiresApproval: false,
    inputSource: "browser",
    outputKind: "context",
    tags: ["browser", "page", "context", "untrusted"]
  },
  {
    id: "session.context_preview",
    label: "Session context preview",
    description: "Read-only preview of retrieved context from the current Surf session.",
    scope: "session",
    risk: "low",
    availability: "available",
    metadataOnly: true,
    callable: false,
    requiresApproval: false,
    inputSource: "bridge",
    outputKind: "metadata",
    tags: ["session", "retrieval", "preview"]
  },
  {
    id: "media.upload_attachment",
    label: "Image attachment upload",
    description: "User-initiated image upload for chat messages.",
    scope: "client",
    risk: "medium",
    availability: "available",
    metadataOnly: true,
    callable: false,
    requiresApproval: false,
    inputSource: "user",
    outputKind: "artifact",
    tags: ["upload", "image", "attachment"]
  },
  {
    id: "runtime.approval_request",
    label: "Runtime approval request",
    description: "Runtime-native approval events for commands, file changes, permissions, and tool input.",
    scope: "approval",
    risk: "high",
    availability: "available",
    metadataOnly: true,
    callable: false,
    requiresApproval: true,
    inputSource: "runtime",
    outputKind: "approval",
    tags: ["codex", "approval", "runtime"]
  },
  {
    id: "runtime.event_timeline",
    label: "Run timeline export",
    description: "Read-only ordered run timeline with approvals and artifact metadata.",
    scope: "runtime",
    risk: "low",
    availability: "available",
    metadataOnly: true,
    callable: false,
    requiresApproval: false,
    inputSource: "bridge",
    outputKind: "metadata",
    tags: ["timeline", "events", "artifacts"]
  }
];

export class ToolRegistry {
  public constructor(private readonly options: ToolRegistryOptions) {}

  public listTools(): BridgeToolDefinition[] {
    const minimaxTool: BridgeToolDefinition = {
      id: "media.tts.minimax",
      label: "MiniMax text to speech",
      description: "Bridge-managed MiniMax TTS synthesis for read-aloud actions.",
      scope: "media",
      risk: "medium",
      availability: this.options.minimaxTtsConfigured ? "configured" : "unconfigured",
      metadataOnly: true,
      callable: false,
      requiresApproval: false,
      inputSource: "bridge",
      outputKind: "audio",
      tags: ["tts", "minimax", "audio"]
    };

    return [
      ...STATIC_TOOLS,
      minimaxTool
    ].map((tool) => ({ ...tool, tags: [...tool.tags] }));
  }

  public getTool(id: string): BridgeToolDefinition | undefined {
    const tool = this.listTools().find((item) => item.id === id);
    return tool ? { ...tool, tags: [...tool.tags] } : undefined;
  }
}
