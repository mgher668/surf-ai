import { Icon } from "@iconify/react/dist/offline";
import deleteOutline from "@iconify-icons/mdi/delete-outline";
import { type Locale, t } from "../../common/i18n";
import {
  createComposerGalleryImageKey,
  type ComposerAttachment
} from "../utils/sidepanel-helpers";
import {
  composerAttachmentOpenButtonStyle,
  composerAttachmentPreviewGridStyle,
  composerAttachmentPreviewImageStyle,
  composerAttachmentPreviewItemStyle,
  composerAttachmentPreviewSectionStyle,
  composerAttachmentRemoveButtonStyle
} from "../styles";

interface ComposerAttachmentPreviewProps {
  locale: Locale;
  attachments: ComposerAttachment[];
  maxAttachmentsPerMessage: number;
  onOpenImagePreview: (imageKey: string) => void;
  onRemoveAttachment: (attachmentId: string) => void;
}

export function ComposerAttachmentPreview({
  locale,
  attachments,
  maxAttachmentsPerMessage,
  onOpenImagePreview,
  onRemoveAttachment
}: ComposerAttachmentPreviewProps): JSX.Element {
  return (
    <div style={composerAttachmentPreviewSectionStyle}>
      <div className="text-xs text-muted-foreground">
        {t(locale, "composerAttachmentsLabel")} ({attachments.length}/{maxAttachmentsPerMessage})
      </div>
      <div style={composerAttachmentPreviewGridStyle}>
        {attachments.map((attachment, index) => (
          <div key={attachment.id} style={composerAttachmentPreviewItemStyle}>
            <button
              type="button"
              onClick={() =>
                onOpenImagePreview(createComposerGalleryImageKey(attachment.id, index))
              }
              style={composerAttachmentOpenButtonStyle}
              title={attachment.file.name || `${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`}
            >
              <img
                src={attachment.previewUrl}
                alt={`${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`}
                style={composerAttachmentPreviewImageStyle}
              />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveAttachment(attachment.id);
              }}
              style={composerAttachmentRemoveButtonStyle}
              aria-label={t(locale, "composerRemoveImage")}
            >
              <Icon icon={deleteOutline} width={14} height={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
