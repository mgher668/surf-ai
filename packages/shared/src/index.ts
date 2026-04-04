export const BRIDGE_DEFAULT_BASE_URL = "http://127.0.0.1:43127";

export type QuickAction = "summarize" | "translate" | "read_aloud" | "ask";

export interface BridgeConnection {
  id: string;
  name: string;
  baseUrl: string;
  token?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
}

export interface SelectionPayload {
  action: QuickAction;
  text: string;
  pageTitle: string;
  pageUrl: string;
  createdAt: number;
}

export interface ExtensionToUiMessage {
  type: "selection_payload";
  payload: SelectionPayload;
}

export interface BridgeHealthResponse {
  ok: boolean;
  version: string;
  adapters: string[];
  now: string;
}

export interface BridgeModel {
  id: string;
  label: string;
  adapter: "codex" | "claude" | "openai-compatible" | "anthropic" | "gemini" | "mock";
}

export interface BridgeChatRequest {
  adapter: BridgeModel["adapter"];
  model?: string;
  sessionId: string;
  messages: Array<{ role: MessageRole; content: string }>;
  context?: {
    pageTitle?: string;
    pageUrl?: string;
    selectedText?: string;
  };
}

export interface BridgeChatResponse {
  output: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface BridgeTtsRequest {
  text: string;
  voiceId?: string;
}

export interface BridgeTtsResponse {
  audioUrl?: string;
  base64Audio?: string;
  mimeType?: string;
  provider?: "minimax";
  traceId?: string;
}

export const STORAGE_KEYS = {
  connections: "surf.connections",
  activeConnectionId: "surf.activeConnectionId",
  sessions: "surf.sessions",
  locale: "surf.locale"
} as const;
