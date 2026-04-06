import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@iconify/react/dist/offline";
import dotsVertical from "@iconify-icons/mdi/dots-vertical";
import cogOutline from "@iconify-icons/mdi/cog-outline";
import openInNew from "@iconify-icons/mdi/open-in-new";
import themeLightDark from "@iconify-icons/mdi/theme-light-dark";
import checkIcon from "@iconify-icons/mdi/check";
import starIcon from "@iconify-icons/mdi/star";
import starOutlineIcon from "@iconify-icons/mdi/star-outline";
import pencilOutline from "@iconify-icons/mdi/pencil-outline";
import deleteOutline from "@iconify-icons/mdi/delete-outline";
import { STORAGE_KEYS } from "@surf-ai/shared";
import type {
  BridgeAuditEvent,
  BridgeAuditEventsResponse,
  BridgeCapabilitiesResponse,
  BridgeChatRequest,
  BridgeConnection,
  BridgeModel,
  BridgeModelsResponse,
  BridgeSessionCreateResponse,
  BridgeSessionListResponse,
  BridgeSessionAdapterRequest,
  BridgeSessionAdapterResponse,
  BridgeSessionMessagesResponse,
  BridgeSessionRenameRequest,
  BridgeSessionRenameResponse,
  BridgeSessionSendMessageResponse,
  BridgeSessionStarRequest,
  ChatMessage,
  ChatSession,
  ExtensionToUiMessage,
  BridgeTtsResponse,
  PageContentPayload,
  QuickAction,
  SelectionPayload,
  UiThemeMode,
  UiStatusBadgeLevel,
  UiToExtensionMessage,
  UiToExtensionResponse
} from "@surf-ai/shared";
import { deleteMessagesBySession, listMessagesBySession, saveMessage, saveMessages } from "../../lib/db";
import {
  getActiveConnectionId,
  getDefaultAdapter,
  getConnections,
  getLocale,
  getTheme,
  getSessions,
  onStorageChanged,
  setSessions,
  setTheme
} from "../../lib/storage";
import { type Locale, resolveLocale, t } from "../common/i18n";
import { applyTheme, listenSystemThemeChange, normalizeThemeMode } from "../common/theme";
import { MarkdownMessage } from "./MarkdownMessage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Separator } from "../components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "../components/ui/dialog";

const ACTION_PROMPT_PREFIX: Record<QuickAction, string> = {
  summarize: "Please summarize this content:",
  translate: "Please translate this content into Chinese and English:",
  read_aloud: "Please prepare this content for read-aloud:",
  ask: "Please help answer based on this content:"
};

const FALLBACK_ADAPTER_OPTIONS: BridgeModel["adapter"][] = ["mock", "codex", "claude"];
const BACKEND_DRAFT_SESSION_ID = "__backend_draft__";
type SessionMode = "backend" | "local";
type RuntimeAlertLevel = "warn" | "error";
type RuntimeAlertCode =
  | "backend_unreachable"
  | "auth_failed"
  | "rate_limited"
  | "bridge_request_failed";

interface RuntimeAlert {
  code: RuntimeAlertCode;
  level: RuntimeAlertLevel;
  message: string;
  statusCode?: number;
  updatedAt: number;
}

