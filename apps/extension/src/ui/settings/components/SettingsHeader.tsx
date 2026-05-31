import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";

interface SettingsHeaderProps {
  locale: Locale;
  onBackToChat: () => void;
}

export function SettingsHeader({ locale, onBackToChat }: SettingsHeaderProps): JSX.Element {
  const logoUrl = chrome.runtime.getURL("logo-surf-ai-image2.png");

  return (
    <header className="surf-settings-header">
      <div className="surf-settings-brand">
        <img className="surf-brand-mark surf-brand-mark-lg" src={logoUrl} alt="" aria-hidden="true" />
        <div className="grid min-w-0 gap-0.5">
          <h1 className="surf-settings-title">{t(locale, "settingsTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t(locale, "settingsDescription")}</p>
        </div>
      </div>
      <Button type="button" variant="outline" onClick={onBackToChat}>
        {t(locale, "backToChat")}
      </Button>
    </header>
  );
}
