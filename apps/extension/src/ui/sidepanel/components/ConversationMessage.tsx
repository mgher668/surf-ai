import type { BridgeConnection, ChatMessage } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Badge } from "../../components/ui/badge";
import { LazyMarkdownMessage } from "./LazyMarkdownMessage";
import {
  createSessionGalleryImageKey,
  extractImageParts,
  resolveMessageImageSrc,
  resolveUserMessageText
} from "../utils/sidepanel-helpers";
import {
  messageImageButtonStyle,
  messageImageGridStyle,
  messageImageStyle,
  messageRenderToggleStyle,
  rawMessageContentStyle
} from "../styles";

interface ConversationMessageProps {
  itemId: string;
  message: ChatMessage;
  locale: Locale;
  activeConnection: BridgeConnection | undefined;
  showRaw: boolean;
  isHighlighted: boolean;
  registerMessageItemRef: (messageId: string, element: HTMLElement | null) => void;
  toggleRawView: (messageId: string) => void;
  openImagePreview: (imageKey: string) => void;
  onFocusMessage: (messageId: string) => void;
  formatAdapterModel: (adapter: string, model: string | undefined) => string;
}

export function ConversationMessage({
  itemId,
  message: msg,
  locale,
  activeConnection,
  showRaw,
  isHighlighted,
  registerMessageItemRef,
  toggleRawView,
  openImagePreview,
  onFocusMessage,
  formatAdapterModel
}: ConversationMessageProps): JSX.Element {
  const imageParts = extractImageParts(msg.parts);
  const userMessageText = resolveUserMessageText(msg);

  return (
    <article
      key={itemId}
      ref={(element) => {
        registerMessageItemRef(msg.id, element);
      }}
      tabIndex={0}
      data-message-id={msg.id}
      data-highlighted={isHighlighted ? "true" : "false"}
      onFocus={() => {
        onFocusMessage(msg.id);
      }}
      className={`surf-message ${
        msg.role === "user" ? "surf-message-user" : "surf-message-assistant"
      }`}
    >
      {msg.role === "assistant" ? (
        <div className="surf-assistant-message-frame">
          <div className="surf-message-toolbar">
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
            <LazyMarkdownMessage content={msg.content} />
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
