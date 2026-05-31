import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { STORAGE_KEYS } from "@surf-ai/shared";
import type {
  BridgeChatRequest,
  BridgeConnection,
  BridgeSessionRun,
  BridgeSessionRunCancelResponse,
  BridgeSessionRunCreateResponse,
  BridgeSessionRunApprovalDecisionRequest,
  BridgeSessionRunApprovalDecisionResponse,
  BridgeRunApproval,
  BridgeUploadCreateResponse,
  BridgeRunStreamEvent,
  ChatMessage,
  ChatSession,
  ExtensionToUiMessage,
  BridgeTtsResponse,
  UiSidebarMode,
  UiThemeMode
} from "@surf-ai/shared";
import { deleteMessagesBySession, listMessagesBySession, saveMessage } from "../../lib/db";
import { openBridgeRunStream, type BridgeRunStreamHandle } from "../../lib/bridge-sse";
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
import { useKeyboardScroll } from "./hooks/useKeyboardScroll";
import { usePageContext } from "./hooks/usePageContext";
import { useRuntimeAlert } from "./hooks/useRuntimeAlert";
import { useSidepanelModels } from "./hooks/useSidepanelModels";
import {
  fetchLatestSessionRun,
  fetchRunApprovalsFromBackend,
  fetchRunEventsFromBackend,
  fetchSessionRunsFromBackend
} from "./api/bridgeApi";
import {
  createSessionOnBackend,
  deleteSessionOnBackend,
  fetchSessionsFromBackend,
  loadMessagesFromBackend,
  renameSessionOnBackend,
  updateSessionAdapterOnBackend,
  updateSessionStarOnBackend
} from "./api/sessionApi";
import {
  areMessageListsEqual,
  areSessionListsEqual,
  buildBridgeHeaders,
  buildChatContext,
  buildComposerGalleryImages,
  buildConversationTimelineItems,
  buildRunArtifacts,
  buildSessionGalleryImages,
  buildSessionProcessTimelineItems,
  createEmptyStreamAssistantByPhase,
  isRunInFlight,
  mergeAssistantCompletedContent,
  mergeSessionsWithLocalAdapters,
  normalizeAssistantStreamPhase,
  normalizeSidebarMode,
  pickDisplayAssistantText,
  upsertApproval,
  type ComposerAttachment,
  type SessionRunProcessState,
  type StreamAssistantByPhase
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
  const [activeRun, setActiveRun] = useState<BridgeSessionRun | undefined>();
  const [runApprovals, setRunApprovals] = useState<BridgeRunApproval[]>([]);
  const [runEvents, setRunEvents] = useState<BridgeRunStreamEvent[]>([]);
  const [sessionRunProcesses, setSessionRunProcesses] = useState<
    Record<string, SessionRunProcessState>
  >({});
  const [streamAssistantByPhase, setStreamAssistantByPhase] = useState<StreamAssistantByPhase>(
    createEmptyStreamAssistantByPhase()
  );
  const [runReasoningSummary, setRunReasoningSummary] = useState("");
  const [runReasoningText, setRunReasoningText] = useState("");
  const [runCommandOutput, setRunCommandOutput] = useState("");
  const [runStreamError, setRunStreamError] = useState<string | undefined>();
  const [rawViewByMessageId, setRawViewByMessageId] = useState<Record<string, boolean>>({});
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
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [composerImagePreviewVisible, setComposerImagePreviewVisible] = useState(false);
  const [composerImagePreviewIndex, setComposerImagePreviewIndex] = useState(0);
  const [loadedMessagesSessionId, setLoadedMessagesSessionId] = useState<string | undefined>();
  const conversationViewportRef = useRef<HTMLElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const runStreamRef = useRef<BridgeRunStreamHandle | null>(null);
  const messageItemRefs = useRef(new Map<string, HTMLElement>());
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
  const isActiveRunBusy = Boolean(
    activeRun &&
      activeRun.sessionId === activeSessionId &&
      (activeRun.status === "QUEUED" ||
        activeRun.status === "RUNNING" ||
        activeRun.status === "CANCELLING")
  );
  const isKeyboardShortcutBlocked =
    renameDialogOpen || isAnyDropdownMenuOpen || isAdapterSelectOpen || sidebarOverlayOpen;
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
  const previewMessage = useMemo(
    () => messages.find((item) => item.id === previewMessageId),
    [messages, previewMessageId]
  );
  const sessionGalleryImages = useMemo(
    () => buildSessionGalleryImages(messages, activeConnection, locale),
    [messages, activeConnection, locale]
  );
  const sessionGalleryIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>();
    sessionGalleryImages.forEach((image, index) => {
      indexByKey.set(image.key, index);
    });
    return indexByKey;
  }, [sessionGalleryImages]);
  const photoSliderImages = useMemo(
    () => sessionGalleryImages.map((item) => ({ key: item.key, src: item.src })),
    [sessionGalleryImages]
  );
  const composerGalleryImages = useMemo(
    () => buildComposerGalleryImages(composerAttachments, locale),
    [composerAttachments, locale]
  );
  const composerGalleryIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>();
    composerGalleryImages.forEach((image, index) => {
      indexByKey.set(image.key, index);
    });
    return indexByKey;
  }, [composerGalleryImages]);
  const composerPhotoSliderImages = useMemo(
    () => composerGalleryImages.map((item) => ({ key: item.key, src: item.src })),
    [composerGalleryImages]
  );
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
      runStreamRef.current?.close();
      runStreamRef.current = null;
      setMessages([]);
      setLoadedMessagesSessionId(undefined);
      setActiveRun(undefined);
      setRunApprovals([]);
      setRunEvents([]);
      setSessionRunProcesses({});
      setStreamAssistantByPhase(createEmptyStreamAssistantByPhase());
      setRunReasoningSummary("");
      setRunReasoningText("");
      setRunCommandOutput("");
      setRunStreamError(undefined);
      setFocusedMessageId(undefined);
      setPreviewDialogOpen(false);
      setPreviewMessageId(undefined);
      setImagePreviewVisible(false);
      setImagePreviewIndex(0);
      setRawViewByMessageId({});
      clearSelectionAndPageContext();
      return;
    }

    setRawViewByMessageId({});
    clearSelectionAndPageContext();
    setImagePreviewVisible(false);
    setImagePreviewIndex(0);
    setRunApprovals([]);
    setRunEvents([]);
    setSessionRunProcesses({});
    setStreamAssistantByPhase(createEmptyStreamAssistantByPhase());
    setRunReasoningSummary("");
    setRunReasoningText("");
    setRunCommandOutput("");
    setRunStreamError(undefined);
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

  useEffect(() => {
    if (!imagePreviewVisible) {
      return;
    }
    if (sessionGalleryImages.length === 0) {
      setImagePreviewVisible(false);
      setImagePreviewIndex(0);
      return;
    }
    if (imagePreviewIndex >= sessionGalleryImages.length) {
      setImagePreviewIndex(sessionGalleryImages.length - 1);
    }
  }, [imagePreviewVisible, imagePreviewIndex, sessionGalleryImages]);

  useEffect(() => {
    if (!composerImagePreviewVisible) {
      return;
    }
    if (composerGalleryImages.length === 0) {
      setComposerImagePreviewVisible(false);
      setComposerImagePreviewIndex(0);
      return;
    }
    if (composerImagePreviewIndex >= composerGalleryImages.length) {
      setComposerImagePreviewIndex(composerGalleryImages.length - 1);
    }
  }, [composerImagePreviewVisible, composerImagePreviewIndex, composerGalleryImages]);

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

  function openImagePreview(imageKey: string): void {
    const index = sessionGalleryIndexByKey.get(imageKey);
    if (typeof index !== "number") {
      return;
    }
    setComposerImagePreviewVisible(false);
    setImagePreviewIndex(index);
    setImagePreviewVisible(true);
  }

  function openComposerImagePreview(imageKey: string): void {
    const index = composerGalleryIndexByKey.get(imageKey);
    if (typeof index !== "number") {
      return;
    }
    setImagePreviewVisible(false);
    setComposerImagePreviewIndex(index);
    setComposerImagePreviewVisible(true);
  }

  function clearConversationKeyboardScrollKeys(): void {
    conversationKeyboardScroll.clearKeyboardScrollKeys();
  }

  function clearPreviewKeyboardScrollKeys(): void {
    previewKeyboardScroll.clearKeyboardScrollKeys();
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
      conversationKeyboardScroll.handleScrollKeyDown(key as "j" | "k");
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
    conversationKeyboardScroll.handleScrollKeyUp(key as "j" | "k");
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
      previewKeyboardScroll.handleScrollKeyDown(key as "j" | "k");
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
    previewKeyboardScroll.handleScrollKeyUp(key as "j" | "k");
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
      isBackendDraftActive
    ) {
      setSessionRunProcesses({});
      return;
    }

    let cancelled = false;
    const sessionId = activeSessionId;

    const load = async (): Promise<void> => {
      const runs = await fetchSessionRunsFromBackend(activeConnection, sessionId, 50);
      if (cancelled || !runs) {
        return;
      }

      const entries = await Promise.all(
        runs.map(async (run) => {
          const [approvals, events] = await Promise.all([
            fetchRunApprovalsFromBackend(activeConnection, sessionId, run.id, "all"),
            fetchRunEventsFromBackend(activeConnection, sessionId, run.id, 5000)
          ]);
          return [
            run.id,
            {
              approvals: approvals ?? [],
              events: events ?? []
            } satisfies SessionRunProcessState
          ] as const;
        })
      );

      if (cancelled) {
        return;
      }
      setSessionRunProcesses(Object.fromEntries(entries));
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    sessionMode,
    activeConnectionId,
    activeConnection?.baseUrl,
    activeConnection?.userId,
    activeConnection?.token,
    activeSessionId,
    isBackendDraftActive
  ]);

  useEffect(() => {
    if (
      sessionMode !== "backend" ||
      !activeConnection ||
      !activeSessionId ||
      isBackendDraftActive ||
      !activeRun ||
      activeRun.sessionId !== activeSessionId
    ) {
      setRunApprovals([]);
      setRunEvents([]);
      setStreamAssistantByPhase(createEmptyStreamAssistantByPhase());
      setRunReasoningSummary("");
      setRunReasoningText("");
      setRunCommandOutput("");
      setRunStreamError(undefined);
      return;
    }

    let cancelled = false;
    const sessionId = activeSessionId;
    const runId = activeRun.id;

    const load = async (): Promise<void> => {
      const [approvals, events] = await Promise.all([
        fetchRunApprovalsFromBackend(activeConnection, sessionId, runId, "all"),
        fetchRunEventsFromBackend(activeConnection, sessionId, runId, 5000)
      ]);
      if (cancelled) {
        return;
      }

      if (approvals) {
        setRunApprovals(approvals);
      }

      if (events) {
        setRunEvents(events);
        const artifacts = buildRunArtifacts(events);
        setStreamAssistantByPhase(artifacts.assistantByPhase);
        setRunReasoningSummary(artifacts.reasoningSummary);
        setRunReasoningText(artifacts.reasoningText);
        setRunCommandOutput(artifacts.commandOutput);
        setRunStreamError(artifacts.errorMessage);
      }

      if (approvals || events) {
        setSessionRunProcesses((prev) => ({
          ...prev,
          [runId]: {
            approvals: approvals ?? prev[runId]?.approvals ?? [],
            events: events ?? prev[runId]?.events ?? []
          }
        }));
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    sessionMode,
    activeConnectionId,
    activeConnection?.baseUrl,
    activeSessionId,
    isBackendDraftActive,
    activeRun?.id
  ]);

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
      runStreamRef.current?.close();
      runStreamRef.current = null;
      return;
    }

    let cancelled = false;
    const sessionId = activeSessionId;
    const runId = activeRun.id;

    setStreamAssistantByPhase(createEmptyStreamAssistantByPhase());
    setRunReasoningSummary("");
    setRunReasoningText("");
    setRunCommandOutput("");
    setRunStreamError(undefined);
    setRunEvents([]);
    setSessionRunProcesses((prev) => ({
      ...prev,
      [runId]: {
        approvals: prev[runId]?.approvals ?? [],
        events: []
      }
    }));

    const applyTerminalSync = async (nextRun: BridgeSessionRun): Promise<void> => {
      const loadedMessages = await loadMessagesFromBackend(
        activeConnection,
        sessionId,
        getBackendRuntimeHandlers()
      );
      if (cancelled) {
        return;
      }
      setMessages((prev) => {
        if (areMessageListsEqual(prev, loadedMessages)) {
          return prev;
        }
        const lastMessage = loadedMessages[loadedMessages.length - 1];
        if (lastMessage?.sessionId === sessionId) {
          pendingAutoScrollSessionIdRef.current = sessionId;
        }
        return loadedMessages;
      });
      setLoadedMessagesSessionId(sessionId);
      setActiveRun(nextRun);
      setPending(false);
      const approvals = await fetchRunApprovalsFromBackend(activeConnection, sessionId, runId, "all");
      if (!cancelled && approvals) {
        setRunApprovals(approvals);
      }
      const events = await fetchRunEventsFromBackend(activeConnection, sessionId, runId, 5000);
      if (!cancelled && events) {
        setRunEvents(events);
      }
      if (!cancelled && (approvals || events)) {
        setSessionRunProcesses((prev) => ({
          ...prev,
          [runId]: {
            approvals: approvals ?? prev[runId]?.approvals ?? [],
            events: events ?? prev[runId]?.events ?? []
          }
        }));
      }

      const backendSessions = await fetchSessionsFromBackend(
        activeConnection,
        getBackendRuntimeHandlers()
      );
      if (!cancelled && backendSessions) {
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

    const onEvent = (event: BridgeRunStreamEvent): void => {
      if (cancelled) {
        return;
      }
      if (event.sessionId !== sessionId || event.runId !== runId) {
        return;
      }
      if (event.type !== "heartbeat") {
        setRunEvents((prev) => {
          if (prev.some((item) => item.eventId === event.eventId)) {
            return prev;
          }
          return [...prev, event];
        });

        setSessionRunProcesses((prev) => {
          const current = prev[runId] ?? { approvals: [], events: [] };
          const hasEvent = current.events.some((item) => item.eventId === event.eventId);
          const nextEvents = hasEvent ? current.events : [...current.events, event];
          const nextApprovals =
            event.type === "approval.requested" || event.type === "approval.updated"
              ? upsertApproval(current.approvals, event.data.approval)
              : current.approvals;

          if (nextEvents === current.events && nextApprovals === current.approvals) {
            return prev;
          }

          return {
            ...prev,
            [runId]: {
              approvals: nextApprovals,
              events: nextEvents
            }
          };
        });
      }

      if (event.type === "assistant.delta") {
        const phase = normalizeAssistantStreamPhase(event.data.phase);
        setStreamAssistantByPhase((prev) => ({
          ...prev,
          [phase]: `${prev[phase]}${event.data.delta}`
        }));
        return;
      }

      if (event.type === "assistant.completed") {
        if (typeof event.data.content === "string") {
          const completedContent = event.data.content;
          const phase = normalizeAssistantStreamPhase(event.data.phase);
          setStreamAssistantByPhase((prev) => ({
            ...prev,
            [phase]: mergeAssistantCompletedContent(phase, prev[phase] ?? "", completedContent)
          }));
        }
        return;
      }

      if (event.type === "reasoning.summary.delta") {
        setRunReasoningSummary((prev) => prev + event.data.delta);
        return;
      }

      if (event.type === "reasoning.text.delta") {
        setRunReasoningText((prev) => prev + event.data.delta);
        return;
      }

      if (event.type === "command.output.delta") {
        setRunCommandOutput((prev) => prev + event.data.delta);
        return;
      }

      if (event.type === "approval.requested" || event.type === "approval.updated") {
        setRunApprovals((prev) => upsertApproval(prev, event.data.approval));
        return;
      }

      if (event.type === "error") {
        setRunStreamError(event.data.message);
        return;
      }

      if (event.type === "run.status") {
        const nextRun = event.data.run;
        if (!isRunInFlight(nextRun.status)) {
          void applyTerminalSync(nextRun);
          return;
        }
        setActiveRun(nextRun);
      }
    };

    const onError = (error: Error): void => {
      if (cancelled) {
        return;
      }
      setRunStreamError(error.message);
    };

    runStreamRef.current?.close();
    const streamHandle = openBridgeRunStream({
      connection: activeConnection,
      sessionId,
      runId,
      onEvent,
      onError
    });
    runStreamRef.current = streamHandle;

    void fetchRunApprovalsFromBackend(activeConnection, sessionId, runId, "all").then((approvals) => {
      if (!approvals || cancelled) {
        return;
      }
      setRunApprovals(approvals);
      setSessionRunProcesses((prev) => ({
        ...prev,
        [runId]: {
          approvals,
          events: prev[runId]?.events ?? []
        }
      }));
    });

    return () => {
      cancelled = true;
      streamHandle.close();
      if (runStreamRef.current === streamHandle) {
        runStreamRef.current = null;
      }
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

  async function createNewSession(): Promise<void> {
    if (sessionMode === "backend") {
      setActiveSessionId(BACKEND_DRAFT_SESSION_ID);
      setMessages([]);
      clearSelectionAndPageContext();
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
      const updated = await updateSessionStarOnBackend(
        activeConnection,
        id,
        !current.starred,
        getBackendRuntimeHandlers()
      );
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

      const updated = await renameSessionOnBackend(
        activeConnection,
        session.id,
        title,
        getBackendRuntimeHandlers()
      );
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
      const deleted = await deleteSessionOnBackend(activeConnection, id, getBackendRuntimeHandlers());
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
    const hasAttachments = composerAttachments.length > 0;
    if (!content && !hasAttachments) {
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
        model,
        content: "Error: no active bridge connection. Please add/select one in Settings first.",
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, errMessage]);
      return;
    }

    if (sessionMode === "backend") {
      let sessionId = activeSessionId;
      if (!sessionId || sessionId === BACKEND_DRAFT_SESSION_ID) {
        const created = await createSessionOnBackend(
          activeConnection,
          "New chat",
          getBackendRuntimeHandlers()
        );
        if (!created) {
          const errMessage: ChatMessage = {
            id: crypto.randomUUID(),
            sessionId: "pending",
            role: "assistant",
            adapter,
            model,
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

      await sendWithBackend(activeConnection, sessionId, content, composerAttachments);
      return;
    }

    if (hasAttachments) {
      setComposerAttachmentError(t(locale, "composerAttachmentBackendOnly"));
      return;
    }

    if (!activeSessionId) {
      const session = createSession("New chat");
      const next = [session, ...sessions];
      await setSessions(next);
      setSessionsState(next);
      setActiveSessionId(session.id);
      await sendWithBackend(activeConnection, session.id, content, composerAttachments);
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      role: "user",
      adapter,
      model,
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
        model,
        ...(adapter === "codex" && selectedModel?.modelReasoningEffort
          ? { modelReasoningEffort: selectedModel.modelReasoningEffort }
          : {}),
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
        model,
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
        model,
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      await saveMessage(errMessage);
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
      clearExtractedPageContent();
    }
  }

  async function sendWithBackend(
    connection: BridgeConnection,
    sessionId: string,
    content: string,
    attachments: ComposerAttachment[]
  ): Promise<void> {
    setPending(true);
    setComposerAttachmentError(undefined);

    try {
      const attachmentIds: string[] = [];
      for (const attachment of attachments) {
        const uploadUrl = new URL("/uploads", connection.baseUrl);
        uploadUrl.searchParams.set("sessionId", sessionId);
        if (attachment.file.name) {
          uploadUrl.searchParams.set("fileName", attachment.file.name);
        }

        const uploadResponse = await fetch(uploadUrl.toString(), {
          method: "POST",
          headers: {
            ...buildBridgeHeaders(connection),
            ...(attachment.mimeType ? { "content-type": attachment.mimeType } : {})
          },
          body: attachment.file
        });

        if (!uploadResponse.ok) {
          if (uploadResponse.status === 401 || uploadResponse.status === 403) {
            reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), uploadResponse.status);
          } else if (uploadResponse.status === 429) {
            reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), uploadResponse.status);
          } else {
            reportRuntimeAlert(
              "bridge_request_failed",
              "warn",
              `${t(locale, "alertBridgeRequestFailed")} (${uploadResponse.status})`,
              uploadResponse.status
            );
          }

          if (uploadResponse.status === 413) {
            setComposerAttachmentError(t(locale, "composerAttachmentFileTooLarge"));
          } else if (uploadResponse.status === 415) {
            setComposerAttachmentError(t(locale, "composerAttachmentTypeNotAllowed"));
          } else {
            setComposerAttachmentError(t(locale, "composerAttachmentUploadFailed"));
          }

          const failedText = await uploadResponse.text();
          throw new Error(`Bridge upload failed: ${uploadResponse.status} ${failedText}`);
        }

        const uploadPayload = (await uploadResponse.json()) as BridgeUploadCreateResponse;
        attachmentIds.push(uploadPayload.attachment.id);
      }

      const context = buildChatContext(selectionContext, pageContent, includePageContext);
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify({
          adapter,
          model,
          ...(adapter === "codex" && selectedModel?.modelReasoningEffort
            ? { modelReasoningEffort: selectedModel.modelReasoningEffort }
            : {}),
          content,
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
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
      clearComposerAttachments();
      setRunApprovals([]);
      setRunEvents([]);
      setSessionRunProcesses((prev) => ({
        ...prev,
        [payload.run.id]: {
          approvals: [],
          events: []
        }
      }));
      setStreamAssistantByPhase(createEmptyStreamAssistantByPhase());
      setRunReasoningSummary("");
      setRunReasoningText("");
      setRunCommandOutput("");
      setRunStreamError(undefined);
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
        model,
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
      clearExtractedPageContent();
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

  async function submitApprovalDecision(
    approval: BridgeRunApproval,
    decision: unknown
  ): Promise<void> {
    if (!activeConnection || !activeSessionId || !activeRun) {
      return;
    }

    try {
      const payload: BridgeSessionRunApprovalDecisionRequest = { decision };
      const response = await fetch(
        `${activeConnection.baseUrl}/sessions/${activeSessionId}/runs/${activeRun.id}/approvals/${approval.approvalRequestId}/decision`,
        {
          method: "POST",
          headers: buildBridgeHeaders(activeConnection, true),
          body: JSON.stringify(payload)
        }
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
        return;
      }

      const result = (await response.json()) as BridgeSessionRunApprovalDecisionResponse;
      setRunApprovals((prev) => upsertApproval(prev, result.approval));
      setSessionRunProcesses((prev) => {
        const current = prev[activeRun.id] ?? { approvals: [], events: [] };
        return {
          ...prev,
          [activeRun.id]: {
            approvals: upsertApproval(current.approvals, result.approval),
            events: current.events
          }
        };
      });
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
