import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { Icon } from "@iconify/react/dist/offline";
import { PhotoSlider } from "react-photo-view";
import dotsVertical from "@iconify-icons/mdi/dots-vertical";
import cogOutline from "@iconify-icons/mdi/cog-outline";
import openInNew from "@iconify-icons/mdi/open-in-new";
import menuIcon from "@iconify-icons/mdi/menu";
import sidebarModeIcon from "@iconify-icons/mdi/page-layout-sidebar-left";
import themeLightDark from "@iconify-icons/mdi/theme-light-dark";
import checkIcon from "@iconify-icons/mdi/check";
import checkAllIcon from "@iconify-icons/mdi/check-all";
import starIcon from "@iconify-icons/mdi/star";
import starOutlineIcon from "@iconify-icons/mdi/star-outline";
import pencilOutline from "@iconify-icons/mdi/pencil-outline";
import deleteOutline from "@iconify-icons/mdi/delete-outline";
import alertCircleOutline from "@iconify-icons/mdi/alert-circle-outline";
import { STORAGE_KEYS } from "@surf-ai/shared";
import type {
  BridgeAssistantMessagePhase,
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
  BridgeSessionRunApprovalDecisionRequest,
  BridgeSessionRunApprovalDecisionResponse,
  BridgeSessionRunApprovalsResponse,
  BridgeSessionRunEventsResponse,
  BridgeSessionRunsResponse,
  BridgeRunApproval,
  BridgeUploadCreateResponse,
  BridgeRunStreamEvent,
  BridgeSessionRenameRequest,
  BridgeSessionRenameResponse,
  BridgeSessionStarRequest,
  ChatMessage,
  ChatMessagePart,
  ChatSession,
  ExtensionToUiMessage,
  BridgeTtsResponse,
  PageContentPayload,
  QuickAction,
  SelectionPayload,
  UiSidebarMode,
  UiThemeMode,
  UiStatusBadgeLevel,
  UiToExtensionMessage,
  UiToExtensionResponse
} from "@surf-ai/shared";
import { deleteMessagesBySession, listMessagesBySession, saveMessage, saveMessages } from "../../lib/db";
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
import { Sheet, SheetContent } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider } from "../components/ui/sidebar";

const ACTION_PROMPT_PREFIX: Record<QuickAction, string> = {
  summarize: "Please summarize this content:",
  translate: "Please translate this content into Chinese and English:",
  read_aloud: "Please prepare this content for read-aloud:",
  ask: "Please help answer based on this content:"
};

const FALLBACK_ADAPTER_OPTIONS: BridgeModel["adapter"][] = ["mock", "codex", "claude"];
const BACKEND_DRAFT_SESSION_ID = "__backend_draft__";
const AUTO_MODEL_ID = "auto";
const AUTO_MODEL_LABEL = "Auto (CLI default)";
const MAX_ATTACHMENTS_PER_MESSAGE = 10;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
type SessionMode = "backend" | "local";
type RuntimeAlertLevel = "warn" | "error";
type RuntimeAlertCode =
  | "backend_unreachable"
  | "auth_failed"
  | "rate_limited"
  | "bridge_request_failed";
type StreamAssistantByPhase = Record<BridgeAssistantMessagePhase, string>;

interface RuntimeAlert {
  code: RuntimeAlertCode;
  level: RuntimeAlertLevel;
  message: string;
  statusCode?: number;
  updatedAt: number;
}

function createEmptyStreamAssistantByPhase(): StreamAssistantByPhase {
  return {
    commentary: "",
    final_answer: "",
    unknown: ""
  };
}

interface RunArtifacts {
  assistantByPhase: StreamAssistantByPhase;
  reasoningSummary: string;
  reasoningText: string;
  commandOutput: string;
  errorMessage?: string;
}

interface SessionRunProcessState {
  events: BridgeRunStreamEvent[];
  approvals: BridgeRunApproval[];
}

interface ProcessTimelineItem {
  id: string;
  ts: number;
  kind:
    | "approval"
    | "commentary"
    | "reasoning_summary"
    | "reasoning_text"
    | "command_output"
    | "runtime_error";
  approval?: BridgeRunApproval;
  content?: string;
  segments?: string[];
  message?: string;
}

interface ComposerAttachment {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  sizeBytes: number;
}

interface SessionGalleryImage {
  key: string;
  src: string;
  alt: string;
  fileName?: string;
}

