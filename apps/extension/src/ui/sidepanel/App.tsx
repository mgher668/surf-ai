import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  BridgeSessionRun,
  BridgeSessionRunCancelResponse,
  BridgeSessionRunCreateResponse,
  BridgeSessionRunResponse,
  BridgeSessionRunsResponse,
  BridgeSessionRenameRequest,
  BridgeSessionRenameResponse,
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
  getActiveSessionId as getStoredActiveSessionId,
  getDefaultAdapter,
  getConnections,
  getLocale,
  getTheme,
  getSessions,
  onStorageChanged,
  setActiveSessionId as setStoredActiveSessionId,
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
import { Badge } from "../components/ui/badge";
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
  const [activeRun, setActiveRun] = useState<BridgeSessionRun | undefined>();
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
  const [isAnyDropdownMenuOpen, setIsAnyDropdownMenuOpen] = useState(false);
  const [isAdapterSelectOpen, setIsAdapterSelectOpen] = useState(false);
  const [isConversationFocused, setIsConversationFocused] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>();
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewMessageId, setPreviewMessageId] = useState<string | undefined>();
  const [loadedMessagesSessionId, setLoadedMessagesSessionId] = useState<string | undefined>();
  const conversationViewportRef = useRef<HTMLElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const messageItemRefs = useRef(new Map<string, HTMLElement>());
  const conversationScrollLoopRef = useRef<number | null>(null);
  const conversationScrollLastTsRef = useRef<number | null>(null);
  const conversationScrollKeysRef = useRef({ j: false, k: false });
  const previewScrollLoopRef = useRef<number | null>(null);
  const previewScrollLastTsRef = useRef<number | null>(null);
  const previewScrollKeysRef = useRef({ j: false, k: false });
  const pendingAutoScrollSessionIdRef = useRef<string | undefined>(undefined);
  const preferredActiveSessionIdRef = useRef<string | undefined>(undefined);

  const KEYBOARD_SCROLL_SPEED_PX_PER_SECOND = 780;

  const isBackendDraftActive =
    sessionMode === "backend" && activeSessionId === BACKEND_DRAFT_SESSION_ID;
  const isActiveRunBusy = Boolean(
    activeRun &&
      activeRun.sessionId === activeSessionId &&
      (activeRun.status === "QUEUED" ||
        activeRun.status === "RUNNING" ||
        activeRun.status === "CANCELLING")
  );
  const isKeyboardShortcutBlocked = renameDialogOpen || isAnyDropdownMenuOpen || isAdapterSelectOpen;
  const previewMessage = useMemo(
    () => messages.find((item) => item.id === previewMessageId),
    [messages, previewMessageId]
  );

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
      setActiveRun(undefined);
      setFocusedMessageId(undefined);
      setPreviewDialogOpen(false);
      setPreviewMessageId(undefined);
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

  useEffect(() => {
    if (messages.length === 0) {
      setFocusedMessageId(undefined);
      return;
    }
    if (!focusedMessageId) {
      return;
    }
    if (messages.some((item) => item.id === focusedMessageId)) {
      return;
    }
    setFocusedMessageId(undefined);
  }, [messages, focusedMessageId]);

  useEffect(() => {
    return () => {
      clearConversationKeyboardScrollKeys();
      clearPreviewKeyboardScrollKeys();
    };
  }, []);

  useEffect(() => {
    if (!previewDialogOpen) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      previewViewportRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [previewDialogOpen, previewMessageId]);

  useEffect(() => {
    if (!previewDialogOpen) {
      return;
    }
    if (previewMessage) {
      return;
    }
    setPreviewDialogOpen(false);
    setPreviewMessageId(undefined);
  }, [previewDialogOpen, previewMessage]);

  useEffect(() => {
    if (isKeyboardShortcutBlocked) {
      clearConversationKeyboardScrollKeys();
      clearPreviewKeyboardScrollKeys();
    }
  }, [isKeyboardShortcutBlocked]);

  useEffect(() => {
    if (previewDialogOpen) {
      clearConversationKeyboardScrollKeys();
      return;
    }
    clearPreviewKeyboardScrollKeys();
  }, [previewDialogOpen]);

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

  function resolveFocusedMessageIdFromTarget(target: EventTarget | null): string | undefined {
    if (!(target instanceof HTMLElement)) {
      return undefined;
    }
    return target.closest<HTMLElement>("[data-message-id]")?.dataset.messageId;
  }

  function focusConversationViewport(): void {
    if (focusedMessageId) {
      const messageElement = messageItemRefs.current.get(focusedMessageId);
      if (messageElement) {
        messageElement.focus({ preventScroll: true });
        return;
      }
    }
    conversationViewportRef.current?.focus({ preventScroll: true });
  }

  function registerMessageItemRef(messageId: string, element: HTMLElement | null): void {
    if (element) {
      messageItemRefs.current.set(messageId, element);
      return;
    }
    messageItemRefs.current.delete(messageId);
  }

  function openPreviewDialogForMessage(messageId: string): void {
    setPreviewMessageId(messageId);
    setPreviewDialogOpen(true);
  }

  function stopConversationKeyboardScroll(): void {
    if (conversationScrollLoopRef.current) {
      window.cancelAnimationFrame(conversationScrollLoopRef.current);
      conversationScrollLoopRef.current = null;
    }
    conversationScrollLastTsRef.current = null;
  }

  function clearConversationKeyboardScrollKeys(): void {
    conversationScrollKeysRef.current.j = false;
    conversationScrollKeysRef.current.k = false;
    stopConversationKeyboardScroll();
  }

  function startConversationKeyboardScroll(): void {
    if (conversationScrollLoopRef.current) {
      return;
    }

    const step = (timestamp: number): void => {
      const viewport = conversationViewportRef.current;
      if (!viewport) {
        stopConversationKeyboardScroll();
        return;
      }

      const direction =
        (conversationScrollKeysRef.current.j ? 1 : 0) +
        (conversationScrollKeysRef.current.k ? -1 : 0);
      if (direction === 0) {
        stopConversationKeyboardScroll();
        return;
      }

      const lastTs = conversationScrollLastTsRef.current ?? timestamp;
      const deltaMs = Math.max(0, timestamp - lastTs);
      conversationScrollLastTsRef.current = timestamp;
      const deltaPx =
        direction * KEYBOARD_SCROLL_SPEED_PX_PER_SECOND * (deltaMs / 1_000);
      if (deltaPx !== 0) {
        viewport.scrollTop += deltaPx;
      }

      conversationScrollLoopRef.current = window.requestAnimationFrame(step);
    };

    conversationScrollLastTsRef.current = null;
    conversationScrollLoopRef.current = window.requestAnimationFrame(step);
  }

  function updateConversationKeyboardScrollKey(
    key: "j" | "k",
    pressed: boolean
  ): void {
    conversationScrollKeysRef.current[key] = pressed;
    const active =
      conversationScrollKeysRef.current.j || conversationScrollKeysRef.current.k;
    if (active) {
      startConversationKeyboardScroll();
      return;
    }
    stopConversationKeyboardScroll();
  }

  function stopPreviewKeyboardScroll(): void {
    if (previewScrollLoopRef.current) {
      window.cancelAnimationFrame(previewScrollLoopRef.current);
      previewScrollLoopRef.current = null;
    }
    previewScrollLastTsRef.current = null;
  }

  function clearPreviewKeyboardScrollKeys(): void {
    previewScrollKeysRef.current.j = false;
    previewScrollKeysRef.current.k = false;
    stopPreviewKeyboardScroll();
  }

  function startPreviewKeyboardScroll(): void {
    if (previewScrollLoopRef.current) {
      return;
    }

    const step = (timestamp: number): void => {
      const viewport = previewViewportRef.current;
      if (!viewport) {
        stopPreviewKeyboardScroll();
        return;
      }

      const direction =
        (previewScrollKeysRef.current.j ? 1 : 0) +
        (previewScrollKeysRef.current.k ? -1 : 0);
      if (direction === 0) {
        stopPreviewKeyboardScroll();
        return;
      }

      const lastTs = previewScrollLastTsRef.current ?? timestamp;
      const deltaMs = Math.max(0, timestamp - lastTs);
      previewScrollLastTsRef.current = timestamp;
      const deltaPx =
        direction * KEYBOARD_SCROLL_SPEED_PX_PER_SECOND * (deltaMs / 1_000);
      if (deltaPx !== 0) {
        viewport.scrollTop += deltaPx;
      }

      previewScrollLoopRef.current = window.requestAnimationFrame(step);
    };

    previewScrollLastTsRef.current = null;
    previewScrollLoopRef.current = window.requestAnimationFrame(step);
  }

  function updatePreviewKeyboardScrollKey(
    key: "j" | "k",
    pressed: boolean
  ): void {
    previewScrollKeysRef.current[key] = pressed;
    const active = previewScrollKeysRef.current.j || previewScrollKeysRef.current.k;
    if (active) {
      startPreviewKeyboardScroll();
      return;
    }
    stopPreviewKeyboardScroll();
  }

  function handleConversationShortcut(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.nativeEvent.isComposing || isKeyboardShortcutBlocked || previewDialogOpen) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "j" || key === "k") {
      event.preventDefault();
      updateConversationKeyboardScrollKey(key as "j" | "k", true);
      return;
    }

    if (key === "f") {
      const focusedId = resolveFocusedMessageIdFromTarget(event.target);
      if (!focusedId) {
        return;
      }
      event.preventDefault();
      openPreviewDialogForMessage(focusedId);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      const composer = composerTextareaRef.current;
      if (!composer) {
        return;
      }
      composer.focus({ preventScroll: true });
    }
  }

  function handleConversationShortcutKeyUp(
    event: ReactKeyboardEvent<HTMLElement>
  ): void {
    const key = event.key.toLowerCase();
    if (key !== "j" && key !== "k") {
      return;
    }
    event.preventDefault();
    updateConversationKeyboardScrollKey(key as "j" | "k", false);
  }

  function handlePreviewShortcut(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.nativeEvent.isComposing || isKeyboardShortcutBlocked) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "j" || key === "k") {
      event.preventDefault();
      updatePreviewKeyboardScrollKey(key as "j" | "k", true);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPreviewDialogOpen(false);
      window.requestAnimationFrame(() => {
        focusConversationViewport();
      });
    }
  }

  function handlePreviewShortcutKeyUp(
    event: ReactKeyboardEvent<HTMLDivElement>
  ): void {
    const key = event.key.toLowerCase();
    if (key !== "j" && key !== "k") {
      return;
    }
    event.preventDefault();
    updatePreviewKeyboardScrollKey(key as "j" | "k", false);
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
    if (!activeSessionId || sessionMode !== "backend" || !activeConnection || isBackendDraftActive) {
      setActiveRun(undefined);
      return;
    }

    let cancelled = false;
    setActiveRun(undefined);

    const load = async (): Promise<void> => {
      const latestRun = await fetchLatestSessionRun(activeConnection, activeSessionId);
      if (cancelled) {
        return;
      }
      setActiveRun(latestRun ?? undefined);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [activeConnectionId, activeConnection?.baseUrl, activeSessionId, sessionMode, isBackendDraftActive]);

  useEffect(() => {
    if (
      sessionMode !== "backend" ||
      !activeConnection ||
      !activeSessionId ||
      isBackendDraftActive ||
      !activeRun ||
      activeRun.sessionId !== activeSessionId ||
      !isRunInFlight(activeRun.status)
    ) {
      return;
    }

    let cancelled = false;

    const syncRun = async (): Promise<void> => {
      const latestRun = await fetchRunById(activeConnection, activeRun.id);
      if (!latestRun || cancelled) {
        return;
      }
      if (latestRun.sessionId !== activeSessionId) {
        return;
      }

      const latestRunInFlight = isRunInFlight(latestRun.status);
      if (latestRunInFlight) {
        setActiveRun(latestRun);
      }

      // Keep messages in sync while a run is in progress. This also enables
      // immediate UI updates once the assistant message lands.
      const polledMessages = await pollMessagesFromBackend(activeConnection, activeSessionId);
      if (cancelled) {
        return;
      }
      if (polledMessages) {
        setMessages((prev) => {
          if (areMessageListsEqual(prev, polledMessages)) {
            return prev;
          }
          const lastMessage = polledMessages[polledMessages.length - 1];
          if (lastMessage?.sessionId === activeSessionId) {
            pendingAutoScrollSessionIdRef.current = activeSessionId;
          }
          return polledMessages;
        });
        setLoadedMessagesSessionId(activeSessionId);
      }

      if (!latestRunInFlight) {
        const loadedMessages = await loadMessagesFromBackend(activeConnection, activeSessionId);
        if (cancelled) {
          return;
        }
        setMessages((prev) => {
          if (areMessageListsEqual(prev, loadedMessages)) {
            return prev;
          }
          const lastMessage = loadedMessages[loadedMessages.length - 1];
          if (lastMessage?.sessionId === activeSessionId) {
            pendingAutoScrollSessionIdRef.current = activeSessionId;
          }
          return loadedMessages;
        });
        setLoadedMessagesSessionId(activeSessionId);
        setActiveRun(latestRun);

        const backendSessions = await fetchSessionsFromBackend(activeConnection);
        if (cancelled || !backendSessions) {
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
      }
    };

    void syncRun();
    const timer = window.setInterval(() => {
      void syncRun();
    }, 1_200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    sessionMode,
    activeConnectionId,
    activeConnection?.baseUrl,
    activeSessionId,
    isBackendDraftActive,
    activeRun?.id,
    activeRun?.status
  ]);

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
        const preferredId = current ?? preferredActiveSessionIdRef.current;
        if (preferredId && backendSessions.some((item) => item.id === preferredId)) {
          return preferredId;
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
    preferredActiveSessionIdRef.current = activeSessionId;
    void setStoredActiveSessionId(activeSessionId);
  }, [activeSessionId]);

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
    const [storedConnections, storedActiveConnectionId, storedSessions, storedActiveSessionId] = await Promise.all([
      getConnections(),
      getActiveConnectionId(),
      getSessions(),
      getStoredActiveSessionId()
    ]);
    preferredActiveSessionIdRef.current = storedActiveSessionId;

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
          const preferredId = current ?? preferredActiveSessionIdRef.current;
          if (preferredId && mergedSessions.some((item) => item.id === preferredId)) {
            return preferredId;
          }
          return mergedSessions[0]?.id ?? BACKEND_DRAFT_SESSION_ID;
        });
      } else {
        setSessionsState(storedSessions);
        setActiveSessionId((current) => {
          if (current === BACKEND_DRAFT_SESSION_ID) {
            return BACKEND_DRAFT_SESSION_ID;
          }
          const preferredId = current ?? preferredActiveSessionIdRef.current;
          if (preferredId && storedSessions.some((item) => item.id === preferredId)) {
            return preferredId;
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
    setActiveSessionId((current) => {
      const preferredId = current ?? preferredActiveSessionIdRef.current;
      if (preferredId && storedSessions.some((item) => item.id === preferredId)) {
        return preferredId;
      }
      return storedSessions[0]?.id;
    });
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
    if (isActiveRunBusy) {
      return;
    }
    if (!activeConnection) {
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId ?? "pending",
        role: "assistant",
        adapter,
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
            adapter,
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
      adapter,
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
        adapter,
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
        adapter,
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
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify({
          adapter,
          content,
          ...(Object.keys(context).length > 0 ? { context } : {})
        })
      });

      if (response.status === 409) {
        const conflictPayload = (await response.json().catch(() => null)) as
          | { run?: BridgeSessionRun }
          | null;
        if (conflictPayload?.run) {
          setActiveRun(conflictPayload.run);
        }
        reportRuntimeAlert(
          "bridge_request_failed",
          "warn",
          `${t(locale, "runAlreadyInProgress")}`,
          response.status
        );
        return;
      }

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
        throw new Error(`Bridge session run failed: ${response.status} ${failedText}`);
      }

      const payload = (await response.json()) as BridgeSessionRunCreateResponse;
      clearRuntimeAlert();
      setInput("");
      pendingAutoScrollSessionIdRef.current = sessionId;
      setMessages((prev) => [...prev, payload.userMessage]);
      setLoadedMessagesSessionId(sessionId);
      await saveMessage(payload.userMessage);
      setActiveRun(payload.run);
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
        adapter,
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

  async function cancelActiveRunOnBackend(): Promise<void> {
    if (!activeConnection || !activeRun) {
      return;
    }

    try {
      const response = await fetch(`${activeConnection.baseUrl}/runs/${activeRun.id}/cancel`, {
        method: "POST",
        headers: buildBridgeHeaders(activeConnection, true)
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
        return;
      }

      const payload = (await response.json()) as BridgeSessionRunCancelResponse;
      setActiveRun(payload.run);
      clearRuntimeAlert();
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
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
                      {session.status === "RUNNING" ? (
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--hint-info-text)",
                            marginRight: 6,
                            flexShrink: 0
                          }}
                        />
                      ) : session.status === "ERROR" ? (
                        <span
                          aria-hidden="true"
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--hint-error-text)",
                            marginRight: 6,
                            flexShrink: 0
                          }}
                        />
                      ) : null}
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

                    <DropdownMenu onOpenChange={setIsAnyDropdownMenuOpen}>
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
          <DropdownMenu onOpenChange={setIsAnyDropdownMenuOpen}>
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
          tabIndex={0}
          aria-label={t(locale, "conversationListA11y")}
          onFocus={() => {
            setIsConversationFocused(true);
          }}
          onKeyUpCapture={handleConversationShortcutKeyUp}
          onBlur={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (nextTarget && event.currentTarget.contains(nextTarget)) {
              return;
            }
            clearConversationKeyboardScrollKeys();
            setIsConversationFocused(false);
          }}
          onKeyDownCapture={handleConversationShortcut}
          onMouseDown={(event) => {
            const target = event.target as HTMLElement | null;
            if (
              target?.closest(
                "button, a, input, textarea, select, [role='button'], [role='menuitem'], [role='checkbox']"
              )
            ) {
              return;
            }
            if (target?.closest("[data-message-id]")) {
              return;
            }
            focusConversationViewport();
          }}
          style={{
            padding: 14,
            overflow: "auto",
            display: "grid",
            gap: 12,
            alignContent: "start",
            outline: "none"
          }}
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
              const isHighlighted = isConversationFocused && focusedMessageId === msg.id;

              return (
                <article
                  key={msg.id}
                  ref={(element) => {
                    registerMessageItemRef(msg.id, element);
                  }}
                  tabIndex={0}
                  data-message-id={msg.id}
                  data-highlighted={isHighlighted ? "true" : "false"}
                  onFocus={() => {
                    setFocusedMessageId(msg.id);
                  }}
                  style={{
                    maxWidth: "85%",
                    padding: "10px 12px",
                    borderRadius: 12,
                    lineHeight: 1.45,
                    border: "1px solid var(--line)",
                    outline: "none",
                    background:
                      msg.role === "user" ? "var(--message-user-bg)" : "var(--message-assistant-bg)",
                    marginLeft: msg.role === "user" ? "auto" : 0,
                    boxShadow: isHighlighted
                      ? "0 0 0 2px hsl(var(--ring) / 0.35)"
                      : undefined
                  }}
                >
                  {msg.role === "assistant" ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => toggleRawView(msg.id)}
                          style={messageRenderToggleStyle}
                        >
                          {showRaw ? "格式化" : "查看原文"}
                        </button>
                        {msg.adapter ? (
                          <Badge
                            variant="secondary"
                            className="h-5 rounded-md px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                          >
                            {msg.adapter}
                          </Badge>
                        ) : null}
                      </div>
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
          {activeRun &&
          activeRun.sessionId === activeSessionId &&
          (isRunInFlight(activeRun.status) ||
            activeRun.status === "FAILED" ||
            activeRun.status === "CANCELLED") ? (
            <div
              style={
                activeRun.status === "FAILED"
                  ? hintErrorStyle
                  : activeRun.status === "CANCELLED"
                    ? hintWarnStyle
                    : hintInfoStyle
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs">
                  {t(locale, "runStatusLabel")} {formatRunStatus(locale, activeRun.status)} ·{" "}
                  {activeRun.adapter}
                </span>
                {isRunInFlight(activeRun.status) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void cancelActiveRunOnBackend()}
                    disabled={activeRun.status === "CANCELLING"}
                  >
                    {activeRun.status === "CANCELLING" ? t(locale, "stopping") : t(locale, "stopRun")}
                  </Button>
                ) : null}
              </div>
              {activeRun.errorMessage &&
              (activeRun.status === "FAILED" || activeRun.status === "CANCELLED") ? (
                <div style={{ marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
                  {activeRun.errorMessage}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t(locale, "adapter")}</span>
              <Select
                value={adapter}
                onOpenChange={setIsAdapterSelectOpen}
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
            ref={composerTextareaRef}
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                return;
              }
              event.preventDefault();
              event.currentTarget.blur();
              focusConversationViewport();
            }}
            placeholder={t(locale, "placeholder")}
            className="min-h-[76px] resize-y"
          />
          <Button
            type="button"
            disabled={pending || isActiveRunBusy}
            onClick={() => void send()}
            style={{ opacity: pending || isActiveRunBusy ? 0.6 : 1 }}
          >
            {pending ? "..." : t(locale, "send")}
          </Button>
        </footer>
      </main>

      <Dialog
        open={previewDialogOpen}
        onOpenChange={(open) => {
          setPreviewDialogOpen(open);
          if (!open) {
            setPreviewMessageId(undefined);
            window.requestAnimationFrame(() => {
              focusConversationViewport();
            });
          }
        }}
      >
        <DialogContent
          className="h-[92vh] w-[96vw] max-w-none p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            previewViewportRef.current?.focus({ preventScroll: true });
          }}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <DialogTitle>{t(locale, "messagePreviewTitle")}</DialogTitle>
              {previewMessage?.role === "assistant" ? (
                <button
                  type="button"
                  onClick={() => toggleRawView(previewMessage.id)}
                  style={messageRenderToggleStyle}
                >
                  {rawViewByMessageId[previewMessage.id] ? "格式化" : "查看原文"}
                </button>
              ) : null}
            </div>
            <div
              ref={previewViewportRef}
              tabIndex={0}
              onKeyDown={handlePreviewShortcut}
              onKeyUp={handlePreviewShortcutKeyUp}
              onBlur={() => {
                clearPreviewKeyboardScrollKeys();
              }}
              className="min-h-0 flex-1 overflow-auto outline-none"
              style={{
                paddingBlock: "clamp(12px, 2.2vh, 28px)",
                paddingInline: "clamp(8px, 1.8vw, 20px)"
              }}
            >
              {previewMessage ? (
                <div
                  style={{
                    marginInline: "auto",
                    width: "100%",
                    maxWidth: "min(150ch, 100%)",
                    lineHeight: 1.65
                  }}
                >
                  {previewMessage.role === "assistant" ? (
                    rawViewByMessageId[previewMessage.id] ? (
                      <pre style={{ ...rawMessageContentStyle, margin: 0 }}>
                        <code>{previewMessage.content}</code>
                      </pre>
                    ) : (
                      <MarkdownMessage content={previewMessage.content} />
                    )
                  ) : (
                    <span style={{ whiteSpace: "pre-wrap" }}>{previewMessage.content}</span>
                  )}
                </div>
              ) : (
                <div style={{ color: "var(--muted-text)", fontSize: 13 }}>{t(locale, "previewMessageMissing")}</div>
              )}

              <div className="mt-3 text-xs text-muted-foreground">{t(locale, "previewShortcutHint")}</div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

