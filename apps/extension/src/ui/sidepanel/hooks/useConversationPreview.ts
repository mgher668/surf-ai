import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";
import type { ChatMessage } from "@surf-ai/shared";
import type { SessionGalleryImage } from "../utils/sidepanel-helpers";

type KeyboardScrollController = {
  clearKeyboardScrollKeys: () => void;
  handleScrollKeyDown: (key: "j" | "k") => void;
  handleScrollKeyUp: (key: "j" | "k") => void;
};

interface UseConversationPreviewOptions {
  messages: ChatMessage[];
  sessionGalleryImages: SessionGalleryImage[];
  composerGalleryImages: SessionGalleryImage[];
  conversationViewportRef: RefObject<HTMLElement | null>;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  previewViewportRef: RefObject<HTMLDivElement | null>;
  conversationKeyboardScroll: KeyboardScrollController;
  previewKeyboardScroll: KeyboardScrollController;
  isKeyboardShortcutBlocked: boolean;
}

interface UseConversationPreviewResult {
  rawViewByMessageId: Record<string, boolean>;
  isConversationFocused: boolean;
  setIsConversationFocused: (focused: boolean) => void;
  focusedMessageId: string | undefined;
  setFocusedMessageId: (messageId: string | undefined) => void;
  previewDialogOpen: boolean;
  setPreviewDialogOpen: (open: boolean) => void;
  previewMessage: ChatMessage | undefined;
  previewMessageId: string | undefined;
  setPreviewMessageId: (messageId: string | undefined) => void;
  imagePreviewVisible: boolean;
  setImagePreviewVisible: (visible: boolean) => void;
  imagePreviewIndex: number;
  setImagePreviewIndex: (index: number) => void;
  composerImagePreviewVisible: boolean;
  setComposerImagePreviewVisible: (visible: boolean) => void;
  composerImagePreviewIndex: number;
  setComposerImagePreviewIndex: (index: number) => void;
  toggleRawView: (messageId: string) => void;
  focusConversationViewport: () => void;
  registerMessageItemRef: (messageId: string, element: HTMLElement | null) => void;
  openImagePreview: (imageKey: string) => void;
  openComposerImagePreview: (imageKey: string) => void;
  clearConversationKeyboardScrollKeys: () => void;
  clearPreviewKeyboardScrollKeys: () => void;
  handleConversationShortcut: (event: ReactKeyboardEvent<HTMLElement>) => void;
  handleConversationShortcutKeyUp: (event: ReactKeyboardEvent<HTMLElement>) => void;
  handlePreviewShortcut: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handlePreviewShortcutKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  resetEmptyConversationUiState: () => void;
  resetSessionConversationUiState: () => void;
}

export function useConversationPreview({
  messages,
  sessionGalleryImages,
  composerGalleryImages,
  conversationViewportRef,
  composerTextareaRef,
  previewViewportRef,
  conversationKeyboardScroll,
  previewKeyboardScroll,
  isKeyboardShortcutBlocked
}: UseConversationPreviewOptions): UseConversationPreviewResult {
  const [rawViewByMessageId, setRawViewByMessageId] = useState<Record<string, boolean>>({});
  const [isConversationFocused, setIsConversationFocused] = useState(false);
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>();
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewMessageId, setPreviewMessageId] = useState<string | undefined>();
  const [imagePreviewVisible, setImagePreviewVisible] = useState(false);
  const [imagePreviewIndex, setImagePreviewIndex] = useState(0);
  const [composerImagePreviewVisible, setComposerImagePreviewVisible] = useState(false);
  const [composerImagePreviewIndex, setComposerImagePreviewIndex] = useState(0);
  const messageItemRefs = useRef(new Map<string, HTMLElement>());

  const previewMessage = useMemo(
    () => messages.find((item) => item.id === previewMessageId),
    [messages, previewMessageId]
  );
  const sessionGalleryIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>();
    sessionGalleryImages.forEach((image, index) => {
      indexByKey.set(image.key, index);
    });
    return indexByKey;
  }, [sessionGalleryImages]);
  const composerGalleryIndexByKey = useMemo(() => {
    const indexByKey = new Map<string, number>();
    composerGalleryImages.forEach((image, index) => {
      indexByKey.set(image.key, index);
    });
    return indexByKey;
  }, [composerGalleryImages]);

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
  }, [previewDialogOpen, previewMessageId, previewViewportRef]);

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

  function resetEmptyConversationUiState(): void {
    setFocusedMessageId(undefined);
    setPreviewDialogOpen(false);
    setPreviewMessageId(undefined);
    resetSessionConversationUiState();
  }

  function resetSessionConversationUiState(): void {
    setRawViewByMessageId({});
    setImagePreviewVisible(false);
    setImagePreviewIndex(0);
  }

  return {
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
  };
}