type ConversationTimelineItem =
  | {
      id: string;
      ts: number;
      kind: "message";
      message: ChatMessage;
    }
  | {
      id: string;
      ts: number;
      kind: "process";
      process: ProcessTimelineItem;
    };

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
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [composerAttachmentError, setComposerAttachmentError] = useState<string | undefined>();
  const [isDragOverlayVisible, setIsDragOverlayVisible] = useState(false);
  const [adapter, setAdapter] = useState<BridgeChatRequest["adapter"]>("mock");
  const [capabilities, setCapabilities] = useState<BridgeCapabilitiesResponse | undefined>();
  const [capabilitiesError, setCapabilitiesError] = useState<string | undefined>();
  const [models, setModelsState] = useState<BridgeModel[]>([]);
  const [model, setModel] = useState<string>(AUTO_MODEL_ID);
  const [modelByAdapter, setModelByAdapter] = useState<
    Partial<Record<BridgeChatRequest["adapter"], string>>
  >({});
  const [runtimeAlert, setRuntimeAlert] = useState<RuntimeAlert | undefined>();
  const [recentAuditEvents, setRecentAuditEvents] = useState<BridgeAuditEvent[]>([]);
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
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [loadedMessagesSessionId, setLoadedMessagesSessionId] = useState<string | undefined>();
  const conversationViewportRef = useRef<HTMLElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerFileInputRef = useRef<HTMLInputElement | null>(null);
  const previewViewportRef = useRef<HTMLDivElement | null>(null);
  const runStreamRef = useRef<BridgeRunStreamHandle | null>(null);
  const messageItemRefs = useRef(new Map<string, HTMLElement>());
  const conversationScrollLoopRef = useRef<number | null>(null);
  const conversationScrollLastTsRef = useRef<number | null>(null);
  const conversationScrollKeysRef = useRef({ j: false, k: false });
  const previewScrollLoopRef = useRef<number | null>(null);
  const previewScrollLastTsRef = useRef<number | null>(null);
  const previewScrollKeysRef = useRef({ j: false, k: false });
  const pendingAutoScrollSessionIdRef = useRef<string | undefined>(undefined);
  const preferredActiveSessionIdRef = useRef<string | undefined>(undefined);
  const composerAttachmentsRef = useRef<ComposerAttachment[]>([]);
  const dragDepthRef = useRef(0);

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
  const isKeyboardShortcutBlocked =
    renameDialogOpen || isAnyDropdownMenuOpen || isAdapterSelectOpen || sidebarOverlayOpen;
  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId),
    [connections, activeConnectionId]
  );
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
  const activeGalleryImage =
    sessionGalleryImages.length > 0
      ? sessionGalleryImages[Math.min(imagePreviewIndex, sessionGalleryImages.length - 1)]
      : undefined;
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

  const availableAdapters = useMemo(() => {
    const serverAdapters = capabilities?.chat.adapters.filter((item) => item.enabled);
    if (serverAdapters && serverAdapters.length > 0) {
      return serverAdapters.map((item) => ({ adapter: item.adapter, label: item.label }));
    }
    return FALLBACK_ADAPTER_OPTIONS.map((item) => ({ adapter: item, label: item }));
  }, [capabilities]);

  const availableModels = useMemo(() => {
    const items = models.filter((item) => item.adapter === adapter && item.enabled);
    if (items.length === 0) {
      return [
        {
          id: AUTO_MODEL_ID,
          adapter,
          label: AUTO_MODEL_LABEL,
          enabled: true,
          isDefault: true
        } satisfies BridgeModel
      ];
    }
    return [...items].sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }, [models, adapter]);

  const selectedModel = useMemo(
    () =>
      availableModels.find((item) => item.id === model) ??
      availableModels.find((item) => item.isDefault) ??
      availableModels[0],
    [availableModels, model]
  );

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
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => {
    return () => {
      revokeComposerAttachmentPreviews(composerAttachmentsRef.current);
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
    setImagePreviewIndex(index);
    setImagePreviewVisible(true);
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

  function appendComposerFiles(rawFiles: File[]): void {
    if (rawFiles.length === 0) {
      return;
    }

    const nextAttachments = [...composerAttachments];
    let nextError: string | undefined;

    for (const file of rawFiles) {
      if (nextAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        nextError ??= t(locale, "composerAttachmentLimitExceeded");
        break;
      }

      if (!file.type.startsWith("image/")) {
        nextError ??= t(locale, "composerAttachmentTypeNotAllowed");
        continue;
      }

      if (file.size > MAX_ATTACHMENT_BYTES) {
        nextError ??= t(locale, "composerAttachmentFileTooLarge");
        continue;
      }

      nextAttachments.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size
      });
    }

    setComposerAttachments(nextAttachments);
    setComposerAttachmentError(nextError);
  }

  function clearComposerAttachments(): void {
    setComposerAttachments((prev) => {
      revokeComposerAttachmentPreviews(prev);
      return [];
    });
  }

  function removeComposerAttachment(attachmentId: string): void {
    setComposerAttachments((prev) => {
      const target = prev.find((item) => item.id === attachmentId);
      if (!target) {
        return prev;
      }

      URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== attachmentId);
    });
  }

  function handleComposerFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length > 0) {
      appendComposerFiles(files);
    }
    event.target.value = "";
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    appendComposerFiles(files);
  }

  function isFileDropEvent(event: ReactDragEvent<HTMLElement>): boolean {
    const dataTransferTypes = event.dataTransfer?.types;
    return Array.from(dataTransferTypes ?? []).includes("Files");
  }

  function resetDragOverlay(): void {
    dragDepthRef.current = 0;
    setIsDragOverlayVisible(false);
  }

  function handleConversationDragEnter(event: ReactDragEvent<HTMLElement>): void {
    if (!isFileDropEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverlayVisible(true);
  }

  function handleConversationDragOver(event: ReactDragEvent<HTMLElement>): void {
    if (!isFileDropEvent(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragOverlayVisible) {
      setIsDragOverlayVisible(true);
    }
  }

  function handleConversationDragLeave(event: ReactDragEvent<HTMLElement>): void {
    if (!isDragOverlayVisible) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOverlayVisible(false);
    }
  }

  function handleConversationDrop(event: ReactDragEvent<HTMLElement>): void {
    event.preventDefault();
    resetDragOverlay();
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      appendComposerFiles(droppedFiles);
    }
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
      const loadedMessages = await loadMessagesFromBackend(activeConnection, sessionId);
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

      const backendSessions = await fetchSessionsFromBackend(activeConnection);
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
    void bootstrapCapabilities(activeConnection);
  }, [activeConnection]);

  useEffect(() => {
    void bootstrapModels(activeConnection);
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
    const hasCurrentModel = availableModels.some((item) => item.id === model);
    if (hasCurrentModel) {
      return;
    }

    const preferredByAdapter = modelByAdapter[adapter];
    if (preferredByAdapter && availableModels.some((item) => item.id === preferredByAdapter)) {
      setModel(preferredByAdapter);
      return;
    }

    const defaultModel = availableModels.find((item) => item.isDefault) ?? availableModels[0];
    setModel(defaultModel?.id ?? AUTO_MODEL_ID);
  }, [adapter, availableModels, model, modelByAdapter]);

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

  useEffect(() => {
    const latestByAdapter = new Map<BridgeChatRequest["adapter"], string>();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (!item?.adapter || !item.model) {
        continue;
      }
      if (latestByAdapter.has(item.adapter)) {
        continue;
      }
      latestByAdapter.set(item.adapter, item.model);
    }

    if (latestByAdapter.size === 0) {
      return;
    }

    setModelByAdapter((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [adapterItem, modelId] of latestByAdapter.entries()) {
        if (next[adapterItem] === modelId) {
          continue;
        }
        next[adapterItem] = modelId;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [messages]);

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

  async function bootstrapModels(connection: BridgeConnection | undefined): Promise<void> {
    if (!connection) {
      setModelsState([]);
      setModel(AUTO_MODEL_ID);
      return;
    }

    try {
      const modelsResponse = await fetchBridgeJson<BridgeModelsResponse>(connection, "/models");
      if (!modelsResponse.ok) {
        if (modelsResponse.status === 401 || modelsResponse.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), modelsResponse.status);
        } else if (modelsResponse.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), modelsResponse.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${modelsResponse.status})`,
            modelsResponse.status
          );
        }
        setModelsState([]);
        return;
      }

      setModelsState(normalizeModelList(modelsResponse.data.models));
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      setModelsState([]);
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
        const created = await createSessionOnBackend(activeConnection, "New chat");
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
      setPageContent(undefined);
      setExtractError(undefined);
      setIncludePageContext(false);
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
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel)] p-3">
      <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{t(locale, "sessions")}</h2>
      <Button type="button" onClick={() => void createSessionFromSidebar()} className="w-full">
        {t(locale, "newSession")}
      </Button>

      <TooltipProvider delayDuration={240}>
        <div
          style={{
            marginTop: 8,
            display: "grid",
            gap: 3,
            overflowY: "auto",
            minHeight: 0,
            flex: 1,
            alignContent: "start"
          }}
        >
          {sessions.map((session) => (
            <Tooltip
              key={session.id}
              open={hoverSessionId === session.id && truncatedTitleSessionId === session.id}
            >
              <TooltipTrigger asChild>
                <div
                  onClick={() => selectSessionFromSidebar(session.id)}
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
                    onClick={() => selectSessionFromSidebar(session.id)}
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
        <Button type="button" variant="outline" size="sm" onClick={() => void openSettingsFromSidebar()}>
          {t(locale, "openSettings")}
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarProvider
      open={!sidebarCollapsed}
      onOpenChange={(open) => {
        void updateSidebarCollapsedValue(!open);
      }}
      className="h-screen w-full"
    >
      <div className="relative flex h-screen w-full overflow-hidden">
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
            style={{ display: "grid", gridTemplateRows: "auto 1fr auto", minHeight: 0, flex: 1, position: "relative" }}
          >
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={`h-8 w-8 rounded-md p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent ${
              isSidebarVisible ? "bg-accent text-accent-foreground" : ""
            }`}
            title={t(locale, "toggleSidebar")}
            aria-label={t(locale, "toggleSidebar")}
            onClick={toggleSidebarPanel}
          >
            <Icon icon={menuIcon} width={18} height={18} />
          </Button>
          <DropdownMenu onOpenChange={setIsAnyDropdownMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md p-0 text-[hsl(var(--muted-foreground))] hover:bg-accent"
                title={t(locale, "sidebarMode")}
                aria-label={t(locale, "sidebarMode")}
              >
                <Icon icon={sidebarModeIcon} width={18} height={18} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[156px]">
              <DropdownMenuItem onSelect={() => void updateSidebarModeValue("docked")}>
                <Icon
                  icon={checkIcon}
                  width={16}
                  height={16}
                  className={sidebarMode === "docked" ? "opacity-100" : "opacity-0"}
                />
                <span>{t(locale, "sidebarModeDocked")}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void updateSidebarModeValue("overlay")}>
                <Icon
                  icon={checkIcon}
                  width={16}
                  height={16}
                  className={sidebarMode === "overlay" ? "opacity-100" : "opacity-0"}
                />
                <span>{t(locale, "sidebarModeOverlay")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          {conversationTimelineItems.length === 0 ? (
            <div style={{ color: "var(--muted-text)", fontSize: 13 }}>{t(locale, "empty")}</div>
          ) : (
            conversationTimelineItems.map((item) => {
              if (item.kind === "message") {
                const msg = item.message;
                const showRaw = msg.role === "assistant" && Boolean(rawViewByMessageId[msg.id]);
                const isHighlighted = isConversationFocused && focusedMessageId === msg.id;
                const imageParts = extractImageParts(msg.parts);
                const userMessageText = resolveUserMessageText(msg);

                return (
                  <article
                    key={item.id}
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
                              className="h-5 rounded-md px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground"
                            >
                              {formatAdapterModel(msg.adapter, msg.model)}
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
                        {imageParts.length > 0 ? (
                          <div style={messageImageGridStyle}>
                            {imageParts.map((part, index) => {
                              const src = resolveMessageImageSrc(activeConnection, part);
                              if (!src) {
                                return null;
                              }
                              const alt =
                                part.attachment.fileName ??
                                `${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`;
                              const imageKey = createSessionGalleryImageKey(
                                msg.id,
                                part.attachment.id,
                                index
                              );
                              return (
                                <button
                                  key={`${msg.id}:image:${part.attachment.id}:${index}`}
                                  type="button"
                                  onClick={() => openImagePreview(imageKey)}
                                  style={messageImageButtonStyle}
                                  title={alt}
                                >
                                  <img
                                    src={src}
                                    alt={alt}
                                    loading="lazy"
                                    style={messageImageStyle}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 8 }}>
                        {userMessageText ? (
                          <span style={{ whiteSpace: "pre-wrap" }}>{userMessageText}</span>
                        ) : null}
                        {imageParts.length > 0 ? (
                          <div style={messageImageGridStyle}>
                            {imageParts.map((part, index) => {
                              const src = resolveMessageImageSrc(activeConnection, part);
                              if (!src) {
                                return null;
                              }
                              const alt =
                                part.attachment.fileName ??
                                `${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`;
                              const imageKey = createSessionGalleryImageKey(
                                msg.id,
                                part.attachment.id,
                                index
                              );
                              return (
                                <button
                                  key={`${msg.id}:image:${part.attachment.id}:${index}`}
                                  type="button"
                                  onClick={() => openImagePreview(imageKey)}
                                  style={messageImageButtonStyle}
                                  title={alt}
                                >
                                  <img
                                    src={src}
                                    alt={alt}
                                    loading="lazy"
                                    style={messageImageStyle}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              }

              const process = item.process;

              if (process.kind === "approval" && process.approval) {
                const approval = process.approval;
                const pendingApproval = approval.status === "PENDING";
                return (
                  <div key={item.id} style={approvalCardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ fontSize: 12 }}>{approval.title ?? approval.kind}</strong>
                      <span style={{ fontSize: 11, opacity: 0.9 }}>
                        {renderApprovalStatus(locale, approval.status, approval.decision)}
                      </span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
                      {approval.kind}
                    </div>
                    {pendingApproval ? (
                      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {approval.availableDecisions.map((decision) => (
                          <Button
                            key={stableDecisionKey(decision)}
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => void submitApprovalDecision(approval, decision)}
                          >
                            {renderDecisionLabel(locale, decision)}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }

              if (process.kind === "commentary" && process.content) {
                const commentarySegments =
                  process.segments && process.segments.length > 0
                    ? process.segments
                    : [process.content];
                return (
                  <details key={item.id} style={collapsibleBlockStyle}>
                    <summary style={collapsibleSummaryStyle}>
                      {t(locale, "assistantCommentaryTitle")}
                    </summary>
                    <div style={collapsibleMarkdownBodyStyle}>
                      {commentarySegments.map((segment, index) => (
                        <p
                          key={`${item.id}:commentary:${index}`}
                          style={{
                            margin: index === 0 ? "0 0 8px" : "8px 0",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: 13,
                            lineHeight: 1.5
                          }}
                        >
                          {segment}
                        </p>
                      ))}
                    </div>
                  </details>
                );
              }

              if (process.kind === "reasoning_summary" && process.content) {
                return (
                  <details key={item.id} style={collapsibleBlockStyle}>
                    <summary style={collapsibleSummaryStyle}>Reasoning Summary</summary>
                    <pre style={collapsibleContentStyle}>{process.content}</pre>
                  </details>
                );
              }

              if (process.kind === "reasoning_text" && process.content) {
                return (
                  <details key={item.id} style={collapsibleBlockStyle}>
                    <summary style={collapsibleSummaryStyle}>Reasoning (Raw)</summary>
                    <pre style={collapsibleContentStyle}>{process.content}</pre>
                  </details>
                );
              }

              if (process.kind === "command_output" && process.content) {
                return (
                  <details key={item.id} style={collapsibleBlockStyle}>
                    <summary style={collapsibleSummaryStyle}>Tool / Command Output</summary>
                    <pre style={collapsibleContentStyle}>{process.content}</pre>
                  </details>
                );
              }

              if (process.kind === "runtime_error" && process.message) {
                return (
                  <div key={item.id} style={hintErrorStyle}>
                    {process.message}
                  </div>
                );
              }

              return null;
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
                  {formatAdapterModel(activeRun.adapter, activeRun.model)}
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
              {runStreamError ? (
                <div style={{ marginTop: 4, fontSize: 11, whiteSpace: "pre-wrap" }}>
                  {runStreamError}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
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

              <span className="text-xs text-muted-foreground">{t(locale, "model")}</span>
              <Select
                value={model}
                onValueChange={(value) => {
                  setModel(value);
                  setModelByAdapter((prev) => ({
                    ...prev,
                    [adapter]: value
                  }));
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
            <div className="flex items-center gap-2">
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
            <div style={composerAttachmentPreviewSectionStyle}>
              <div className="text-xs text-muted-foreground">
                {t(locale, "composerAttachmentsLabel")} ({composerAttachments.length}/{MAX_ATTACHMENTS_PER_MESSAGE})
              </div>
              <div style={composerAttachmentPreviewGridStyle}>
                {composerAttachments.map((attachment, index) => (
                  <div key={attachment.id} style={composerAttachmentPreviewItemStyle}>
                    <img
                      src={attachment.previewUrl}
                      alt={`${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`}
                      style={composerAttachmentPreviewImageStyle}
                    />
                    <button
                      type="button"
                      onClick={() => removeComposerAttachment(attachment.id)}
                      style={composerAttachmentRemoveButtonStyle}
                      aria-label={t(locale, "composerRemoveImage")}
                    >
                      <Icon icon={deleteOutline} width={14} height={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
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
            className="min-h-[76px] resize-y"
          />
          <Button
            type="button"
            disabled={pending || isActiveRunBusy || !canSend}
            onClick={() => void send()}
            style={{ opacity: pending || isActiveRunBusy || !canSend ? 0.6 : 1 }}
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
                  {(() => {
                    const imageParts = extractImageParts(previewMessage.parts);
                    const userMessageText = resolveUserMessageText(previewMessage);
                    return previewMessage.role === "assistant" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        {rawViewByMessageId[previewMessage.id] ? (
                          <pre style={{ ...rawMessageContentStyle, margin: 0 }}>
                            <code>{previewMessage.content}</code>
                          </pre>
                        ) : (
                          <MarkdownMessage content={previewMessage.content} />
                        )}
                        {imageParts.length > 0 ? (
                          <div style={previewImageGridStyle}>
                            {imageParts.map((part, index) => {
                              const src = resolveMessageImageSrc(activeConnection, part);
                              if (!src) {
                                return null;
                              }
                              const alt =
                                part.attachment.fileName ??
                                `${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`;
                              const imageKey = createSessionGalleryImageKey(
                                previewMessage.id,
                                part.attachment.id,
                                index
                              );
                              return (
                                <button
                                  key={`${previewMessage.id}:preview-image:${part.attachment.id}:${index}`}
                                  type="button"
                                  onClick={() => openImagePreview(imageKey)}
                                  style={previewImageButtonStyle}
                                  title={alt}
                                >
                                  <img
                                    src={src}
                                    alt={alt}
                                    loading="lazy"
                                    style={previewImageStyle}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 12 }}>
                        {userMessageText ? (
                          <span style={{ whiteSpace: "pre-wrap" }}>{userMessageText}</span>
                        ) : null}
                        {imageParts.length > 0 ? (
                          <div style={previewImageGridStyle}>
                            {imageParts.map((part, index) => {
                              const src = resolveMessageImageSrc(activeConnection, part);
                              if (!src) {
                                return null;
                              }
                              const alt =
                                part.attachment.fileName ??
                                `${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`;
                              const imageKey = createSessionGalleryImageKey(
                                previewMessage.id,
                                part.attachment.id,
                                index
                              );
                              return (
                                <button
                                  key={`${previewMessage.id}:preview-image:${part.attachment.id}:${index}`}
                                  type="button"
                                  onClick={() => openImagePreview(imageKey)}
                                  style={previewImageButtonStyle}
                                  title={alt}
                                >
                                  <img
                                    src={src}
                                    alt={alt}
                                    loading="lazy"
                                    style={previewImageStyle}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}
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
      <PhotoSlider
        images={photoSliderImages}
        visible={imagePreviewVisible}
        index={imagePreviewIndex}
        bannerVisible={false}
        onClose={() => {
          setImagePreviewVisible(false);
        }}
        onIndexChange={(index) => {
          setImagePreviewIndex(index);
        }}
        overlayRender={() => (
          <div style={photoSliderOverlayStyle}>
            <span style={photoSliderCounterStyle}>
              {sessionGalleryImages.length === 0
                ? "0 / 0"
                : `${Math.min(imagePreviewIndex + 1, sessionGalleryImages.length)} / ${sessionGalleryImages.length}`}
            </span>
            <span style={photoSliderNameStyle}>
              {activeGalleryImage?.fileName?.trim() ||
                activeGalleryImage?.alt ||
                t(locale, "composerImagePreviewAltPrefix")}
            </span>
          </div>
        )}
      />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

function revokeComposerAttachmentPreviews(attachments: ComposerAttachment[]): void {
  for (const attachment of attachments) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function createSessionGalleryImageKey(
  messageId: string,
  attachmentId: string,
  imageIndexInMessage: number
): string {
  return `${messageId}:${attachmentId}:${imageIndexInMessage}`;
}

function buildSessionGalleryImages(
  messages: ChatMessage[],
  activeConnection: BridgeConnection | undefined,
  locale: Locale
): SessionGalleryImage[] {
  const images: SessionGalleryImage[] = [];
  for (const message of messages) {
    const imageParts = extractImageParts(message.parts);
    if (imageParts.length === 0) {
      continue;
    }
    imageParts.forEach((part, index) => {
      const src = resolveMessageImageSrc(activeConnection, part);
      if (!src) {
        return;
      }
      images.push({
        key: createSessionGalleryImageKey(message.id, part.attachment.id, index),
        src,
        alt:
          part.attachment.fileName ??
          `${t(locale, "composerImagePreviewAltPrefix")} ${images.length + 1}`,
        ...(part.attachment.fileName ? { fileName: part.attachment.fileName } : {})
      });
    });
  }
  return images;
}

function extractImageParts(
  parts: ChatMessagePart[] | undefined
): Array<Extract<ChatMessagePart, { type: "image" }>> {
  if (!parts || parts.length === 0) {
    return [];
  }
  return parts.filter(
    (part): part is Extract<ChatMessagePart, { type: "image" }> => part.type === "image"
  );
}

function resolveUserMessageText(message: ChatMessage): string | undefined {
  if (message.parts && message.parts.length > 0) {
    const text = message.parts
      .filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text.length > 0) {
      return text;
    }

    if (
      extractImageParts(message.parts).length > 0 &&
      /^\[\d+\simage(?:s)?\]$/iu.test(message.content.trim())
    ) {
      return undefined;
    }
  }

  return message.content;
}

function resolveMessageImageSrc(
  activeConnection: BridgeConnection | undefined,
  part: Extract<ChatMessagePart, { type: "image" }>
): string | undefined {
  const { attachment } = part;
  if (attachment.url) {
    if (
      attachment.url.startsWith("http://") ||
      attachment.url.startsWith("https://") ||
      attachment.url.startsWith("data:") ||
      attachment.url.startsWith("blob:")
    ) {
      return attachment.url;
    }

    if (activeConnection) {
      return joinBridgeUrl(activeConnection.baseUrl, attachment.url);
    }
    return attachment.url;
  }

  if (!activeConnection) {
    return undefined;
  }
  return joinBridgeUrl(activeConnection.baseUrl, `/uploads/${attachment.id}`);
}

function joinBridgeUrl(baseUrl: string, path: string): string {
  try {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(path, normalizedBase).toString();
  } catch {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}

function normalizeSidebarMode(value: unknown): UiSidebarMode {
  return value === "overlay" ? "overlay" : "docked";
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

function normalizeModelList(models: BridgeModel[]): BridgeModel[] {
  const dedup = new Map<string, BridgeModel>();
  for (const item of models) {
    if (!item.id.trim()) {
      continue;
    }
    const key = `${item.adapter}::${item.id}`;
    dedup.set(key, {
      ...item,
      id: item.id.trim(),
      label: item.label.trim() || item.id.trim()
    });
  }
  return [...dedup.values()];
}

function normalizeAssistantStreamPhase(phase: string | undefined): BridgeAssistantMessagePhase {
  if (phase === "commentary" || phase === "final_answer") {
    return phase;
  }
  return "unknown";
}

function mergeAssistantCompletedContent(
  phase: BridgeAssistantMessagePhase,
  existing: string,
  completed: string
): string {
  if (phase !== "commentary") {
    return completed;
  }

  const nextText = completed.trim();
  if (!nextText) {
    return existing;
  }

  const currentText = existing.trim();
  if (!currentText) {
    return completed;
  }

  if (currentText === nextText || currentText.endsWith(nextText)) {
    return existing;
  }

  return `${existing.replace(/\s+$/u, "")}\n\n${completed}`;
}

function buildRunArtifacts(events: BridgeRunStreamEvent[]): RunArtifacts {
  const assistantByPhase = createEmptyStreamAssistantByPhase();
  let reasoningSummary = "";
  let reasoningText = "";
  let commandOutput = "";
  let errorMessage: string | undefined;

  for (const event of events) {
    if (event.type === "assistant.delta") {
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      assistantByPhase[phase] += event.data.delta;
      continue;
    }

    if (event.type === "assistant.completed") {
      if (typeof event.data.content !== "string") {
        continue;
      }
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      assistantByPhase[phase] = mergeAssistantCompletedContent(
        phase,
        assistantByPhase[phase] ?? "",
        event.data.content
      );
      continue;
    }

    if (event.type === "reasoning.summary.delta") {
      reasoningSummary += event.data.delta;
      continue;
    }

    if (event.type === "reasoning.text.delta") {
      reasoningText += event.data.delta;
      continue;
    }

    if (event.type === "command.output.delta") {
      commandOutput += event.data.delta;
      continue;
    }

    if (event.type === "error") {
      errorMessage = event.data.message;
    }
  }

  return {
    assistantByPhase,
    reasoningSummary,
    reasoningText,
    commandOutput,
    ...(errorMessage ? { errorMessage } : {})
  };
}

function buildSessionProcessTimelineItems(
  sessionRunProcesses: Record<string, SessionRunProcessState>
): ProcessTimelineItem[] {
  const items: ProcessTimelineItem[] = [];
  for (const [runId, process] of Object.entries(sessionRunProcesses)) {
    items.push(...buildProcessTimelineItems(runId, process.events, process.approvals));
  }
  items.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    return left.id.localeCompare(right.id);
  });
  return items;
}

function buildProcessTimelineItems(
  runId: string,
  events: BridgeRunStreamEvent[],
  approvals: BridgeRunApproval[]
): ProcessTimelineItem[] {
  const artifacts = buildRunArtifacts(events);
  const firstSeen = extractProcessFirstSeenTs(events);
  const items: ProcessTimelineItem[] = [];
  const mergedApprovals = mergeApprovalsFromEvents(events, approvals);
  const commentarySegments = extractCommentarySegments(events);

  for (const approval of mergedApprovals) {
    items.push({
      id: `approval-${runId}-${approval.id}`,
      ts: approval.requestedAt,
      kind: "approval",
      approval
    });
  }

  if (commentarySegments.length > 0 && typeof firstSeen.commentary === "number") {
    items.push({
      id: `${runId}:commentary`,
      ts: firstSeen.commentary,
      kind: "commentary",
      content: commentarySegments.join("\n\n"),
      segments: commentarySegments
    });
  } else if (artifacts.assistantByPhase.commentary && typeof firstSeen.commentary === "number") {
    items.push({
      id: `${runId}:commentary`,
      ts: firstSeen.commentary,
      kind: "commentary",
      content: artifacts.assistantByPhase.commentary,
      segments: [artifacts.assistantByPhase.commentary]
    });
  }

  if (artifacts.reasoningSummary && typeof firstSeen.reasoningSummary === "number") {
    items.push({
      id: `${runId}:reasoning-summary`,
      ts: firstSeen.reasoningSummary,
      kind: "reasoning_summary",
      content: artifacts.reasoningSummary
    });
  }

  if (artifacts.reasoningText && typeof firstSeen.reasoningText === "number") {
    items.push({
      id: `${runId}:reasoning-text`,
      ts: firstSeen.reasoningText,
      kind: "reasoning_text",
      content: artifacts.reasoningText
    });
  }

  if (artifacts.commandOutput && typeof firstSeen.commandOutput === "number") {
    items.push({
      id: `${runId}:command-output`,
      ts: firstSeen.commandOutput,
      kind: "command_output",
      content: artifacts.commandOutput
    });
  }

  if (artifacts.errorMessage && typeof firstSeen.runtimeError === "number") {
    items.push({
      id: `${runId}:runtime-error`,
      ts: firstSeen.runtimeError,
      kind: "runtime_error",
      message: artifacts.errorMessage
    });
  }

  items.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    return left.id.localeCompare(right.id);
  });
  return items;
}

function extractCommentarySegments(events: BridgeRunStreamEvent[]): string[] {
  const segments: string[] = [];
  for (const event of events) {
    if (event.type !== "assistant.completed") {
      continue;
    }
    const phase = normalizeAssistantStreamPhase(event.data.phase);
    if (phase !== "commentary") {
      continue;
    }
    if (typeof event.data.content !== "string") {
      continue;
    }
    const text = event.data.content.trim();
    if (!text) {
      continue;
    }
    const prev = segments[segments.length - 1];
    if (prev === text) {
      continue;
    }
    segments.push(text);
  }
  return segments;
}

function mergeApprovalsFromEvents(
  events: BridgeRunStreamEvent[],
  approvals: BridgeRunApproval[]
): BridgeRunApproval[] {
  const merged = new Map<string, BridgeRunApproval>();

  for (const approval of approvals) {
    merged.set(approval.id, approval);
  }

  for (const event of events) {
    if (event.type !== "approval.requested" && event.type !== "approval.updated") {
      continue;
    }
    const approval = event.data.approval;
    if (!approval?.id) {
      continue;
    }
    merged.set(approval.id, approval);
  }

  return [...merged.values()].sort((left, right) => {
    if (left.requestedAt !== right.requestedAt) {
      return left.requestedAt - right.requestedAt;
    }
    return left.id.localeCompare(right.id);
  });
}

function buildConversationTimelineItems(
  messages: ChatMessage[],
  processItems: ProcessTimelineItem[]
): ConversationTimelineItem[] {
  const timeline: ConversationTimelineItem[] = [
    ...messages.map((message) => ({
      id: `message-${message.id}`,
      ts: message.createdAt,
      kind: "message" as const,
      message
    })),
    ...processItems.map((process) => ({
      id: `process-${process.id}`,
      ts: process.ts,
      kind: "process" as const,
      process
    }))
  ];

  timeline.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    if (left.kind !== right.kind) {
      return left.kind === "process" ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });

  return timeline;
}

function extractProcessFirstSeenTs(events: BridgeRunStreamEvent[]): {
  commentary?: number;
  reasoningSummary?: number;
  reasoningText?: number;
  commandOutput?: number;
  runtimeError?: number;
} {
  let commentary: number | undefined;
  let reasoningSummary: number | undefined;
  let reasoningText: number | undefined;
  let commandOutput: number | undefined;
  let runtimeError: number | undefined;

  for (const event of events) {
    if (event.type === "assistant.delta") {
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      if (phase === "commentary" && commentary === undefined) {
        commentary = event.ts;
      }
      continue;
    }

    if (event.type === "assistant.completed") {
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      if (phase === "commentary" && commentary === undefined) {
        commentary = event.ts;
      }
      continue;
    }

    if (event.type === "reasoning.summary.delta" && reasoningSummary === undefined) {
      reasoningSummary = event.ts;
      continue;
    }

    if (event.type === "reasoning.text.delta" && reasoningText === undefined) {
      reasoningText = event.ts;
      continue;
    }

    if (event.type === "command.output.delta" && commandOutput === undefined) {
      commandOutput = event.ts;
      continue;
    }

    if (event.type === "error" && runtimeError === undefined) {
      runtimeError = event.ts;
    }
  }

  return {
    ...(typeof commentary === "number" ? { commentary } : {}),
    ...(typeof reasoningSummary === "number" ? { reasoningSummary } : {}),
    ...(typeof reasoningText === "number" ? { reasoningText } : {}),
    ...(typeof commandOutput === "number" ? { commandOutput } : {}),
    ...(typeof runtimeError === "number" ? { runtimeError } : {})
  };
}

function pickDisplayAssistantText(streamByPhase: StreamAssistantByPhase): string {
  if (streamByPhase.final_answer.length > 0) {
    return streamByPhase.final_answer;
  }
  if (streamByPhase.unknown.length > 0) {
    return streamByPhase.unknown;
  }
  return "";
}

function formatAdapterModel(adapter: string, model: string | undefined): string {
  return `${adapter} / ${model?.trim() || AUTO_MODEL_ID}`;
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

async function fetchSessionRunsFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  limit = 50
): Promise<BridgeSessionRun[] | null> {
  const response = await fetchBridgeJson<BridgeSessionRunsResponse>(
    connection,
    `/sessions/${sessionId}/runs?limit=${limit}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.runs;
}

async function fetchRunApprovalsFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  runId: string,
  status: "pending" | "all" = "all"
): Promise<BridgeRunApproval[] | null> {
  const response = await fetchBridgeJson<BridgeSessionRunApprovalsResponse>(
    connection,
    `/sessions/${sessionId}/runs/${runId}/approvals?status=${status}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.approvals;
}

async function fetchRunEventsFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  runId: string,
  limit = 2000
): Promise<BridgeRunStreamEvent[] | null> {
  const response = await fetchBridgeJson<BridgeSessionRunEventsResponse>(
    connection,
    `/sessions/${sessionId}/runs/${runId}/events?limit=${limit}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.events;
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
      a.model !== b.model ||
      a.content !== b.content ||
      !areMessagePartsEqual(a.parts, b.parts) ||
      a.createdAt !== b.createdAt
    ) {
      return false;
    }
  }

  return true;
}

function areMessagePartsEqual(
  left: ChatMessagePart[] | undefined,
  right: ChatMessagePart[] | undefined
): boolean {
  if (!left || left.length === 0) {
    return !right || right.length === 0;
  }
  if (!right || right.length === 0 || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || a.type !== b.type) {
      return false;
    }
    if (a.type === "text" && b.type === "text") {
      if (a.text !== b.text) {
        return false;
      }
      continue;
    }
    if (a.type === "image" && b.type === "image") {
      if (
        a.attachment.id !== b.attachment.id ||
        a.attachment.mimeType !== b.attachment.mimeType ||
        a.attachment.sizeBytes !== b.attachment.sizeBytes ||
        a.attachment.fileName !== b.attachment.fileName ||
        a.attachment.url !== b.attachment.url ||
        a.attachment.createdAt !== b.attachment.createdAt
      ) {
        return false;
      }
      continue;
    }
    return false;
  }

  return true;
}

function upsertApproval(list: BridgeRunApproval[], approval: BridgeRunApproval): BridgeRunApproval[] {
  const index = list.findIndex((item) => item.id === approval.id);
  if (index < 0) {
    return [...list, approval];
  }
  const next = [...list];
  next[index] = approval;
  return next;
}

function renderDecisionLabel(locale: Locale, decision: unknown): string {
  if (decision === "accept") {
    return locale === "zh-CN" ? "允许本次" : "Allow once";
  }
  if (decision === "acceptForSession") {
    return locale === "zh-CN" ? "允许会话内" : "Allow for session";
  }
  if (decision === "decline") {
    return locale === "zh-CN" ? "拒绝" : "Decline";
  }
  if (decision === "cancel") {
    return locale === "zh-CN" ? "取消" : "Cancel";
  }

  if (decision && typeof decision === "object" && !Array.isArray(decision)) {
    const key = Object.keys(decision)[0];
    if (key === "acceptWithExecpolicyAmendment") {
      return locale === "zh-CN" ? "允许并记住规则" : "Allow + remember rule";
    }
    if (key === "applyNetworkPolicyAmendment") {
      return locale === "zh-CN" ? "允许并更新网络规则" : "Allow + network rule";
    }
    return key ?? String(decision);
  }

  return String(decision);
}

function renderApprovalStatus(
  locale: Locale,
  status: BridgeRunApproval["status"],
  decision: unknown
): JSX.Element {
  if (status === "PENDING") {
    return <span>{locale === "zh-CN" ? "待处理" : "Pending"}</span>;
  }

  const isSessionAllow = decision === "acceptForSession";
  const isAccepted = status === "APPROVED";
  const isDeclined = status === "DENIED" || status === "CANCELLED" || status === "TIMEOUT" || status === "FAILED";

  if (isAccepted) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--hint-info-text)" }}>
        <Icon icon={isSessionAllow ? checkAllIcon : checkIcon} width={14} height={14} />
        <span>{locale === "zh-CN" ? "已允许" : "Approved"}</span>
      </span>
    );
  }

  if (isDeclined) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--hint-error-text)" }}>
        <Icon icon={alertCircleOutline} width={14} height={14} />
        <span>{locale === "zh-CN" ? "已拒绝" : "Denied"}</span>
      </span>
    );
  }

  return <span>{status}</span>;
}

