import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
  BridgeSessionMessagesResponse,
  BridgeSessionSendMessageResponse,
  BridgeSessionStarRequest,
  ChatMessage,
  ChatSession,
  ExtensionToUiMessage,
  BridgeTtsResponse,
  PageContentPayload,
  QuickAction,
  SelectionPayload,
  UiStatusBadgeLevel,
  UiToExtensionMessage,
  UiToExtensionResponse
} from "@surf-ai/shared";
import { deleteMessagesBySession, listMessagesBySession, saveMessage, saveMessages } from "../../lib/db";
import {
  getActiveConnectionId,
  getConnections,
  getSessions,
  onStorageChanged,
  setActiveConnectionId,
  setConnections,
  setSessions
} from "../../lib/storage";
import { resolveLocale, t } from "../common/i18n";
import { MarkdownMessage } from "./MarkdownMessage";

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
  const locale = resolveLocale(navigator.language);

  const [connections, setConnectionsState] = useState<BridgeConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | undefined>();
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

  const [newConnName, setNewConnName] = useState("");
  const [newConnUrl, setNewConnUrl] = useState("http://127.0.0.1:43127");
  const [newConnUserId, setNewConnUserId] = useState("local");
  const [newConnToken, setNewConnToken] = useState("");

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
      const connectionChanged =
        Boolean(changes[STORAGE_KEYS.connections]) ||
        Boolean(changes[STORAGE_KEYS.activeConnectionId]);
      if (!connectionChanged) {
        return;
      }
      void bootstrapConnectionsAndSessions();
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

  function toggleRawView(messageId: string): void {
    setRawViewByMessageId((previous) => ({
      ...previous,
      [messageId]: !previous[messageId]
    }));
  }

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    if (sessionMode === "backend" && activeSessionId === BACKEND_DRAFT_SESSION_ID) {
      return;
    }

    if (sessionMode === "backend" && activeConnection) {
      void loadMessagesFromBackend(activeConnection, activeSessionId);
      return;
    }

    void listMessagesBySession(activeSessionId).then(setMessages);
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
        if (areSessionListsEqual(prev, backendSessions)) {
          return prev;
        }
        void setSessions(backendSessions);
        return backendSessions;
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

    const preferredAdapter = capabilities?.chat.defaultAdapter;
    if (preferredAdapter && availableAdapters.some((item) => item.adapter === preferredAdapter)) {
      setAdapter(preferredAdapter);
      return;
    }

    if (availableAdapters[0]) {
      setAdapter(availableAdapters[0].adapter);
    }
  }, [adapter, availableAdapters, capabilities]);

  async function bootstrap(): Promise<void> {
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
        await setSessions(backendSessions);
        setSessionsState(backendSessions);
        setActiveSessionId((current) => {
          if (current === BACKEND_DRAFT_SESSION_ID) {
            return BACKEND_DRAFT_SESSION_ID;
          }
          if (current && backendSessions.some((item) => item.id === current)) {
            return current;
          }
          return backendSessions[0]?.id ?? BACKEND_DRAFT_SESSION_ID;
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

  async function loadMessagesFromBackend(connection: BridgeConnection, sessionId: string): Promise<void> {
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
      setMessages(response.data.messages);
      await saveMessages(response.data.messages);
      clearRuntimeAlert();
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
      setMessages([
        {
          id: crypto.randomUUID(),
          sessionId,
          role: "assistant",
          content: `Error: ${error instanceof Error ? error.message : "load_messages_failed"}`,
          createdAt: Date.now()
        }
      ]);
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

  async function addConnection(): Promise<void> {
    if (!newConnName.trim() || !newConnUrl.trim()) return;

    const now = Date.now();
    const connection: BridgeConnection = {
      id: crypto.randomUUID(),
      name: newConnName.trim(),
      baseUrl: newConnUrl.trim().replace(/\/$/, ""),
      ...(newConnUserId.trim() ? { userId: newConnUserId.trim() } : {}),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ...(newConnToken.trim() ? { token: newConnToken.trim() } : {})
    };

    const next = [connection, ...connections];
    await setConnections(next);
    await setActiveConnectionId(connection.id);
    setConnectionsState(next);
    setActiveConnectionIdState(connection.id);

    setNewConnName("");
    setNewConnUrl("http://127.0.0.1:43127");
    setNewConnUserId("local");
    setNewConnToken("");
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
            content: "Error: no active bridge connection. Please select or add one first.",
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
        content: "Error: no active bridge connection. Please select or add one first.",
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

  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: "100vh" }}>
      <aside style={{ borderRight: "1px solid var(--line)", background: "var(--panel)", padding: 12, overflow: "auto" }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{t(locale, "sessions")}</h2>
        <button
          type="button"
          onClick={() => void createNewSession()}
          style={solidButtonStyle}
        >
          {t(locale, "newSession")}
        </button>

        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          {sessionMode === "backend" ? (
            <button
              key={BACKEND_DRAFT_SESSION_ID}
              type="button"
              onClick={() => setActiveSessionId(BACKEND_DRAFT_SESSION_ID)}
              style={{
                ...rowButtonStyle,
                background: activeSessionId === BACKEND_DRAFT_SESSION_ID ? "#e8f8ff" : "#fff"
              }}
            >
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t(locale, "newSession")}
              </span>
            </button>
          ) : null}
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => setActiveSessionId(session.id)}
              style={{
                ...rowButtonStyle,
                background: activeSessionId === session.id ? "#e8f8ff" : "#fff"
              }}
            >
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {session.title}
              </span>
              <span
                role="button"
                aria-label={t(locale, "favorite")}
                style={sessionInlineActionStyle}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleStarSession(session.id);
                }}
              >
                {session.starred ? "★" : "☆"}
              </span>
              <span
                role="button"
                aria-label={t(locale, "deleteSession")}
                style={sessionInlineActionStyle}
                onClick={(event) => {
                  event.stopPropagation();
                  void deleteSession(session.id);
                }}
              >
                {t(locale, "deleteSession")}
              </span>
            </button>
          ))}
        </div>

        <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid var(--line)" }} />

        <h3 style={{ margin: "0 0 6px", fontSize: 14 }}>{t(locale, "connection")}</h3>
        <select
          value={activeConnectionId}
          onChange={(event) => {
            const id = event.target.value;
            setActiveConnectionIdState(id);
            void setActiveConnectionId(id);
          }}
          style={inputStyle}
        >
          {connections.map((conn) => (
            <option key={conn.id} value={conn.id}>
              {conn.name}
            </option>
          ))}
        </select>

        <label style={labelStyle}>{t(locale, "connectionName")}</label>
        <input value={newConnName} onChange={(e) => setNewConnName(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>{t(locale, "baseUrl")}</label>
        <input value={newConnUrl} onChange={(e) => setNewConnUrl(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>{t(locale, "connectionUserId")}</label>
        <input value={newConnUserId} onChange={(e) => setNewConnUserId(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>{t(locale, "token")}</label>
        <input value={newConnToken} onChange={(e) => setNewConnToken(e.target.value)} style={inputStyle} />

        <button type="button" onClick={() => void addConnection()} style={{ ...solidButtonStyle, marginTop: 8 }}>
          {t(locale, "addConnection")}
        </button>
      </aside>

      <main style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 0 }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--line)",
            background: "rgba(255, 255, 255, 0.84)",
            backdropFilter: "blur(4px)"
          }}
        >
          <strong style={{ flex: 1 }}>{t(locale, "appTitle")}</strong>
          <label>{t(locale, "adapter")}</label>
          <select value={adapter} onChange={(e) => setAdapter(e.target.value as BridgeChatRequest["adapter"])} style={{ ...inputStyle, width: 150 }}>
            {availableAdapters.map((item) => (
              <option key={item.adapter} value={item.adapter}>
                {item.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void extractCurrentPage()} disabled={extractingPage} style={ghostButtonStyle}>
            {extractingPage ? t(locale, "extractingPage") : t(locale, "extractPage")}
          </button>
        </header>

        <section style={{ padding: 14, overflow: "auto", display: "grid", gap: 12, alignContent: "start" }}>
          {!activeConnection ? (
            <div style={hintErrorStyle}>No active bridge connection. Please select or add one in the left panel.</div>
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
          {extractError ? <div style={hintErrorStyle}>{extractError}</div> : null}
          {messages.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>{t(locale, "empty")}</div>
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
                    background: msg.role === "user" ? "#dff4ff" : "#fff",
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
          <textarea
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t(locale, "placeholder")}
            style={{ ...inputStyle, resize: "vertical", minHeight: 76 }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => void send()}
            style={{ ...solidButtonStyle, opacity: pending ? 0.6 : 1 }}
          >
            {pending ? "..." : t(locale, "send")}
          </button>
        </footer>
      </main>
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

const solidButtonStyle: CSSProperties = {
  border: "1px solid var(--brand)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "linear-gradient(180deg, #11a4a6 0%, #0f7a8a 100%)",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer"
};

const rowButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff",
  color: "var(--ink)",
  cursor: "pointer"
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff",
  color: "var(--ink)"
};

const labelStyle: CSSProperties = {
  marginTop: 8,
  marginBottom: 4,
  fontSize: 12,
  color: "var(--muted)",
  display: "block"
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff",
  color: "var(--ink)",
  cursor: "pointer"
};

const hintInfoStyle: CSSProperties = {
  border: "1px solid #c7e6d9",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#eefaf4",
  color: "#246a4b",
  fontSize: 12
};

const hintErrorStyle: CSSProperties = {
  border: "1px solid #f0b9b9",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff2f2",
  color: "#9b2d2d",
  fontSize: 12
};

const hintWarnStyle: CSSProperties = {
  border: "1px solid #f3dfb4",
  borderRadius: 10,
  padding: "8px 10px",
  background: "#fff8ea",
  color: "#8a5a16",
  fontSize: 12
};

const inlineCheckboxLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginLeft: 10,
  fontSize: 12
};

const sessionInlineActionStyle: CSSProperties = {
  cursor: "pointer",
  fontSize: 12,
  color: "var(--muted)"
};

const messageRenderToggleStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#0d5f78",
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
  background: "#f6f9fb",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
};
