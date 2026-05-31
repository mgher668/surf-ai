import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { STORAGE_KEYS } from "@surf-ai/shared";
import type {
  BridgeChatRequest,
  BridgeConnection,
  ChatMessage,
  ChatSession,
  ExtensionToUiMessage,
  UiSidebarMode,
  UiThemeMode
} from "@surf-ai/shared";
import { listMessagesBySession } from "../../lib/db";
import {
  getActiveConnectionId,
  getActiveSessionId as getStoredActiveSessionId,
  getDefaultAdapter,
  getConnections,
  getLocale,
  getSidebarCollapsed,
  getSidebarMode,
  getTheme,
  getSessions,
  onStorageChanged,
  setActiveSessionId as setStoredActiveSessionId,
  setSidebarCollapsed,
  setSidebarMode,
  setSessions,
  setTheme
} from "../../lib/storage";
import { type Locale, resolveLocale, t } from "../common/i18n";
import { applyTheme, listenSystemThemeChange, normalizeThemeMode } from "../common/theme";
import { ComposerAttachmentPreview } from "./components/ComposerAttachmentPreview";
import { ImagePreviewSliders } from "./components/ImagePreviewSliders";
import { ConversationMessage } from "./components/ConversationMessage";
import { MessagePreviewDialog } from "./components/MessagePreviewDialog";
import { PageContextBanner } from "./components/PageContextBanner";
import { ProcessTimelineEntry } from "./components/ProcessTimelineEntry";
import { RenameSessionDialog } from "./components/RenameSessionDialog";
import { RunStatusBanner } from "./components/RunStatusBanner";
import { SessionSidebar } from "./components/SessionSidebar";
import { SidepanelTopbar } from "./components/SidepanelTopbar";
import { useComposerAttachments } from "./hooks/useComposerAttachments";
import { useConversationPreview } from "./hooks/useConversationPreview";
import { useKeyboardScroll } from "./hooks/useKeyboardScroll";
import { usePageContext } from "./hooks/usePageContext";
import { useRuntimeAlert } from "./hooks/useRuntimeAlert";
import { useSessionActions } from "./hooks/useSessionActions";
import { useSidepanelModels } from "./hooks/useSidepanelModels";
import { useSidepanelRuns } from "./hooks/useSidepanelRuns";
import { useSidepanelSend } from "./hooks/useSidepanelSend";
import { useSidepanelTts } from "./hooks/useSidepanelTts";
import {
  fetchSessionsFromBackend,
  loadMessagesFromBackend,
  updateSessionAdapterOnBackend
} from "./api/sessionApi";
import {
  areSessionListsEqual,
  buildComposerGalleryImages,
  buildConversationTimelineItems,
  buildSessionGalleryImages,
  buildSessionProcessTimelineItems,
  isRunInFlight,
  mergeSessionsWithLocalAdapters,
  normalizeSidebarMode,
  pickDisplayAssistantText
} from "./utils/sidepanel-helpers";
import {
  dragOverlayCardStyle,
  dragOverlayStyle,
  hintErrorStyle,
  hintInfoStyle,
  hintWarnStyle
} from "./styles";
import { Button } from "../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider } from "../components/ui/sidebar";

const BACKEND_DRAFT_SESSION_ID = "__backend_draft__";
const AUTO_MODEL_ID = "auto";
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
type SessionMode = "backend" | "local";