function stableDecisionKey(decision: unknown): string {
  try {
    return JSON.stringify(decision, (_key, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort((a, b) => a.localeCompare(b))
          .map((key) => [key, (value as Record<string, unknown>)[key]])
      );
    });
  } catch {
    return String(decision);
  }
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

const approvalCardStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--panel)"
};

const collapsibleBlockStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  background: "var(--panel)"
};

const collapsibleSummaryStyle: CSSProperties = {
  padding: "8px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600
};

const collapsibleContentStyle: CSSProperties = {
  margin: 0,
  padding: "0 10px 10px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace"
};

const collapsibleMarkdownBodyStyle: CSSProperties = {
  padding: "0 10px 10px"
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

const dragOverlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  display: "grid",
  placeItems: "center",
  padding: 24,
  pointerEvents: "none",
  background: "hsl(var(--background) / 0.74)",
  backdropFilter: "blur(2px)"
};

const dragOverlayCardStyle: CSSProperties = {
  width: "min(420px, 100%)",
  border: "2px dashed hsl(var(--ring) / 0.7)",
  borderRadius: 14,
  padding: "18px 20px",
  background: "hsl(var(--card) / 0.95)",
  color: "hsl(var(--foreground))",
  textAlign: "center",
  display: "grid",
  gap: 6
};

const composerAttachmentPreviewSectionStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--panel)",
  display: "grid",
  gap: 8
};

const composerAttachmentPreviewGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
};

const composerAttachmentPreviewItemStyle: CSSProperties = {
  position: "relative",
  width: 76,
  height: 76,
  borderRadius: 8,
  overflow: "hidden",
  border: "1px solid var(--line)",
  background: "var(--code-block-bg)"
};

const composerAttachmentPreviewImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block"
};

const composerAttachmentRemoveButtonStyle: CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  width: 22,
  height: 22,
  borderRadius: 999,
  border: "1px solid hsl(var(--border) / 0.9)",
  background: "hsl(var(--background) / 0.9)",
  color: "hsl(var(--foreground))",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer"
};

const messageImageGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
};

const messageImageButtonStyle: CSSProperties = {
  border: "none",
  padding: 0,
  margin: 0,
  background: "transparent",
  cursor: "zoom-in",
  lineHeight: 0
};

const messageImageStyle: CSSProperties = {
  width: 168,
  maxWidth: "100%",
  maxHeight: 220,
  borderRadius: 8,
  border: "1px solid var(--line)",
  objectFit: "cover",
  display: "block"
};

const previewImageGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: 10
};

const previewImageButtonStyle: CSSProperties = {
  border: "none",
  padding: 0,
  margin: 0,
  background: "transparent",
  cursor: "zoom-in",
  lineHeight: 0,
  textAlign: "left"
};

const previewImageStyle: CSSProperties = {
  width: "100%",
  maxHeight: 420,
  borderRadius: 10,
  border: "1px solid var(--line)",
  objectFit: "contain",
  background: "hsl(var(--muted) / 0.28)"
};

const photoSliderOverlayStyle: CSSProperties = {
  position: "fixed",
  top: 12,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 40,
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 12px",
  borderRadius: 999,
  background: "hsl(var(--background) / 0.76)",
  color: "hsl(var(--foreground))",
  border: "1px solid hsl(var(--border) / 0.65)",
  boxShadow: "0 10px 30px hsl(var(--background) / 0.35)",
  backdropFilter: "blur(8px)",
  maxWidth: "min(calc(100vw - 20px), 760px)",
  pointerEvents: "none"
};

const photoSliderCounterStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  opacity: 0.92
};

const photoSliderNameStyle: CSSProperties = {
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};
