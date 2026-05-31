import { type Locale, t } from "../../common/i18n";
import { SETTINGS_SECTION_ITEMS, type SettingsSection } from "../utils/settingsSections";

interface SettingsNavProps {
  locale: Locale;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}

export function SettingsNav({
  locale,
  activeSection,
  onSectionChange
}: SettingsNavProps): JSX.Element {
  return (
    <aside className="surf-settings-nav">
      <nav className="flex gap-1 overflow-x-auto lg:flex-col">
        {SETTINGS_SECTION_ITEMS.map((item) => {
          const active = activeSection === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSectionChange(item.key)}
              className="surf-settings-nav-item"
              data-active={active ? "true" : "false"}
            >
              <div className="text-sm font-medium">{t(locale, item.labelKey)}</div>
              <div className="text-[11px] text-muted-foreground">
                {t(locale, item.descriptionKey)}
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
