import { type CSSProperties } from "react";

export const hintInfoStyle: CSSProperties = {
  border: "1px solid var(--hint-info-border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--hint-info-bg)",
  color: "var(--hint-info-text)",
  fontSize: 12
};

export const hintErrorStyle: CSSProperties = {
  border: "1px solid var(--hint-error-border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--hint-error-bg)",
  color: "var(--hint-error-text)",
  fontSize: 12
};

export const hintWarnStyle: CSSProperties = {
  border: "1px solid var(--hint-warn-border)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--hint-warn-bg)",
  color: "var(--hint-warn-text)",
  fontSize: 12
};

export const inlineCheckboxLabelStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  marginLeft: 10,
  fontSize: 12
};

export const messageRenderToggleStyle: CSSProperties = {
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

export const rawMessageContentStyle: CSSProperties = {
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

export const dragOverlayStyle: CSSProperties = {
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

export const dragOverlayCardStyle: CSSProperties = {
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

export const composerAttachmentPreviewSectionStyle: CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "8px 10px",
  background: "var(--panel)",
  display: "grid",
  gap: 8
};

export const composerAttachmentPreviewGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
};

export const composerAttachmentPreviewItemStyle: CSSProperties = {
  position: "relative",
  width: 76,
  height: 76,
  borderRadius: 8,
  overflow: "hidden",
  border: "1px solid var(--line)",
  background: "var(--code-block-bg)"
};

export const composerAttachmentOpenButtonStyle: CSSProperties = {
  border: "none",
  padding: 0,
  margin: 0,
  width: "100%",
  height: "100%",
  background: "transparent",
  cursor: "zoom-in"
};

export const composerAttachmentPreviewImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block"
};

export const composerAttachmentRemoveButtonStyle: CSSProperties = {
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

export const messageImageGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8
};

export const messageImageButtonStyle: CSSProperties = {
  border: "none",
  padding: 0,
  margin: 0,
  background: "transparent",
  cursor: "zoom-in",
  lineHeight: 0
};

export const messageImageStyle: CSSProperties = {
  width: 168,
  maxWidth: "100%",
  maxHeight: 220,
  borderRadius: 8,
  border: "1px solid var(--line)",
  objectFit: "cover",
  display: "block"
};

export const previewImageGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: 10
};

export const previewImageButtonStyle: CSSProperties = {
  border: "none",
  padding: 0,
  margin: 0,
  background: "transparent",
  cursor: "zoom-in",
  lineHeight: 0,
  textAlign: "left"
};

export const previewImageStyle: CSSProperties = {
  width: "100%",
  maxHeight: 420,
  borderRadius: 10,
  border: "1px solid var(--line)",
  objectFit: "contain",
  background: "hsl(var(--muted) / 0.28)"
};

export const photoSliderOverlayStyle: CSSProperties = {
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

export const photoSliderCounterStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: "nowrap",
  opacity: 0.92
};

export const photoSliderNameStyle: CSSProperties = {
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};