async function fetchLatestSessionRun(
  connection: BridgeConnection,
  sessionId: string
): Promise<BridgeSessionRun | null> {
  const response = await fetchBridgeJson<BridgeSessionRunsResponse>(
    connection,
    `/sessions/${sessionId}/runs?limit=1`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.runs[0] ?? null;
}

async function pollMessagesFromBackend(
  connection: BridgeConnection,
  sessionId: string
): Promise<ChatMessage[] | null> {
  const response = await fetchBridgeJson<BridgeSessionMessagesResponse>(
    connection,
    `/sessions/${sessionId}/messages?afterSeq=0&limit=500`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  await saveMessages(response.data.messages).catch(() => undefined);
  return response.data.messages;
}

async function fetchRunById(connection: BridgeConnection, runId: string): Promise<BridgeSessionRun | null> {
  const response = await fetchBridgeJson<BridgeSessionRunResponse>(
    connection,
    `/runs/${runId}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.run;
}

function isRunInFlight(status: BridgeSessionRun["status"]): boolean {
  return status === "QUEUED" || status === "RUNNING" || status === "CANCELLING";
}

function formatRunStatus(locale: Locale, status: BridgeSessionRun["status"]): string {
  if (status === "QUEUED") return t(locale, "runStatusQueued");
  if (status === "RUNNING") return t(locale, "runStatusRunning");
  if (status === "CANCELLING") return t(locale, "runStatusCancelling");
  if (status === "SUCCEEDED") return t(locale, "runStatusSucceeded");
  if (status === "FAILED") return t(locale, "runStatusFailed");
  return t(locale, "runStatusCancelled");
}

async function fetchBridgeJson<T>(
  connection: BridgeConnection,
  path: string
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await fetch(`${connection.baseUrl}${path}`, {
    headers: buildBridgeHeaders(connection),
    cache: "no-store"
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
}

function areMessageListsEqual(left: ChatMessage[], right: ChatMessage[]): boolean {
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
      a.sessionId !== b.sessionId ||
      a.seq !== b.seq ||
      a.role !== b.role ||
      a.adapter !== b.adapter ||
      a.content !== b.content ||
      a.createdAt !== b.createdAt
    ) {
      return false;
    }
  }

  return true;
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
