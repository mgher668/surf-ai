import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";

interface SettingsHeaderProps {
  locale: Locale;
  onBackToChat: () => void;
}

export function SettingsHeader({ locale, onBackToChat }: SettingsHeaderProps): JSX.Element {
  return (
    <header className="surf-settings-header">
      <div className="grid gap-0.5">
        <h1 className="surf-settings-title">{t(locale, "settingsTitle")}</h1>
        <p className="text-xs text-muted-foreground">{t(locale, "settingsDescription")}</p>
      </div>
      <Button type="button" variant="outline" onClick={onBackToChat}>
        {t(locale, "backToChat")}
      </Button>
    </header>
  );
}
