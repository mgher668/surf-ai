import type { BridgeAdapter, UiSidebarMode, UiThemeMode } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../components/ui/select";

interface GeneralSectionProps {
  locale: Locale;
  adapterOptions: BridgeAdapter[];
  defaultAdapter: BridgeAdapter;
  sidebarMode: UiSidebarMode;
  themeMode: UiThemeMode;
  onDefaultAdapterChange: (adapter: BridgeAdapter) => void;
  onLocaleChange: (locale: Locale) => void;
  onSidebarModeChange: (mode: UiSidebarMode) => void;
  onThemeModeChange: (mode: UiThemeMode) => void;
}

export function GeneralSection({
  locale,
  adapterOptions,
  defaultAdapter,
  sidebarMode,
  themeMode,
  onDefaultAdapterChange,
  onLocaleChange,
  onSidebarModeChange,
  onThemeModeChange
}: GeneralSectionProps): JSX.Element {
  return (
    <section className="surf-settings-card">
      <div className="grid gap-1">
        <h2 className="surf-settings-section-title">{t(locale, "settingsSectionGeneral")}</h2>
        <p className="text-xs text-muted-foreground">
          {t(locale, "settingsSectionGeneralDescription")}
        </p>
      </div>

      <div className="grid gap-2">
        <span className="surf-field-label">{t(locale, "defaultAdapter")}</span>
        <Select
          value={defaultAdapter}
          onValueChange={(value) => onDefaultAdapterChange(value as BridgeAdapter)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t(locale, "defaultAdapter")} />
          </SelectTrigger>
          <SelectContent>
            {adapterOptions.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <span className="surf-field-label">{t(locale, "language")}</span>
        <Select value={locale} onValueChange={(value) => onLocaleChange(value as Locale)}>
          <SelectTrigger>
            <SelectValue placeholder={t(locale, "language")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="zh-CN">{t(locale, "languageZhCn")}</SelectItem>
            <SelectItem value="en-US">{t(locale, "languageEnUs")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <span className="surf-field-label">{t(locale, "sidebarMode")}</span>
        <Select
          value={sidebarMode}
          onValueChange={(value) => onSidebarModeChange(value as UiSidebarMode)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t(locale, "sidebarMode")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="docked">{t(locale, "sidebarModeDocked")}</SelectItem>
            <SelectItem value="overlay">{t(locale, "sidebarModeOverlay")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <span className="surf-field-label">{t(locale, "theme")}</span>
        <Select value={themeMode} onValueChange={(value) => onThemeModeChange(value as UiThemeMode)}>
          <SelectTrigger>
            <SelectValue placeholder={t(locale, "theme")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">{t(locale, "themeSystem")}</SelectItem>
            <SelectItem value="light">{t(locale, "themeLight")}</SelectItem>
            <SelectItem value="dark">{t(locale, "themeDark")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
