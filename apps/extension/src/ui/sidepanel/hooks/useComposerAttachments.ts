import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent
} from "react";
import { type Locale, t } from "../../common/i18n";
import { type ComposerAttachment } from "../utils/sidepanel-helpers";

interface UseComposerAttachmentsOptions {
  locale: Locale;
  maxAttachmentsPerMessage: number;
  maxAttachmentBytes: number;
}

interface UseComposerAttachmentsResult {
  composerAttachments: ComposerAttachment[];
  composerAttachmentError: string | undefined;
  isDragOverlayVisible: boolean;
  setComposerAttachmentError: (error: string | undefined) => void;
  clearComposerAttachments: () => void;
  removeComposerAttachment: (attachmentId: string) => void;
  handleComposerFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleComposerPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  resetDragOverlay: () => void;
  handleConversationDragEnter: (event: ReactDragEvent<HTMLElement>) => void;
  handleConversationDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  handleConversationDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  handleConversationDrop: (event: ReactDragEvent<HTMLElement>) => void;
}

export function useComposerAttachments({
  locale,
  maxAttachmentsPerMessage,
  maxAttachmentBytes
}: UseComposerAttachmentsOptions): UseComposerAttachmentsResult {
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [composerAttachmentError, setComposerAttachmentError] = useState<string | undefined>();
  const [isDragOverlayVisible, setIsDragOverlayVisible] = useState(false);
  const composerAttachmentsRef = useRef<ComposerAttachment[]>([]);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => {
    return () => {
      revokeComposerAttachmentPreviews(composerAttachmentsRef.current);
    };
  }, []);

  const appendComposerFiles = useCallback(
    (rawFiles: File[]): void => {
      if (rawFiles.length === 0) {
        return;
      }

      const nextAttachments = [...composerAttachments];
      let nextError: string | undefined;

      for (const file of rawFiles) {
        if (nextAttachments.length >= maxAttachmentsPerMessage) {
          nextError ??= t(locale, "composerAttachmentLimitExceeded");
          break;
        }

        if (!file.type.startsWith("image/")) {
          nextError ??= t(locale, "composerAttachmentTypeNotAllowed");
          continue;
        }

        if (file.size > maxAttachmentBytes) {
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
    },
    [composerAttachments, locale, maxAttachmentBytes, maxAttachmentsPerMessage]
  );

  const clearComposerAttachments = useCallback((): void => {
    setComposerAttachments((prev) => {
      revokeComposerAttachmentPreviews(prev);
      return [];
    });
  }, []);

  const updateComposerAttachmentError = useCallback((error: string | undefined): void => {
    setComposerAttachmentError(error);
  }, []);

  const removeComposerAttachment = useCallback((attachmentId: string): void => {
    setComposerAttachments((prev) => {
      const target = prev.find((item) => item.id === attachmentId);
      if (!target) {
        return prev;
      }

      URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== attachmentId);
    });
  }, []);

  const handleComposerFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const files = event.target.files ? Array.from(event.target.files) : [];
      if (files.length > 0) {
        appendComposerFiles(files);
      }
      event.target.value = "";
    },
    [appendComposerFiles]
  );

  const handleComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) {
        return;
      }

      event.preventDefault();
      appendComposerFiles(files);
    },
    [appendComposerFiles]
  );

  const resetDragOverlay = useCallback((): void => {
    dragDepthRef.current = 0;
    setIsDragOverlayVisible(false);
  }, []);

  const handleConversationDragEnter = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    if (!isFileDropEvent(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOverlayVisible(true);
  }, []);

  const handleConversationDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>): void => {
      if (!isFileDropEvent(event)) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!isDragOverlayVisible) {
        setIsDragOverlayVisible(true);
      }
    },
    [isDragOverlayVisible]
  );

  const handleConversationDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>): void => {
      if (!isDragOverlayVisible) {
        return;
      }

      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDragOverlayVisible(false);
      }
    },
    [isDragOverlayVisible]
  );

  const handleConversationDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>): void => {
      event.preventDefault();
      resetDragOverlay();
      const droppedFiles = Array.from(event.dataTransfer.files ?? []);
      if (droppedFiles.length > 0) {
        appendComposerFiles(droppedFiles);
      }
    },
    [appendComposerFiles, resetDragOverlay]
  );

  return {
    composerAttachments,
    composerAttachmentError,
    isDragOverlayVisible,
    setComposerAttachmentError: updateComposerAttachmentError,
    clearComposerAttachments,
    removeComposerAttachment,
    handleComposerFileInputChange,
    handleComposerPaste,
    resetDragOverlay,
    handleConversationDragEnter,
    handleConversationDragOver,
    handleConversationDragLeave,
    handleConversationDrop
  };
}

function isFileDropEvent(event: ReactDragEvent<HTMLElement>): boolean {
  const dataTransferTypes = event.dataTransfer?.types;
  return Array.from(dataTransferTypes ?? []).includes("Files");
}

function revokeComposerAttachmentPreviews(attachments: ComposerAttachment[]): void {
  for (const attachment of attachments) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}