export function App(): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(navigator.language));
  const [themeMode, setThemeModeState] = useState<UiThemeMode>("system");

  const [connections, setConnectionsState] = useState<BridgeConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | undefined>();
  const [defaultAdapter, setDefaultAdapterState] = useState<BridgeChatRequest["adapter"] | undefined>();
  const [sessions, setSessionsState] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [sessionMode, setSessionMode] = useState<SessionMode>("local");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [adapter, setAdapter] = useState<BridgeChatRequest["adapter"]>("mock");
  const [capabilities, setCapabilities] = useState<BridgeCapabilitiesResponse | undefined>();
  const [capabilitiesError, setCapabilitiesError] = useState<string | undefined>();
  const [runtimeAlert, setRuntimeAlert] = useState<RuntimeAlert | undefined>();
  const [recentAuditEvents, setRecentAuditEvents] = useState<BridgeAuditEvent[]>([]);
  const [pending, setPending] = useState(false);
  const [extractingPage, setExtractingPage] = useState(false);
  const [extractError, setExtractError] = useState<string | undefined>();
  const [pageContent, setPageContent] = useState<PageContentPayload | undefined>();
  const [includePageContext, setIncludePageContext] = useState(false);
  const [selectionContext, setSelectionContext] = useState<SelectionPayload | undefined>();
  const [rawViewByMessageId, setRawViewByMessageId] = useState<Record<string, boolean>>({});
  const [hoverSessionId, setHoverSessionId] = useState<string | undefined>();
  const [truncatedTitleSessionId, setTruncatedTitleSessionId] = useState<string | undefined>();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTargetSession, setRenameTargetSession] = useState<ChatSession | null>(null);
  const [renameTitleInput, setRenameTitleInput] = useState("");
  const [renameError, setRenameError] = useState<string | undefined>();
  const [loadedMessagesSessionId, setLoadedMessagesSessionId] = useState<string | undefined>();
  const conversationViewportRef = useRef<HTMLElement | null>(null);
  const pendingAutoScrollSessionIdRef = useRef<string | undefined>(undefined);

  const isBackendDraftActive =
    sessionMode === "backend" && activeSessionId === BACKEND_DRAFT_SESSION_ID;

  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId),
    [connections, activeConnectionId]
  );

  const availableAdapters = useMemo(() => {
    const serverAdapters = capabilities?.chat.adapters.filter((item) => item.enabled);
    if (serverAdapters && serverAdapters.length > 0) {
      return serverAdapters.map((item) => ({ adapter: item.adapter, label: item.label }));
    }
    return FALLBACK_ADAPTER_OPTIONS.map((item) => ({ adapter: item, label: item }));
  }, [capabilities]);

  const ttsReady = useMemo(() => {
    if (!capabilities) {
      return true;
    }
    return capabilities.tts.minimax.enabled && capabilities.tts.minimax.configured;
  }, [capabilities]);

  const reportRuntimeAlert = (
    code: RuntimeAlertCode,
    level: RuntimeAlertLevel,
    message: string,
    statusCode?: number
  ): void => {
    setRuntimeAlert((previous) => {
      if (
        previous &&
        previous.code === code &&
        previous.level === level &&
        previous.message === message &&
        previous.statusCode === statusCode
      ) {
        return previous;
      }
      return {
        code,
        level,
        message,
        ...(typeof statusCode === "number" ? { statusCode } : {}),
        updatedAt: Date.now()
      };
    });
  };

  const clearRuntimeAlert = (): void => {
    setRuntimeAlert(undefined);
  };

  useEffect(() => {
    void bootstrap();
    void consumePendingSelectionPayload();

    const removeStorageListener = onStorageChanged((changes) => {
      const localeChange = changes[STORAGE_KEYS.locale];
      if (localeChange) {
        const nextLocale = localeChange.newValue as string | undefined;
        setLocaleState(resolveLocale(nextLocale || navigator.language));
      }

      const defaultAdapterChange = changes[STORAGE_KEYS.defaultAdapter];
      if (defaultAdapterChange) {
        const nextDefaultAdapter = defaultAdapterChange.newValue as
          | BridgeChatRequest["adapter"]
          | undefined;
        setDefaultAdapterState(nextDefaultAdapter);
      }

      const themeChange = changes[STORAGE_KEYS.theme];
      if (themeChange) {
        const nextTheme = normalizeThemeMode(themeChange.newValue as string | undefined);
        setThemeModeState(nextTheme);
      }

      const connectionChanged =
        Boolean(changes[STORAGE_KEYS.connections]) ||
        Boolean(changes[STORAGE_KEYS.activeConnectionId]);
      if (connectionChanged) {
        void bootstrapConnectionsAndSessions();
      }
    });

    const messageListener = (message: ExtensionToUiMessage) => {
      if (message?.type === "selection_payload") {
        applySelectionPayload(message.payload);
        return;
      }

      if (message?.type === "page_content_payload") {
        setPageContent(message.payload);
        setExtractError(undefined);
        setIncludePageContext(false);
        return;
      }

      if (message?.type === "page_content_error") {
        setExtractError(message.payload.message);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      removeStorageListener();
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, []);

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") {
      return;
    }
    return listenSystemThemeChange(() => {
      applyTheme("system");
    });
  }, [themeMode]);

  async function consumePendingSelectionPayload(): Promise<void> {
    try {
      const activeTab = await getActiveTab();
      const request: UiToExtensionMessage = {
        type: "consume_pending_selection_payload",
        ...(activeTab?.id ? { tabId: activeTab.id } : {})
      };
      const response = (await chrome.runtime.sendMessage(request)) as UiToExtensionResponse;
      if (response?.ok && response.selectionPayload) {
        applySelectionPayload(response.selectionPayload);
      }
    } catch {
      // Ignore; sidepanel can still receive live runtime messages.
    }
  }

  function applySelectionPayload(payload: SelectionPayload): void {
    const text = `${ACTION_PROMPT_PREFIX[payload.action]}\n\n${payload.text}`;
    setInput(text);
    setSelectionContext(payload);
    setPageContent(undefined);
    setExtractError(undefined);
    setIncludePageContext(false);
    if (payload.action === "read_aloud") {
      void requestTts(payload.text);
    }
  }

  useEffect(() => {
    if (!activeSessionId || isBackendDraftActive) {
      setMessages([]);
      setLoadedMessagesSessionId(undefined);
      setRawViewByMessageId({});
      setSelectionContext(undefined);
      setPageContent(undefined);
      setExtractError(undefined);
      setIncludePageContext(false);
      return;
    }

    setRawViewByMessageId({});
    setSelectionContext(undefined);
    setPageContent(undefined);
    setExtractError(undefined);
    setIncludePageContext(false);
  }, [activeSessionId, isBackendDraftActive]);

  useEffect(() => {
    if (!activeSessionId || isBackendDraftActive) {
      pendingAutoScrollSessionIdRef.current = undefined;
      return;
    }
    pendingAutoScrollSessionIdRef.current = activeSessionId;
  }, [activeSessionId, isBackendDraftActive]);

  useEffect(() => {
    const pendingSessionId = pendingAutoScrollSessionIdRef.current;
    if (!pendingSessionId || !activeSessionId || pendingSessionId !== activeSessionId || isBackendDraftActive) {
      return;
    }

    if (loadedMessagesSessionId !== activeSessionId) {
      return;
    }

    // Wait until messages belong to the current session to avoid scrolling on stale content.
    if (messages.length > 0 && messages[messages.length - 1]?.sessionId !== activeSessionId) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const viewport = conversationViewportRef.current;
      if (!viewport) {
        return;
      }
      viewport.scrollTop = viewport.scrollHeight;
      if (pendingAutoScrollSessionIdRef.current === activeSessionId) {
        pendingAutoScrollSessionIdRef.current = undefined;
      }
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [messages, activeSessionId, isBackendDraftActive, loadedMessagesSessionId]);

  function toggleRawView(messageId: string): void {
    setRawViewByMessageId((previous) => ({
      ...previous,
      [messageId]: !previous[messageId]
    }));
  }

  function openRenameDialog(session: ChatSession): void {
    setRenameTargetSession(session);
    setRenameTitleInput(session.title);
    setRenameError(undefined);
    setRenameDialogOpen(true);
  }

  function closeRenameDialog(): void {
    setRenameDialogOpen(false);
    setRenameTargetSession(null);
    setRenameTitleInput("");
    setRenameError(undefined);
  }

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    if (sessionMode === "backend" && activeSessionId === BACKEND_DRAFT_SESSION_ID) {
      return;
    }
    const sessionId = activeSessionId;
    let cancelled = false;
    setLoadedMessagesSessionId(undefined);

    const load = async (): Promise<void> => {
      if (sessionMode === "backend" && activeConnection) {
        const loadedMessages = await loadMessagesFromBackend(activeConnection, sessionId);
        if (cancelled) {
          return;
        }
        setMessages(loadedMessages);
        setLoadedMessagesSessionId(sessionId);
        return;
      }

      const loadedMessages = await listMessagesBySession(sessionId);
      if (cancelled) {
        return;
      }
      setMessages(loadedMessages);
      setLoadedMessagesSessionId(sessionId);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, activeConnection?.baseUrl, activeSessionId, sessionMode]);

  useEffect(() => {
    void bootstrapCapabilities(activeConnection);
  }, [activeConnection]);

  useEffect(() => {
    const level: UiStatusBadgeLevel =
      runtimeAlert?.level === "error"
        ? "error"
        : runtimeAlert?.level === "warn"
          ? "warn"
          : "clear";

    void chrome.runtime
      .sendMessage({
        type: "set_status_badge",
        level,
        ...(level !== "clear" ? { text: "!" } : {})
      } satisfies UiToExtensionMessage)
      .catch(() => undefined);
  }, [runtimeAlert?.code, runtimeAlert?.level]);

  useEffect(() => {
    if (!runtimeAlert || !activeConnection) {
      setRecentAuditEvents([]);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      const response = await fetchBridgeJson<BridgeAuditEventsResponse>(
        activeConnection,
        "/audit/events?limit=5"
      ).catch(() => ({ ok: false as const, status: 0 }));

      if (cancelled || !response.ok) {
        return;
      }

      setRecentAuditEvents(response.data.events);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [runtimeAlert?.code, activeConnection?.id, activeConnection?.baseUrl, activeConnection?.userId, activeConnection?.token]);

  useEffect(() => {
    if (sessionMode !== "backend" || !activeConnection) {
      return;
    }

    let stopped = false;

    const sync = async (): Promise<void> => {
      const backendSessions = await fetchSessionsFromBackend(activeConnection);
      if (stopped || !backendSessions) {
        return;
      }

      setSessionsState((prev) => {
        const mergedSessions = mergeSessionsWithLocalAdapters(prev, backendSessions);
        if (areSessionListsEqual(prev, mergedSessions)) {
          return prev;
        }
        void setSessions(mergedSessions);
        return mergedSessions;
      });
      setActiveSessionId((current) => {
        if (current === BACKEND_DRAFT_SESSION_ID) {
          return BACKEND_DRAFT_SESSION_ID;
        }
        if (current && backendSessions.some((item) => item.id === current)) {
          return current;
        }
        return backendSessions[0]?.id ?? BACKEND_DRAFT_SESSION_ID;
      });
    };

    void sync();
    const timer = window.setInterval(() => {
      void sync();
    }, 5_000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [
    sessionMode,
    activeConnection?.id,
    activeConnection?.baseUrl,
    activeConnection?.userId,
    activeConnection?.token
  ]);

  useEffect(() => {
    const isCurrentAdapterAvailable = availableAdapters.some((item) => item.adapter === adapter);
    if (isCurrentAdapterAvailable) {
      return;
    }

    const preferredAdapter = defaultAdapter ?? capabilities?.chat.defaultAdapter;
    if (preferredAdapter && availableAdapters.some((item) => item.adapter === preferredAdapter)) {
      setAdapter(preferredAdapter);
      return;
    }

    if (availableAdapters[0]) {
      setAdapter(availableAdapters[0].adapter);
    }
  }, [adapter, availableAdapters, capabilities, defaultAdapter]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === BACKEND_DRAFT_SESSION_ID) {
      return;
    }
    const activeSession = sessions.find((item) => item.id === activeSessionId);
    const lastAdapter = activeSession?.lastAdapter;
    if (!lastAdapter) {
      return;
    }
    if (!availableAdapters.some((item) => item.adapter === lastAdapter)) {
      return;
    }
    if (adapter === lastAdapter) {
      return;
    }
    setAdapter(lastAdapter);
  }, [activeSessionId, sessions, availableAdapters, adapter]);

  async function bootstrap(): Promise<void> {
    const [storedLocale, storedDefaultAdapter, storedTheme] = await Promise.all([
      getLocale(),
      getDefaultAdapter(),
      getTheme()
    ]);
    if (storedLocale) {
      setLocaleState(resolveLocale(storedLocale));
    }
    setDefaultAdapterState(storedDefaultAdapter);
    setThemeModeState(normalizeThemeMode(storedTheme));

    await bootstrapConnectionsAndSessions();
  }

  async function bootstrapConnectionsAndSessions(): Promise<void> {
    const [storedConnections, storedActiveConnectionId, storedSessions] = await Promise.all([
      getConnections(),
      getActiveConnectionId(),
      getSessions()
    ]);

    const preferredActiveConnectionId = storedActiveConnectionId ?? storedConnections[0]?.id;
    const resolvedActiveConnection =
      storedConnections.find((item) => item.id === preferredActiveConnectionId) ?? storedConnections[0];
    const resolvedActiveConnectionId = resolvedActiveConnection?.id;

    setConnectionsState(storedConnections);
    setActiveConnectionIdState(resolvedActiveConnectionId);

    if (resolvedActiveConnection) {
      const backendSessions = await fetchSessionsFromBackend(resolvedActiveConnection);
      setSessionMode("backend");
      if (backendSessions) {
        const mergedSessions = mergeSessionsWithLocalAdapters(storedSessions, backendSessions);
        await setSessions(mergedSessions);
        setSessionsState(mergedSessions);
        setActiveSessionId((current) => {
          if (current === BACKEND_DRAFT_SESSION_ID) {
            return BACKEND_DRAFT_SESSION_ID;
          }
          if (current && mergedSessions.some((item) => item.id === current)) {
            return current;
          }
          return mergedSessions[0]?.id ?? BACKEND_DRAFT_SESSION_ID;
        });
      } else {
        setSessionsState(storedSessions);
        setActiveSessionId((current) => {
          if (current === BACKEND_DRAFT_SESSION_ID) {
            return BACKEND_DRAFT_SESSION_ID;
          }
          if (current && storedSessions.some((item) => item.id === current)) {
            return current;
          }
          return storedSessions[0]?.id ?? BACKEND_DRAFT_SESSION_ID;
        });
      }
      return;
    }

    setSessionMode("local");

    if (storedSessions.length === 0) {
      const first = createSession("New chat");
      await setSessions([first]);
      setSessionsState([first]);
      setActiveSessionId(first.id);
      return;
    }

    setSessionsState(storedSessions);
    setActiveSessionId((current) => current ?? storedSessions[0]?.id);
  }

  async function bootstrapCapabilities(connection: BridgeConnection | undefined): Promise<void> {
    if (!connection) {
      setCapabilities(undefined);
      setCapabilitiesError(undefined);
      return;
    }

    try {
      const capabilityResponse = await fetchBridgeJson<BridgeCapabilitiesResponse>(
        connection,
        "/capabilities"
      );
      if (capabilityResponse.ok) {
        setCapabilities(capabilityResponse.data);
        setCapabilitiesError(undefined);
        clearRuntimeAlert();
        return;
      }

      if (capabilityResponse.status === 401 || capabilityResponse.status === 403) {
        reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), capabilityResponse.status);
      } else if (capabilityResponse.status === 429) {
        reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), capabilityResponse.status);
      } else {
        reportRuntimeAlert(
          "bridge_request_failed",
          "warn",
          `${t(locale, "alertBridgeRequestFailed")} (${capabilityResponse.status})`,
          capabilityResponse.status
        );
      }

      if (capabilityResponse.status !== 404) {
        throw new Error(`capabilities_request_failed:${capabilityResponse.status}`);
      }

      const modelsResponse = await fetchBridgeJson<BridgeModelsResponse>(connection, "/models");
      if (!modelsResponse.ok) {
        throw new Error(`models_request_failed:${modelsResponse.status}`);
      }

      const adapterSet = new Set<BridgeChatRequest["adapter"]>(
        modelsResponse.data.models.map((item) => item.adapter)
      );
      const adapters = FALLBACK_ADAPTER_OPTIONS.filter((item) => adapterSet.has(item)).map((item) => ({
        adapter: item,
        label: item,
        kind: "native" as const,
        enabled: true
      }));

      setCapabilities({
        version: "legacy",
        now: new Date().toISOString(),
        chat: {
          adapters,
          defaultAdapter: adapters[0]?.adapter === "codex" || adapters[0]?.adapter === "claude"
            ? adapters[0].adapter
            : "mock",
          supportsModelOverride: false
        },
        tts: {
          minimax: {
            enabled: true,
            configured: true
          }
        }
      });
      setCapabilitiesError(undefined);
      clearRuntimeAlert();
    } catch (error) {
      setCapabilities(undefined);
      setCapabilitiesError(error instanceof Error ? error.message : "capabilities_unavailable");
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
    }
  }

  async function fetchSessionsFromBackend(connection: BridgeConnection): Promise<ChatSession[] | null> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await fetchBridgeJson<BridgeSessionListResponse>(connection, "/sessions");
        if (response.ok) {
          clearRuntimeAlert();
          return response.data.sessions;
        }
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
          return null;
        }
        if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${response.status})`,
            response.status
          );
        }
      } catch {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }

      if (attempt < maxAttempts - 1) {
        await sleep(300 * (attempt + 1));
      }
    }
    return null;
  }

  async function loadMessagesFromBackend(
    connection: BridgeConnection,
    sessionId: string
  ): Promise<ChatMessage[]> {
    try {
      const response = await fetchBridgeJson<BridgeSessionMessagesResponse>(
        connection,
        `/sessions/${sessionId}/messages?afterSeq=0&limit=500`
      );
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${response.status})`,
            response.status
          );
        }
        throw new Error(`messages_request_failed:${response.status}`);
      }
      await saveMessages(response.data.messages);
      clearRuntimeAlert();
      return response.data.messages;
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
      return [
        {
          id: crypto.randomUUID(),
          sessionId,
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "load_messages_failed"}`,
          createdAt: Date.now()
        }
      ];
    }
  }

  async function createSessionOnBackend(connection: BridgeConnection, title: string): Promise<ChatSession | null> {
    try {
      const response = await fetch(`${connection.baseUrl}/sessions`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify({ title })
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${response.status})`,
            response.status
          );
        }
        return null;
      }
      const payload = (await response.json()) as BridgeSessionCreateResponse;
      clearRuntimeAlert();
      return payload.session;
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      return null;
    }
  }

  async function updateSessionStarOnBackend(
    connection: BridgeConnection,
    sessionId: string,
    starred: boolean
  ): Promise<ChatSession | null> {
    try {
      const body: BridgeSessionStarRequest = { starred };
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/star`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        }
        return null;
      }
      const payload = (await response.json()) as { session: ChatSession };
      clearRuntimeAlert();
      return payload.session;
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      return null;
    }
  }

  async function updateSessionAdapterOnBackend(
    connection: BridgeConnection,
    sessionId: string,
    nextAdapter: BridgeChatRequest["adapter"]
  ): Promise<ChatSession | null> {
    try {
      const body: BridgeSessionAdapterRequest = { adapter: nextAdapter };
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/adapter`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        }
        return null;
      }
      const payload = (await response.json()) as BridgeSessionAdapterResponse;
      clearRuntimeAlert();
      return payload.session;
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      return null;
    }
  }

  async function renameSessionOnBackend(
    connection: BridgeConnection,
    sessionId: string,
    title: string
  ): Promise<ChatSession | null> {
    try {
      const body: BridgeSessionRenameRequest = { title };
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}`, {
        method: "PATCH",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${response.status})`,
            response.status
          );
        }
        return null;
      }
      const payload = (await response.json()) as BridgeSessionRenameResponse;
      clearRuntimeAlert();
      return payload.session;
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      return null;
    }
  }

  async function deleteSessionOnBackend(connection: BridgeConnection, sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}`, {
        method: "DELETE",
        headers: buildBridgeHeaders(connection)
      });
      if (response.ok) {
        clearRuntimeAlert();
        return true;
      }
      if (response.status === 401 || response.status === 403) {
        reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
      } else if (response.status === 429) {
        reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
      }
      return false;
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      return false;
    }
  }

  async function createNewSession(): Promise<void> {
    if (sessionMode === "backend") {
      setActiveSessionId(BACKEND_DRAFT_SESSION_ID);
      setMessages([]);
      setSelectionContext(undefined);
      setPageContent(undefined);
      setExtractError(undefined);
      setIncludePageContext(false);
      return;
    }

    const session = createSession(`Chat ${sessions.length + 1}`);
    const next = [session, ...sessions];
    await setSessions(next);
    setSessionsState(next);
    setActiveSessionId(session.id);
  }

  function rememberSessionAdapter(sessionId: string, nextAdapter: BridgeChatRequest["adapter"]): void {
    if (sessionId === BACKEND_DRAFT_SESSION_ID) {
      return;
    }
    setSessionsState((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.id !== sessionId || item.lastAdapter === nextAdapter) {
          return item;
        }
        changed = true;
        return {
          ...item,
          lastAdapter: nextAdapter
        };
      });
      if (!changed) {
        return prev;
      }
      void setSessions(next);
      return next;
    });
  }

  async function toggleStarSession(id: string): Promise<void> {
    if (sessionMode === "backend" && activeConnection) {
      const current = sessions.find((item) => item.id === id);
      if (!current) {
        return;
      }
      const updated = await updateSessionStarOnBackend(activeConnection, id, !current.starred);
      if (updated) {
        setSessionsState((prev) => {
          const next = prev.map((item) => (item.id === id ? updated : item));
          void setSessions(next);
          return next;
        });
      }
      return;
    }

    const next = sessions.map((item) => (item.id === id ? { ...item, starred: !item.starred, updatedAt: Date.now() } : item));
    await setSessions(next);
    setSessionsState(next);
  }

  async function renameSession(session: ChatSession, title: string): Promise<boolean> {
    if (!title || title === session.title) {
      return true;
    }

    if (sessionMode === "backend") {
      if (!activeConnection) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? session.id,
            role: "assistant",
            content: "Error: no active bridge connection. Please add/select one in Settings first.",
            createdAt: Date.now()
          }
        ]);
        return false;
      }

      const updated = await renameSessionOnBackend(activeConnection, session.id, title);
      if (!updated) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? session.id,
            role: "assistant",
            content: `${t(locale, "renameSessionFailed")}.`,
            createdAt: Date.now()
          }
        ]);
        return false;
      }

      setSessionsState((prev) => {
        const next = prev.map((item) => (item.id === session.id ? updated : item));
        void setSessions(next);
        return next;
      });
      return true;
    }

    const next = sessions.map((item) =>
      item.id === session.id
        ? {
            ...item,
            title,
            updatedAt: Date.now()
          }
        : item
    );
    await setSessions(next);
    setSessionsState(next);
    return true;
  }

  async function submitRenameDialog(): Promise<void> {
    if (!renameTargetSession) {
      closeRenameDialog();
      return;
    }

    const title = renameTitleInput.trim();
    if (!title) {
      setRenameError(t(locale, "renameSessionEmpty"));
      return;
    }
    if (title.length > 120) {
      setRenameError(t(locale, "renameSessionTooLong"));
      return;
    }

    const renamed = await renameSession(renameTargetSession, title);
    if (!renamed) {
      setRenameError(t(locale, "renameSessionFailed"));
      return;
    }

    closeRenameDialog();
  }

  async function deleteSession(id: string): Promise<void> {
    const confirmed = window.confirm(t(locale, "deleteSessionConfirm"));
    if (!confirmed) {
      return;
    }

    if (sessionMode === "backend") {
      if (!activeConnection) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? "pending",
            role: "assistant",
            content: "Error: no active bridge connection. Please add/select one in Settings first.",
            createdAt: Date.now()
          }
        ]);
        return;
      }
      const deleted = await deleteSessionOnBackend(activeConnection, id);
      if (!deleted) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? "pending",
            role: "assistant",
            content: "Error: failed to delete backend session.",
            createdAt: Date.now()
          }
        ]);
        return;
      }

      await deleteMessagesBySession(id).catch(() => undefined);
      setSessionsState((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        void setSessions(filtered);
        return filtered;
      });
      setActiveSessionId(BACKEND_DRAFT_SESSION_ID);
      return;
    }

    await deleteMessagesBySession(id).catch(() => undefined);
    const replacement = createSession("New chat");
    const filtered = sessions.filter((item) => item.id !== id);
    const next = [replacement, ...filtered];
    await setSessions(next);
    setSessionsState(next);
    setActiveSessionId(replacement.id);
  }

  async function send(): Promise<void> {
    const content = input.trim();
    if (!content) {
      return;
    }
    if (!activeConnection) {
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId ?? "pending",
        role: "assistant",
        content: "Error: no active bridge connection. Please add/select one in Settings first.",
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, errMessage]);
      return;
    }

    if (sessionMode === "backend") {
      let sessionId = activeSessionId;
      if (!sessionId || sessionId === BACKEND_DRAFT_SESSION_ID) {
        const created = await createSessionOnBackend(activeConnection, "New chat");
        if (!created) {
          const errMessage: ChatMessage = {
            id: crypto.randomUUID(),
            sessionId: "pending",
            role: "assistant",
            content: "Error: no active backend session and failed to create one.",
            createdAt: Date.now()
          };
          setMessages((prev) => [...prev, errMessage]);
          return;
        }

        setSessionsState((prev) => {
          const next = [created, ...prev];
          void setSessions(next);
          return next;
        });
        setActiveSessionId(created.id);
        sessionId = created.id;
      }

      await sendWithBackend(activeConnection, sessionId, content);
      return;
    }

    if (!activeSessionId) {
      const session = createSession("New chat");
      const next = [session, ...sessions];
      await setSessions(next);
      setSessionsState(next);
      setActiveSessionId(session.id);
      await sendWithBackend(activeConnection, session.id, content);
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      role: "user",
      content,
      createdAt: Date.now()
    };

    await saveMessage(userMessage);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPending(true);

    try {
      const context = buildChatContext(selectionContext, pageContent, includePageContext);

      const requestPayload: BridgeChatRequest = {
        adapter,
        sessionId: activeSessionId,
        messages: [...messages, userMessage].map((item) => ({
          role: item.role,
          content: item.content
        }))
      };
      if (Object.keys(context).length > 0) {
        requestPayload.context = context;
      }

      const response = await fetch(`${activeConnection.baseUrl}/chat`, {
        method: "POST",
        headers: buildBridgeHeaders(activeConnection, true),
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${response.status})`,
            response.status
          );
        }
        const failedText = await response.text();
        throw new Error(`Bridge request failed: ${response.status} ${failedText}`);
      }

      const result = (await response.json()) as { output: string };
      clearRuntimeAlert();

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: "assistant",
        content: result.output,
        createdAt: Date.now()
      };

      await saveMessage(assistantMessage);
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      await saveMessage(errMessage);
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
      setPageContent(undefined);
      setExtractError(undefined);
      setIncludePageContext(false);
    }
  }

  async function sendWithBackend(
    connection: BridgeConnection,
    sessionId: string,
    content: string
  ): Promise<void> {
    setPending(true);

    try {
      const context = buildChatContext(selectionContext, pageContent, includePageContext);
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify({
          adapter,
          content,
          ...(Object.keys(context).length > 0 ? { context } : {})
        })
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), response.status);
        } else if (response.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), response.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${response.status})`,
            response.status
          );
        }
        const failedText = await response.text();
        throw new Error(`Bridge session message failed: ${response.status} ${failedText}`);
      }

      const payload = (await response.json()) as BridgeSessionSendMessageResponse;
      clearRuntimeAlert();
      setInput("");
      setMessages((prev) => [...prev, payload.userMessage, payload.assistantMessage]);
      await saveMessages([payload.userMessage, payload.assistantMessage]);
      setSessionsState((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === payload.session.id);
        const next =
          existingIndex >= 0
            ? prev.map((item) => (item.id === payload.session.id ? payload.session : item))
            : [payload.session, ...prev];
        void setSessions(next);
        return next;
      });
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
      setPageContent(undefined);
      setExtractError(undefined);
      setIncludePageContext(false);
    }
  }

  async function requestTts(text: string): Promise<void> {
    if (!activeConnection || !ttsReady) return;

    try {
      const response = await fetch(`${activeConnection.baseUrl}/tts`, {
        method: "POST",
        headers: buildBridgeHeaders(activeConnection, true),
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as BridgeTtsResponse;
      const playbackUrl =
        payload.audioUrl ??
        (payload.base64Audio
          ? `data:${payload.mimeType ?? "audio/mpeg"};base64,${payload.base64Audio}`
          : undefined);

      if (!playbackUrl) {
        return;
      }

      const audio = new Audio(playbackUrl);
      void audio.play();
    } catch {
      // Keep silent for skeleton: chat flow should continue even if TTS is unavailable.
    }
  }

  async function extractCurrentPage(): Promise<void> {
    setExtractingPage(true);
    setExtractError(undefined);

    try {
      const request: UiToExtensionMessage = {
        type: "extract_active_tab_content",
        maxChars: 100_000
      };
      const response = (await chrome.runtime.sendMessage(request)) as UiToExtensionResponse;
      if (!response?.ok) {
        throw new Error(response?.error || "extract_failed");
      }
      if (response.payload) {
        setPageContent(response.payload);
        setIncludePageContext(false);
      }
      if (!input.trim()) {
        setInput("Please summarize the current tab using extracted full-page content.");
      }
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : "extract_failed");
      setPageContent(undefined);
      setIncludePageContext(false);
    } finally {
      setExtractingPage(false);
    }
  }

  async function openStandalonePage(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/sidepanel/index.html") });
  }

  async function openSettingsPage(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/settings/index.html") });
  }

  async function updateThemeMode(nextThemeMode: UiThemeMode): Promise<void> {
    setThemeModeState(nextThemeMode);
    await setTheme(nextThemeMode);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100vh" }}>
      <aside
        style={{
          borderRight: "1px solid var(--line)",
          background: "var(--panel)",
          padding: 12,
          overflowY: "auto",
          overflowX: "hidden"
        }}
      >
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{t(locale, "sessions")}</h2>
        <Button type="button" onClick={() => void createNewSession()} className="w-full">
          {t(locale, "newSession")}
        </Button>

        <TooltipProvider delayDuration={240}>
          <div style={{ marginTop: 8, display: "grid", gap: 3 }}>
            {sessions.map((session) => (
              <Tooltip
                key={session.id}
                open={hoverSessionId === session.id && truncatedTitleSessionId === session.id}
              >
                <TooltipTrigger asChild>
                  <div
                    onClick={() => setActiveSessionId(session.id)}
                    style={{
                      position: "relative",
                      ...rowButtonStyle,
                      background:
                        activeSessionId === session.id
                          ? "var(--session-active-bg)"
                          : hoverSessionId === session.id
                            ? "var(--session-hover-bg)"
                            : "transparent",
                      transition: "background-color 150ms ease",
                      cursor: "pointer",
                      padding: "2px 4px 2px 8px",
                      gap: 4,
                      overflow: "hidden"
                    }}
                    onMouseEnter={(event) => {
                      setHoverSessionId(session.id);
                      const titleElement = event.currentTarget.querySelector(
                        "[data-session-title='true']"
                      ) as HTMLElement | null;

                      if (!titleElement || titleElement.scrollWidth <= titleElement.clientWidth) {
                        setTruncatedTitleSessionId((previous) =>
                          previous === session.id ? undefined : previous
                        );
                        return;
                      }

                      setTruncatedTitleSessionId(session.id);
                    }}
                    onMouseLeave={() => {
                      setHoverSessionId((previous) =>
                        previous === session.id ? undefined : previous
                      );
                      setTruncatedTitleSessionId((previous) =>
                        previous === session.id ? undefined : previous
                      );
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveSessionId(session.id)}
                      style={sessionTitleButtonStyle}
                    >
                      <span
                        data-session-title="true"
                        style={{
                          display: "block",
                          width: "100%",
                          minWidth: 0,
                          textAlign: "left",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {session.title}
                      </span>
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          aria-label={t(locale, "moreActions")}
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-md p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent"
                          onClick={(event) => event.stopPropagation()}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <Icon icon={dotsVertical} width={16} height={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[150px]">
                        <DropdownMenuItem onSelect={() => void toggleStarSession(session.id)}>
                          <Icon
                            icon={session.starred ? starOutlineIcon : starIcon}
                            width={16}
                            height={16}
                          />
                          <span>{session.starred ? t(locale, "unfavorite") : t(locale, "favorite")}</span>
                        </DropdownMenuItem>

                        <DropdownMenuItem onSelect={() => openRenameDialog(session)}>
                          <Icon icon={pencilOutline} width={16} height={16} />
                          <span>{t(locale, "renameSession")}</span>
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onSelect={() => void deleteSession(session.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Icon icon={deleteOutline} width={16} height={16} />
                          <span>{t(locale, "deleteSession")}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  className="max-w-[280px] whitespace-normal break-words"
                >
                  {session.title}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>

        <Separator className="my-3" />
        <div className="grid gap-2 rounded-md border border-border bg-card p-2">
          <span className="text-xs text-muted-foreground">{t(locale, "currentConnection")}</span>
          <span className="truncate text-xs font-medium">
            {activeConnection?.name ?? t(locale, "noConnection")}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void openSettingsPage()}>
            {t(locale, "openSettings")}
          </Button>
        </div>
      </aside>

      <main style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--line)",
            background: "var(--header-glass-bg)",
            backdropFilter: "blur(4px)"
          }}
        >
          <strong style={{ flex: 1 }}>{t(locale, "appTitle")}</strong>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent"
                title={t(locale, "theme")}
                aria-label={t(locale, "theme")}
              >
                <Icon icon={themeLightDark} width={18} height={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[144px]">
              <DropdownMenuItem onSelect={() => void updateThemeMode("system")}>
                <Icon
                  icon={checkIcon}
                  width={16}
                  height={16}
                  className={themeMode === "system" ? "opacity-100" : "opacity-0"}
                />
                <span>{t(locale, "themeSystem")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void updateThemeMode("light")}>
                <Icon
                  icon={checkIcon}
                  width={16}
                  height={16}
                  className={themeMode === "light" ? "opacity-100" : "opacity-0"}
                />
                <span>{t(locale, "themeLight")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void updateThemeMode("dark")}>
                <Icon
                  icon={checkIcon}
                  width={16}
                  height={16}
                  className={themeMode === "dark" ? "opacity-100" : "opacity-0"}
                />
                <span>{t(locale, "themeDark")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void openStandalonePage()}
            title={t(locale, "openStandalone")}
            aria-label={t(locale, "openStandalone")}
          >
            <Icon icon={openInNew} width={16} height={16} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void openSettingsPage()}
            title={t(locale, "openSettings")}
            aria-label={t(locale, "openSettings")}
          >
            <Icon icon={cogOutline} width={16} height={16} />
          </Button>
        </header>

        <section
          ref={conversationViewportRef}
          style={{ padding: 14, overflow: "auto", display: "grid", gap: 12, alignContent: "start" }}
        >
          {!activeConnection ? (
            <div style={hintErrorStyle}>{t(locale, "noActiveConnectionHint")}</div>
          ) : null}
          {runtimeAlert ? (
            <div style={runtimeAlert.level === "error" ? hintErrorStyle : hintWarnStyle}>
              <div>{runtimeAlert.message}</div>
              {recentAuditEvents.length > 0 ? (
                <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                  <strong style={{ fontSize: 11, opacity: 0.9 }}>{t(locale, "recentAuditEvents")}</strong>
                  {recentAuditEvents.slice(0, 3).map((event) => (
                    <div key={event.id} style={{ fontSize: 11, opacity: 0.9 }}>
                      [{event.level}] {event.eventType}
                      {typeof event.statusCode === "number" ? ` (${event.statusCode})` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {capabilitiesError ? <div style={hintErrorStyle}>Capabilities sync failed: {capabilitiesError}</div> : null}
          {capabilities && !ttsReady ? (
            <div style={hintInfoStyle}>TTS is unavailable. Configure MiniMax key in local bridge env.</div>
          ) : null}
          {extractError ? <div style={hintErrorStyle}>{extractError}</div> : null}
          {messages.length === 0 ? (
            <div style={{ color: "var(--muted-text)", fontSize: 13 }}>{t(locale, "empty")}</div>
          ) : (
            messages.map((msg) => {
              const showRaw = msg.role === "assistant" && Boolean(rawViewByMessageId[msg.id]);

              return (
                <article
                  key={msg.id}
                  style={{
                    maxWidth: "85%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    lineHeight: 1.45,
                    border: "1px solid var(--line)",
                    background:
                      msg.role === "user" ? "var(--message-user-bg)" : "var(--message-assistant-bg)",
                    marginLeft: msg.role === "user" ? "auto" : 0
                  }}
                >
                  {msg.role === "assistant" ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => toggleRawView(msg.id)}
                        style={messageRenderToggleStyle}
                      >
                        {showRaw ? "格式化" : "查看原文"}
                      </button>
                      {showRaw ? (
                        <pre style={rawMessageContentStyle}>
                          <code>{msg.content}</code>
                        </pre>
                      ) : (
                        <MarkdownMessage content={msg.content} />
                      )}
                    </div>
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                  )}
                </article>
              );
            })
          )}
        </section>

        <footer style={{ padding: 12, borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}>
          {pageContent ? (
            <div style={hintInfoStyle}>
              {t(locale, "pageContextReady")} · {pageContent.source} · {pageContent.charCount} chars
              <label style={inlineCheckboxLabelStyle}>
                <input
                  type="checkbox"
                  checked={includePageContext}
                  onChange={(event) => setIncludePageContext(event.target.checked)}
                />
                {t(locale, "includePageContext")}
              </label>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t(locale, "adapter")}</span>
              <Select
                value={adapter}
                onValueChange={(value) => {
                  const nextAdapter = value as BridgeChatRequest["adapter"];
                  setAdapter(nextAdapter);
                  if (!activeSessionId) {
                    return;
                  }
                  rememberSessionAdapter(activeSessionId, nextAdapter);
                  if (
                    sessionMode === "backend" &&
                    activeConnection &&
                    activeSessionId !== BACKEND_DRAFT_SESSION_ID
                  ) {
                    void updateSessionAdapterOnBackend(
                      activeConnection,
                      activeSessionId,
                      nextAdapter
                    ).then((updatedSession) => {
                      if (!updatedSession) {
                        return;
                      }
                      setSessionsState((prev) => {
                        const next = prev.map((item) =>
                          item.id === updatedSession.id ? updatedSession : item
                        );
                        void setSessions(next);
                        return next;
                      });
                    });
                  }
                }}
              >
                <SelectTrigger className="h-8 w-[136px] bg-card text-xs">
                  <SelectValue placeholder={t(locale, "adapter")} />
                </SelectTrigger>
                <SelectContent>
                  {availableAdapters.map((item) => (
                    <SelectItem key={item.adapter} value={item.adapter}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => void extractCurrentPage()}
              disabled={extractingPage}
            >
              {extractingPage ? t(locale, "extractingPage") : t(locale, "extractPage")}
            </Button>
          </div>
          <Textarea
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(locale, "placeholder")}
            className="min-h-[76px] resize-y"
          />
          <Button
            type="button"
            disabled={pending}
            onClick={() => void send()}
            style={{ opacity: pending ? 0.6 : 1 }}
          >
            {pending ? "..." : t(locale, "send")}
          </Button>
        </footer>
      </main>

      <Dialog
        open={renameDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeRenameDialog();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, "renameSession")}</DialogTitle>
            <DialogDescription>{t(locale, "renameSessionDescription")}</DialogDescription>
          </DialogHeader>

          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRenameDialog();
            }}
          >
            <Input
              value={renameTitleInput}
              onChange={(event) => {
                setRenameTitleInput(event.target.value);
                if (renameError) {
                  setRenameError(undefined);
                }
              }}
              maxLength={120}
              autoFocus
            />
            {renameError ? (
              <div className="text-xs text-destructive">{renameError}</div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => closeRenameDialog()}
              >
                {t(locale, "cancel")}
              </Button>
              <Button type="submit">{t(locale, "save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function createSession(title: string): ChatSession {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    starred: false,
    createdAt: now,
    updatedAt: now
  };
}

function mergeSessionsWithLocalAdapters(
  localSessions: ChatSession[],
  backendSessions: ChatSession[]
): ChatSession[] {
  if (localSessions.length === 0 || backendSessions.length === 0) {
    return backendSessions;
  }
  const adapterBySessionId = new Map(
    localSessions
      .filter((item) => Boolean(item.lastAdapter))
      .map((item) => [item.id, item.lastAdapter])
  );
  if (adapterBySessionId.size === 0) {
    return backendSessions;
  }
  return backendSessions.map((session) => {
    if (session.lastAdapter) {
      return session;
    }
    const localAdapter = adapterBySessionId.get(session.id);
    if (!localAdapter) {
      return session;
    }
    return {
      ...session,
      lastAdapter: localAdapter
    };
  });
}

function areSessionListsEqual(left: ChatSession[], right: ChatSession[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.starred !== b.starred ||
      a.lastAdapter !== b.lastAdapter ||
      a.status !== b.status ||
      a.lastActiveAt !== b.lastActiveAt ||
      a.createdAt !== b.createdAt ||
      a.updatedAt !== b.updatedAt
    ) {
      return false;
    }
  }

  return true;
}

async function fetchBridgeJson<T>(
  connection: BridgeConnection,
  path: string
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await fetch(`${connection.baseUrl}${path}`, {
    headers: buildBridgeHeaders(connection)
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
}

function buildBridgeHeaders(connection: BridgeConnection, includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {
    ...(connection.userId ? { "x-surf-user-id": connection.userId } : {})
  };
  if (includeJsonContentType) {
    headers["content-type"] = "application/json";
  }
  if (connection.token) {
    headers["x-surf-token"] = connection.token;
  }
  return headers;
}

function buildChatContext(
  selectionContext: SelectionPayload | undefined,
  pageContent: PageContentPayload | undefined,
  includePageContext: boolean
): NonNullable<BridgeChatRequest["context"]> {
  const context: NonNullable<BridgeChatRequest["context"]> = {};
  const pageTitle = pageContent?.pageTitle || selectionContext?.pageTitle;
  if (pageTitle) context.pageTitle = pageTitle;
  const pageUrl = pageContent?.pageUrl || selectionContext?.pageUrl;
  if (pageUrl) context.pageUrl = pageUrl;
  if (selectionContext?.text) {
    context.selectedText = selectionContext.text;
  }
  if (includePageContext && pageContent?.text) {
    context.pageText = pageContent.text;
    context.pageTextSource = pageContent.source;
  }
  return context;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const rowButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  border: "none",
  borderRadius: 8,
  padding: "2px 4px",
  background: "transparent",
  color: "var(--ink)",
  cursor: "pointer"
};

const hintInfoStyle: CSSProperties = {
  border: "1px solid var(--hint-info-border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--hint-info-bg)",
  color: "var(--hint-info-text)",
  fontSize: 12
};

const hintErrorStyle: CSSProperties = {
  border: "1px solid var(--hint-error-border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--hint-error-bg)",
  color: "var(--hint-error-text)",
  fontSize: 12
};

const hintWarnStyle: CSSProperties = {
  border: "1px solid var(--hint-warn-border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--hint-warn-bg)",
  color: "var(--hint-warn-text)",
  fontSize: 12
};

const inlineCheckboxLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginLeft: 10,
  fontSize: 12
};

const sessionTitleButtonStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: "2px 0",
  display: "inline-flex",
  alignItems: "center",
  overflow: "hidden"
};

const messageRenderToggleStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--link)",
  padding: 0,
  margin: 0,
  width: "fit-content",
  cursor: "pointer",
  fontSize: 12,
  textDecoration: "underline",
  textUnderlineOffset: 2
};

const rawMessageContentStyle: CSSProperties = {
  margin: 0,
  padding: "8px 10px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--code-block-bg)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
};
