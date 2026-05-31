import type { PageContentPayload } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { hintInfoStyle, inlineCheckboxLabelStyle } from "../styles";

interface PageContextBannerProps {
  locale: Locale;
  pageContent: PageContentPayload;
  includePageContext: boolean;
  onIncludePageContextChange: (includePageContext: boolean) => void;
}

export function PageContextBanner({
  locale,
  pageContent,
  includePageContext,
  onIncludePageContextChange
}: PageContextBannerProps): JSX.Element {
  return (
    <div style={hintInfoStyle}>
      {t(locale, "pageContextReady")} · {pageContent.source} · {pageContent.charCount} chars
      <label style={inlineCheckboxLabelStyle}>
        <input
          type="checkbox"
          checked={includePageContext}
          onChange={(event) => onIncludePageContextChange(event.target.checked)}
        />
        {t(locale, "includePageContext")}
      </label>
    </div>
  );
}
