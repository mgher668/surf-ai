export const BRIDGE_DEFAULT_BASE_URL = "http://127.0.0.1:43127";

export type QuickAction = "summarize" | "translate" | "read_aloud" | "ask";

export interface BridgeConnection {
  id: string;
  name: string;
  baseUrl: string;
  userId?: string;
  token?: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type SessionStatus = "ACTIVE" | "IDLE" | "RUNNING" | "ERROR";
export type SessionRunStatus =
  | "QUEUED"
  | "RUNNING"
  | "CANCELLING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";
export type BridgeAdapter =
  | "codex"
  | "claude"
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "mock";

export interface ChatSession {
  id: string;
  title: string;
  starred: boolean;
  lastAdapter?: BridgeAdapter;
  status?: SessionStatus;
  lastActiveAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  sessionId: string;
  seq?: number;
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

export interface PageContentPayload {
  pageTitle: string;
  pageUrl: string;
  text: string;
  source: "readability" | "dom";
  charCount: number;
  extractedAt: number;
}

export interface PageContentErrorPayload {
  message: string;
}

export type ExtensionToUiMessage =
  | {
      type: "selection_payload";
      payload: SelectionPayload;
    }
  | {
      type: "page_content_payload";
      payload: PageContentPayload;
    }
  | {
      type: "page_content_error";
      payload: PageContentErrorPayload;
    };

export type UiToExtensionMessage =
  | {
      type: "open_sidepanel_with_selection";
      payload: SelectionPayload;
    }
  | {
      type: "consume_pending_selection_payload";
      tabId?: number;
    }
  | {
      type: "extract_active_tab_content";
      maxChars?: number;
    }
  | {
      type: "set_status_badge";
      level: UiStatusBadgeLevel;
      text?: string;
    };

export interface UiToExtensionResponse {
  ok: boolean;
  payload?: PageContentPayload;
  selectionPayload?: SelectionPayload;
  error?: string;
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
  adapter: BridgeAdapter;
}

export interface BridgeModelsResponse {
  models: BridgeModel[];
}

export type LocalBridgeAdapter = Extract<BridgeModel["adapter"], "mock" | "codex" | "claude">;

export interface BridgeAdapterCapability {
  adapter: BridgeModel["adapter"];
  label: string;
  kind: "native" | "compatibility";
  enabled: boolean;
  routedTo?: LocalBridgeAdapter;
}

export interface BridgeCapabilitiesResponse {
  version: string;
  now: string;
  chat: {
    adapters: BridgeAdapterCapability[];
    defaultAdapter: LocalBridgeAdapter;
    supportsModelOverride: boolean;
  };
  tts: {
    minimax: {
      enabled: boolean;
      configured: boolean;
    };
  };
}

export interface BridgeChatRequest {
  adapter: BridgeAdapter;
  model?: string;
  sessionId: string;
  messages: Array<{ role: MessageRole; content: string }>;
  context?: {
    pageTitle?: string;
    pageUrl?: string;
    selectedText?: string;
    pageText?: string;
    pageTextSource?: PageContentPayload["source"];
  };
}

export interface BridgeChatResponse {
  output: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface BridgeSessionCreateRequest {
  title?: string;
}

export interface BridgeSessionCreateResponse {
  session: ChatSession;
}

export interface BridgeSessionListResponse {
  sessions: ChatSession[];
}

export interface BridgeSessionMessagesResponse {
  session: ChatSession;
  messages: ChatMessage[];
}

export interface BridgeSessionSendMessageRequest {
  adapter: BridgeAdapter;
  content: string;
  model?: string;
  context?: BridgeChatRequest["context"];
}

export interface BridgeSessionSendMessageResponse {
  session: ChatSession;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface BridgeSessionRun {
  id: string;
  sessionId: string;
  adapter: BridgeAdapter;
  status: SessionRunStatus;
  userMessageId: string;
  assistantMessageId?: string;
  errorMessage?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  updatedAt: number;
}

export interface BridgeSessionRunCreateRequest {
  adapter: BridgeAdapter;
  content: string;
  model?: string;
  context?: BridgeChatRequest["context"];
}

export interface BridgeSessionRunCreateResponse {
  session: ChatSession;
  run: BridgeSessionRun;
  userMessage: ChatMessage;
}

export interface BridgeSessionRunResponse {
  run: BridgeSessionRun;
}

export interface BridgeSessionRunsResponse {
  runs: BridgeSessionRun[];
}

export interface BridgeSessionRunCancelResponse {
  run: BridgeSessionRun;
}

export interface BridgeSessionStarRequest {
  starred: boolean;
}

export interface BridgeSessionAdapterRequest {
  adapter: BridgeAdapter;
}

export interface BridgeSessionAdapterResponse {
  session: ChatSession;
}

export interface BridgeSessionRenameRequest {
  title: string;
}

export interface BridgeSessionRenameResponse {
  session: ChatSession;
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

export type AuditLevel = "INFO" | "WARN" | "ERROR";

export interface BridgeAuditEvent {
  id: string;
  userId?: string;
  eventType: string;
  level: AuditLevel;
  route?: string;
  method?: string;
  statusCode?: number;
  ip?: string;
  details?: Record<string, unknown>;
  createdAt: number;
}

export interface BridgeAuditEventsResponse {
  events: BridgeAuditEvent[];
}

export type UiStatusBadgeLevel = "clear" | "warn" | "error";
export type UiThemeMode = "light" | "dark" | "system";

export const STORAGE_KEYS = {
  connections: "surf.connections",
  activeConnectionId: "surf.activeConnectionId",
  activeSessionId: "surf.activeSessionId",
  sessions: "surf.sessions",
  locale: "surf.locale",
  defaultAdapter: "surf.defaultAdapter",
  theme: "surf.theme"
} as const;
