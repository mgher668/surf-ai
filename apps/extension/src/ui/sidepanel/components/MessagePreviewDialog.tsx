import { type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import type { BridgeConnection, ChatMessage } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import {
  Dialog,
  DialogContent,
  DialogTitle
} from "../../components/ui/dialog";
import { MarkdownMessage } from "../MarkdownMessage";
import {
  createSessionGalleryImageKey,
  extractImageParts,
  resolveMessageImageSrc,
  resolveUserMessageText
} from "../utils/sidepanel-helpers";
import {
  messageRenderToggleStyle,
  previewImageButtonStyle,
  previewImageGridStyle,
  previewImageStyle,
  rawMessageContentStyle
} from "../styles";

interface MessagePreviewDialogProps {
  locale: Locale;
  previewDialogOpen: boolean;
  previewMessage: ChatMessage | undefined;
  previewViewportRef: RefObject<HTMLDivElement>;
  rawViewByMessageId: Record<string, boolean>;
  activeConnection: BridgeConnection | undefined;
  onOpenChange: (open: boolean) => void;
  toggleRawView: (messageId: string) => void;
  openImagePreview: (imageKey: string) => void;
  handlePreviewShortcut: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  handlePreviewShortcutKeyUp: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  clearPreviewKeyboardScrollKeys: () => void;
}

export function MessagePreviewDialog({
  locale,
  previewDialogOpen,
  previewMessage,
  previewViewportRef,
  rawViewByMessageId,
  activeConnection,
  onOpenChange,
  toggleRawView,
  openImagePreview,
  handlePreviewShortcut,
  handlePreviewShortcutKeyUp,
  clearPreviewKeyboardScrollKeys
}: MessagePreviewDialogProps): JSX.Element {
  return (
    <Dialog
      open={previewDialogOpen}
      onOpenChange={onOpenChange}
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
  );
}