export function App(): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(navigator.language));
  const [themeMode, setThemeModeState] = useState<UiThemeMode>("system");
  const [sidebarMode, setSidebarModeState] = useState<UiSidebarMode>("docked");
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [sidebarOverlayOpen, setSidebarOverlayOpen] = useState(false);

  const [connections, setConnectionsState] = useState<BridgeConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | undefined>();
  const [defaultAdapter, setDefaultAdapterState] = useState<BridgeChatRequest["adapter"] | undefined>();
  const [sessions, setSessionsState] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [sessionMode, setSessionMode] = useState<SessionMode>("local");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [adapter, setAdapter] = useState<BridgeChatRequest["adapter"]>("mock");
  const [pending, setPending] = useState(false);
  const [isAnyDropdownMenuOpen, setIsAnyDropdownMenuOpen] = useState(false);
  const [isAdapterSelectOpen, setIsAdapterSelectOpen] = useState(false);
  const [loadedMessagesSessionId, setLoadedMessagesSessionId] = useState<string | undefined>();
  const conversationViewportRef = useRef<HTMLElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const pendingAutoScrollSessionIdRef = useRef<string | undefined>(undefined);
  const preferredActiveSessionIdRef = useRef<string | undefined>(undefined);

  const KEYBOARD_SCROLL_SPEED_PX_PER_SECOND = 780;
  const {
    composerAttachments,
    composerAttachmentError,
    isDragOverlayVisible,
    setComposerAttachmentError,
    clearComposerAttachments,
    removeComposerAttachment,
    handleComposerFileInputChange,
    handleComposerPaste,
    resetDragOverlay,
    handleConversationDragEnter,
    handleConversationDragOver,
    handleConversationDragLeave,
    handleConversationDrop
  } = useComposerAttachments({
    locale,
    maxAttachmentsPerMessage: MAX_ATTACHMENTS_PER_MESSAGE,
    maxAttachmentBytes: MAX_ATTACHMENT_BYTES
  });
  const conversationKeyboardScroll = useKeyboardScroll(
    conversationViewportRef,
    KEYBOARD_SCROLL_SPEED_PX_PER_SECOND
  );
  const previewKeyboardScroll = useKeyboardScroll(
    previewViewportRef,
    KEYBOARD_SCROLL_SPEED_PX_PER_SECOND
  );

  const isBackendDraftActive =
    sessionMode === "backend" && activeSessionId === BACKEND_DRAFT_SESSION_ID;
  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId),
    [connections, activeConnectionId]
  );
  const {
    runtimeAlert,
    recentAuditEvents,
    reportRuntimeAlert,
    clearRuntimeAlert
  } = useRuntimeAlert(activeConnection);
  const {
    capabilities,
    capabilitiesError,
    model,
    selectedModel,
    availableAdapters,
    availableModels,
    ttsReady,
    selectModelForAdapter
  } = useSidepanelModels({
    activeConnection,
    locale,
    adapter,
    setAdapter,
    defaultAdapter,
    backendDraftSessionId: BACKEND_DRAFT_SESSION_ID,
    activeSessionId,
    sessions,
    messages,
    reportRuntimeAlert,
    clearRuntimeAlert
  });
  const { requestTts } = useSidepanelTts({
    activeConnection,
    ttsReady
  });
  const {
    extractingPage,
    extractError,
    pageContent,
    includePageContext,
    selectionContext,
    setIncludePageContext,
    consumePendingSelectionPayload,
    applySelectionPayload,
    applyPageContentPayload,
    applyPageContentError,
    extractCurrentPage,
    clearExtractedPageContent,
    clearSelectionAndPageContext
  } = usePageContext({
    input,
    setInput,
    requestTts
  });
  const {
    renameDialogOpen,
    renameTargetSession,
    renameTitleInput,
    setRenameTitleInput,
    renameError,
    setRenameError,
    openRenameDialog,
    closeRenameDialog,
    submitRenameDialog,
    createNewSession,
    rememberSessionAdapter,
    toggleStarSession,
    deleteSession
  } = useSessionActions({
    locale,
    sessionMode,
    backendDraftSessionId: BACKEND_DRAFT_SESSION_ID,
    activeConnection,
    sessions,
    setSessionsState,
    activeSessionId,
    setActiveSessionId,
    setMessages,
    clearSelectionAndPageContext,
    createLocalSession: createSession,
    reportRuntimeAlert,
    clearRuntimeAlert
  });
  const {
    activeRun,
    setActiveRun,
    sessionRunProcesses,
    streamAssistantByPhase,
    runStreamError,
    resetRunState,
    handleRunCreated,
    cancelActiveRunOnBackend,
    submitApprovalDecision
  } = useSidepanelRuns({
    sessionMode,
    activeConnectionId,
    activeConnection,
    activeSessionId,
    isBackendDraftActive,
    locale,
    setMessages,
    setLoadedMessagesSessionId,
    setPending,
    setSessionsState,
    persistSessions: setSessions,
    pendingAutoScrollSessionIdRef,
    reportRuntimeAlert,
    clearRuntimeAlert
  });
  const isActiveRunBusy = Boolean(
    activeRun &&
      activeRun.sessionId === activeSessionId &&
      (activeRun.status === "QUEUED" ||
        activeRun.status === "RUNNING" ||
        activeRun.status === "CANCELLING")
  );
  const { send } = useSidepanelSend({
    input,
    setInput,
    composerAttachments,
    clearComposerAttachments,
    setComposerAttachmentError,
    activeConnection,
    activeSessionId,
    setActiveSessionId,
    sessionMode,
    backendDraftSessionId: BACKEND_DRAFT_SESSION_ID,
    sessions,
    setSessionsState,
    messages,
    setMessages,
    setLoadedMessagesSessionId,
    setPending,
    isActiveRunBusy,
    adapter,
    model,
    selectedModel,
    selectionContext,
    pageContent,
    includePageContext,
    clearExtractedPageContent,
    pendingAutoScrollSessionIdRef,
    createLocalSession: createSession,
    setActiveRun,
    handleRunCreated,
    locale,
    reportRuntimeAlert,
    clearRuntimeAlert
  });
  const isKeyboardShortcutBlocked =
    renameDialogOpen || isAnyDropdownMenuOpen || isAdapterSelectOpen || sidebarOverlayOpen;
  const sessionGalleryImages = useMemo(
    () => buildSessionGalleryImages(messages, activeConnection, locale),
    [messages, activeConnection, locale]
  );
  const photoSliderImages = useMemo(
    () => sessionGalleryImages.map((item) => ({ key: item.key, src: item.src })),
    [sessionGalleryImages]
  );
  const composerGalleryImages = useMemo(
    () => buildComposerGalleryImages(composerAttachments, locale),
    [composerAttachments, locale]
  );
  const composerPhotoSliderImages = useMemo(
    () => composerGalleryImages.map((item) => ({ key: item.key, src: item.src })),
    [composerGalleryImages]
  );
  const {
    rawViewByMessageId,
    isConversationFocused,
    setIsConversationFocused,
    focusedMessageId,
    setFocusedMessageId,
    previewDialogOpen,
    setPreviewDialogOpen,
    previewMessage,
    previewMessageId,
    setPreviewMessageId,
    imagePreviewVisible,
    setImagePreviewVisible,
    imagePreviewIndex,
    setImagePreviewIndex,
    composerImagePreviewVisible,
    setComposerImagePreviewVisible,
    composerImagePreviewIndex,
    setComposerImagePreviewIndex,
    toggleRawView,
    focusConversationViewport,
    registerMessageItemRef,
    openImagePreview,
    openComposerImagePreview,
    clearConversationKeyboardScrollKeys,
    clearPreviewKeyboardScrollKeys,
    handleConversationShortcut,
    handleConversationShortcutKeyUp,
    handlePreviewShortcut,
    handlePreviewShortcutKeyUp,
    resetEmptyConversationUiState,
    resetSessionConversationUiState
  } = useConversationPreview({
    messages,
    sessionGalleryImages,
    composerGalleryImages,
    conversationViewportRef,
    composerTextareaRef,
    previewViewportRef,
    conversationKeyboardScroll,
    previewKeyboardScroll,
    isKeyboardShortcutBlocked
  });
  const streamAssistantDisplayText = useMemo(
    () => pickDisplayAssistantText(streamAssistantByPhase),
    [streamAssistantByPhase]
  );
  const canSend = input.trim().length > 0 || composerAttachments.length > 0;

  const visibleMessages = useMemo(() => {
    if (
      !activeRun ||
      !activeSessionId ||
      activeRun.sessionId !== activeSessionId ||
      !isRunInFlight(activeRun.status) ||
      !streamAssistantDisplayText
    ) {
      return messages;
    }

    const syntheticAssistantMessage: ChatMessage = {
      id: `stream-assistant-${activeRun.id}`,
      sessionId: activeSessionId,
      role: "assistant",
      adapter: activeRun.adapter,
      model: activeRun.model ?? model,
      content: streamAssistantDisplayText,
      createdAt: Date.now()
    };

    return [...messages, syntheticAssistantMessage];
  }, [activeRun, activeSessionId, messages, streamAssistantDisplayText, adapter, model]);
  const processTimelineItems = useMemo(
    () => buildSessionProcessTimelineItems(sessionRunProcesses),
    [sessionRunProcesses]
  );
  const conversationTimelineItems = useMemo(
    () => buildConversationTimelineItems(visibleMessages, processTimelineItems),
    [visibleMessages, processTimelineItems]
  );

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

      const sidebarModeChange = changes[STORAGE_KEYS.sidebarMode];
      if (sidebarModeChange) {
        const nextMode = normalizeSidebarMode(sidebarModeChange.newValue);
        setSidebarModeState(nextMode);
        if (nextMode === "docked") {
          setSidebarOverlayOpen(false);
        }
      }

      const sidebarCollapsedChange = changes[STORAGE_KEYS.sidebarCollapsed];
      if (sidebarCollapsedChange) {
        setSidebarCollapsedState(Boolean(sidebarCollapsedChange.newValue));
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
        applyPageContentPayload(message.payload);
        return;
      }

      if (message?.type === "page_content_error") {
        applyPageContentError(message.payload.message);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "b") {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, select, [contenteditable='true'], [role='textbox']"
        )
      ) {
        return;
      }

      event.preventDefault();
      if (sidebarMode === "overlay") {
        setSidebarOverlayOpen((previous) => !previous);
        return;
      }
      void updateSidebarCollapsedValue(!sidebarCollapsed);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarMode, sidebarCollapsed]);

  useEffect(() => {
    if (!activeSessionId || isBackendDraftActive) {
      setMessages([]);
      setLoadedMessagesSessionId(undefined);
      resetRunState();
      resetEmptyConversationUiState();
      clearSelectionAndPageContext();
      return;
    }

    resetSessionConversationUiState();
    clearSelectionAndPageContext();
    resetRunState();
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
    if (
      visibleMessages.length > 0 &&
      visibleMessages[visibleMessages.length - 1]?.sessionId !== activeSessionId
    ) {
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
  }, [visibleMessages, activeSessionId, isBackendDraftActive, loadedMessagesSessionId]);

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
        const loadedMessages = await loadMessagesFromBackend(
          activeConnection,
          sessionId,
          getBackendRuntimeHandlers()
        );
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
    if (sessionMode !== "backend" || !activeConnection) {
      return;
    }

    let stopped = false;

    const sync = async (): Promise<void> => {
      const backendSessions = await fetchSessionsFromBackend(
        activeConnection,
        getBackendRuntimeHandlers()
      );
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
    if (!activeSessionId || activeSessionId === BACKEND_DRAFT_SESSION_ID) {
      return;
    }
    preferredActiveSessionIdRef.current = activeSessionId;
    void setStoredActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  function getBackendRuntimeHandlers() {
    return {
      locale,
      reportRuntimeAlert,
      clearRuntimeAlert
    };
  }

  async function bootstrap(): Promise<void> {
    const [storedLocale, storedDefaultAdapter, storedTheme, storedSidebarMode, storedSidebarCollapsed] =
      await Promise.all([
        getLocale(),
        getDefaultAdapter(),
        getTheme(),
        getSidebarMode(),
        getSidebarCollapsed()
      ]);
    if (storedLocale) {
      setLocaleState(resolveLocale(storedLocale));
    }
    setDefaultAdapterState(storedDefaultAdapter);
    setThemeModeState(normalizeThemeMode(storedTheme));
    setSidebarModeState(normalizeSidebarMode(storedSidebarMode));
    setSidebarCollapsedState(storedSidebarCollapsed);
    if (normalizeSidebarMode(storedSidebarMode) === "docked") {
      setSidebarOverlayOpen(false);
    }

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
      const backendSessions = await fetchSessionsFromBackend(
        resolvedActiveConnection,
        getBackendRuntimeHandlers()
      );
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

  async function updateSidebarModeValue(nextMode: UiSidebarMode): Promise<void> {
    setSidebarModeState(nextMode);
    await setSidebarMode(nextMode);
    if (nextMode === "docked") {
      setSidebarOverlayOpen(false);
      if (sidebarCollapsed) {
        setSidebarCollapsedState(false);
        await setSidebarCollapsed(false);
      }
    }
  }

  async function updateSidebarCollapsedValue(nextCollapsed: boolean): Promise<void> {
    setSidebarCollapsedState(nextCollapsed);
    await setSidebarCollapsed(nextCollapsed);
  }

  function toggleSidebarPanel(): void {
    if (sidebarMode === "overlay") {
      setSidebarOverlayOpen((previous) => !previous);
      return;
    }
    void updateSidebarCollapsedValue(!sidebarCollapsed);
  }

  async function createSessionFromSidebar(): Promise<void> {
    await createNewSession();
    if (sidebarMode === "overlay") {
      setSidebarOverlayOpen(false);
    }
  }

  function selectSessionFromSidebar(sessionId: string): void {
    setActiveSessionId(sessionId);
    if (sidebarMode === "overlay") {
      setSidebarOverlayOpen(false);
    }
  }

  async function openSettingsFromSidebar(): Promise<void> {
    if (sidebarMode === "overlay") {
      setSidebarOverlayOpen(false);
    }
    await openSettingsPage();
  }

  const isSidebarVisible =
    sidebarMode === "overlay" ? sidebarOverlayOpen : !sidebarCollapsed;

  const sessionSidebarContent = (
    <SessionSidebar
      locale={locale}
      sessions={sessions}
      activeSessionId={activeSessionId}
      activeConnection={activeConnection}
      onCreateSession={createSessionFromSidebar}
      onSelectSession={selectSessionFromSidebar}
      onOpenSettings={openSettingsFromSidebar}
      onToggleStarSession={toggleStarSession}
      onOpenRenameDialog={openRenameDialog}
      onDeleteSession={deleteSession}
      onDropdownOpenChange={setIsAnyDropdownMenuOpen}
    />
  );

  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => {
        void updateSidebarCollapsedValue(!open);
      }}
      className="h-[100dvh] w-full"
    >
      <div className="surf-app-shell">
        {sidebarMode === "docked" ? (
          <Sidebar collapsible="offcanvas" className="bg-transparent">
            {sessionSidebarContent}
          </Sidebar>
        ) : null}
        {sidebarMode === "overlay" ? (
          <Sheet open={sidebarOverlayOpen} onOpenChange={setSidebarOverlayOpen}>
            <SheetContent side="left" className="w-[min(360px,88vw)] max-w-none p-0">
              {sessionSidebarContent}
            </SheetContent>
          </Sheet>
        ) : null}

        <SidebarInset>
          <main
            onDragEnter={handleConversationDragEnter}
            onDragOver={handleConversationDragOver}
            onDragLeave={handleConversationDragLeave}
            onDrop={handleConversationDrop}
            onDragEnd={resetDragOverlay}
            className="surf-main-grid"
          >
            <SidepanelTopbar
              locale={locale}
              sidebarMode={sidebarMode}
              themeMode={themeMode}
              isSidebarVisible={isSidebarVisible}
              onToggleSidebarPanel={toggleSidebarPanel}
              onUpdateSidebarModeValue={updateSidebarModeValue}
              onUpdateThemeMode={updateThemeMode}
              onOpenStandalonePage={openStandalonePage}
              onOpenSettingsPage={openSettingsPage}
              onDropdownOpenChange={setIsAnyDropdownMenuOpen}
            />

        {isDragOverlayVisible ? (
          <div style={dragOverlayStyle}>
            <div style={dragOverlayCardStyle}>
              <strong style={{ fontSize: 14 }}>{t(locale, "composerDropOverlayTitle")}</strong>
              <div style={{ fontSize: 12, opacity: 0.9 }}>{t(locale, "composerDropOverlayHint")}</div>
            </div>
          </div>
        ) : null}

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
          className="surf-conversation-viewport"
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
          {conversationTimelineItems.length === 0 ? (
            <div className="surf-empty-state">
              <span className="surf-empty-kicker">Surf AI</span>
              <strong className="surf-empty-title">{t(locale, "empty")}</strong>
              <span className="text-sm leading-relaxed text-muted-foreground">
                {activeConnection
                  ? t(locale, "placeholder")
                  : t(locale, "noActiveConnectionHint")}
              </span>
            </div>
          ) : (
            conversationTimelineItems.map((item) => {
              if (item.kind === "message") {
                return (
                  <ConversationMessage
                    key={item.id}
                    itemId={item.id}
                    message={item.message}
                    locale={locale}
                    activeConnection={activeConnection}
                    showRaw={
                      item.message.role === "assistant" &&
                      Boolean(rawViewByMessageId[item.message.id])
                    }
                    isHighlighted={
                      isConversationFocused && focusedMessageId === item.message.id
                    }
                    registerMessageItemRef={registerMessageItemRef}
                    toggleRawView={toggleRawView}
                    openImagePreview={openImagePreview}
                    onFocusMessage={setFocusedMessageId}
                    formatAdapterModel={formatAdapterModel}
                  />
                );
              }

              return (
                <ProcessTimelineEntry
                  key={item.id}
                  itemId={item.id}
                  process={item.process}
                  locale={locale}
                  submitApprovalDecision={submitApprovalDecision}
                />
              );
            })
          )}
        </section>

        <footer className="surf-composer">
          {pageContent ? (
            <PageContextBanner
              locale={locale}
              pageContent={pageContent}
              includePageContext={includePageContext}
              onIncludePageContextChange={setIncludePageContext}
            />
          ) : null}
          {activeRun &&
          activeRun.sessionId === activeSessionId &&
          (isRunInFlight(activeRun.status) ||
            activeRun.status === "FAILED" ||
            activeRun.status === "CANCELLED") ? (
            <RunStatusBanner
              activeRun={activeRun}
              runStreamError={runStreamError}
              locale={locale}
              onCancelActiveRun={cancelActiveRunOnBackend}
            />
          ) : null}
          <div className="surf-composer-bar">
            <div className="surf-composer-controls">
              <span className="surf-field-label">{t(locale, "adapter")}</span>
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
                      nextAdapter,
                      getBackendRuntimeHandlers()
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

              <span className="surf-field-label">{t(locale, "model")}</span>
              <Select
                value={model}
                onValueChange={(value) => {
                  selectModelForAdapter(adapter, value);
                }}
              >
                <SelectTrigger className="h-8 w-[176px] bg-card text-xs">
                  <SelectValue placeholder={t(locale, "model")} />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((item) => (
                    <SelectItem key={`${item.adapter}:${item.id}`} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="surf-composer-controls">
              <input
                ref={composerFileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleComposerFileInputChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => composerFileInputRef.current?.click()}
                disabled={pending || isActiveRunBusy}
              >
                {t(locale, "composerAddImages")}
              </Button>
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
          </div>
          {composerAttachments.length > 0 ? (
            <ComposerAttachmentPreview
              locale={locale}
              attachments={composerAttachments}
              maxAttachmentsPerMessage={MAX_ATTACHMENTS_PER_MESSAGE}
              onOpenImagePreview={openComposerImagePreview}
              onRemoveAttachment={removeComposerAttachment}
            />
          ) : null}
          {composerAttachmentError ? <div style={hintErrorStyle}>{composerAttachmentError}</div> : null}
          <Textarea
            ref={composerTextareaRef}
            rows={4}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handleComposerPaste}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                return;
              }
              event.preventDefault();
              event.currentTarget.blur();
              focusConversationViewport();
            }}
            placeholder={t(locale, "placeholder")}
            className="min-h-[84px] resize-y rounded-2xl bg-background text-[13px]"
          />
          <Button
            type="button"
            disabled={pending || isActiveRunBusy || !canSend}
            onClick={() => void send()}
            className="min-h-10"
            style={{ opacity: pending || isActiveRunBusy || !canSend ? 0.6 : 1 }}
          >
            {pending ? "..." : t(locale, "send")}
          </Button>
        </footer>
      </main>

      <MessagePreviewDialog
        locale={locale}
        previewDialogOpen={previewDialogOpen}
        previewMessage={previewMessage}
        previewViewportRef={previewViewportRef}
        rawViewByMessageId={rawViewByMessageId}
        activeConnection={activeConnection}
        onOpenChange={(open) => {
          setPreviewDialogOpen(open);
          if (!open) {
            setPreviewMessageId(undefined);
            window.requestAnimationFrame(() => {
              focusConversationViewport();
            });
          }
        }}
        toggleRawView={toggleRawView}
        openImagePreview={openImagePreview}
        handlePreviewShortcut={handlePreviewShortcut}
        handlePreviewShortcutKeyUp={handlePreviewShortcutKeyUp}
        clearPreviewKeyboardScrollKeys={clearPreviewKeyboardScrollKeys}
      />

      <RenameSessionDialog
        locale={locale}
        open={renameDialogOpen}
        title={renameTitleInput}
        error={renameError}
        onOpenChange={(open) => {
          if (!open) {
            closeRenameDialog();
          }
        }}
        onTitleChange={(title) => {
          setRenameTitleInput(title);
          if (renameError) {
            setRenameError(undefined);
          }
        }}
        onSubmit={submitRenameDialog}
        onCancel={closeRenameDialog}
      />
      <ImagePreviewSliders
        locale={locale}
        sessionGalleryImages={sessionGalleryImages}
        sessionPhotoSliderImages={photoSliderImages}
        sessionImagePreviewVisible={imagePreviewVisible}
        sessionImagePreviewIndex={imagePreviewIndex}
        onCloseSessionImagePreview={() => {
          setImagePreviewVisible(false);
        }}
        onSessionImagePreviewIndexChange={setImagePreviewIndex}
        composerGalleryImages={composerGalleryImages}
        composerPhotoSliderImages={composerPhotoSliderImages}
        composerImagePreviewVisible={composerImagePreviewVisible}
        composerImagePreviewIndex={composerImagePreviewIndex}
        onCloseComposerImagePreview={() => {
          setComposerImagePreviewVisible(false);
        }}
        onComposerImagePreviewIndexChange={setComposerImagePreviewIndex}
      />
        </SidebarInset>
      </div>
    </SidebarProvider>
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

function formatAdapterModel(adapter: string, model: string | undefined): string {
  return `${adapter} / ${model?.trim() || AUTO_MODEL_ID}`;
}
