import { PhotoSlider } from "react-photo-view";
import { type Locale, t } from "../../common/i18n";
import type { SessionGalleryImage } from "../utils/sidepanel-helpers";
import {
  photoSliderCounterStyle,
  photoSliderNameStyle,
  photoSliderOverlayStyle
} from "../styles";

interface PhotoSliderImage {
  key: string;
  src: string;
}

interface ImagePreviewSlidersProps {
  locale: Locale;
  sessionGalleryImages: SessionGalleryImage[];
  sessionPhotoSliderImages: PhotoSliderImage[];
  sessionImagePreviewVisible: boolean;
  sessionImagePreviewIndex: number;
  onCloseSessionImagePreview: () => void;
  onSessionImagePreviewIndexChange: (index: number) => void;
  composerGalleryImages: SessionGalleryImage[];
  composerPhotoSliderImages: PhotoSliderImage[];
  composerImagePreviewVisible: boolean;
  composerImagePreviewIndex: number;
  onCloseComposerImagePreview: () => void;
  onComposerImagePreviewIndexChange: (index: number) => void;
}

export function ImagePreviewSliders({
  locale,
  sessionGalleryImages,
  sessionPhotoSliderImages,
  sessionImagePreviewVisible,
  sessionImagePreviewIndex,
  onCloseSessionImagePreview,
  onSessionImagePreviewIndexChange,
  composerGalleryImages,
  composerPhotoSliderImages,
  composerImagePreviewVisible,
  composerImagePreviewIndex,
  onCloseComposerImagePreview,
  onComposerImagePreviewIndexChange
}: ImagePreviewSlidersProps): JSX.Element {
  const activeGalleryImage =
    sessionGalleryImages.length > 0
      ? sessionGalleryImages[Math.min(sessionImagePreviewIndex, sessionGalleryImages.length - 1)]
      : undefined;
  const activeComposerGalleryImage =
    composerGalleryImages.length > 0
      ? composerGalleryImages[Math.min(composerImagePreviewIndex, composerGalleryImages.length - 1)]
      : undefined;

  return (
    <>
      <PhotoSlider
        images={sessionPhotoSliderImages}
        visible={sessionImagePreviewVisible}
        index={sessionImagePreviewIndex}
        bannerVisible={false}
        onClose={() => {
          onCloseSessionImagePreview();
        }}
        onIndexChange={(index) => {
          onSessionImagePreviewIndexChange(index);
        }}
        overlayRender={() => (
          <div style={photoSliderOverlayStyle}>
            <span style={photoSliderCounterStyle}>
              {sessionGalleryImages.length === 0
                ? "0 / 0"
                : `${Math.min(sessionImagePreviewIndex + 1, sessionGalleryImages.length)} / ${sessionGalleryImages.length}`}
            </span>
            <span style={photoSliderNameStyle}>
              {activeGalleryImage?.fileName?.trim() ||
                activeGalleryImage?.alt ||
                t(locale, "composerImagePreviewAltPrefix")}
            </span>
          </div>
        )}
      />
      <PhotoSlider
        images={composerPhotoSliderImages}
        visible={composerImagePreviewVisible}
        index={composerImagePreviewIndex}
        bannerVisible={false}
        onClose={() => {
          onCloseComposerImagePreview();
        }}
        onIndexChange={(index) => {
          onComposerImagePreviewIndexChange(index);
        }}
        overlayRender={() => (
          <div style={photoSliderOverlayStyle}>
            <span style={photoSliderCounterStyle}>
              {composerGalleryImages.length === 0
                ? "0 / 0"
                : `${Math.min(composerImagePreviewIndex + 1, composerGalleryImages.length)} / ${composerGalleryImages.length}`}
            </span>
            <span style={photoSliderNameStyle}>
              {activeComposerGalleryImage?.fileName?.trim() ||
                activeComposerGalleryImage?.alt ||
                t(locale, "composerImagePreviewAltPrefix")}
            </span>
          </div>
        )}
      />
    </>
  );
}
