import { useLocaleThemePreferences } from "../common/hooks/useLocaleThemePreferences";
import { t } from "../common/i18n";
import { Button } from "../components/ui/button";

export function App(): JSX.Element {
  const { locale } = useLocaleThemePreferences();

  async function openStandalone(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/sidepanel/index.html") });
  }

  async function openSettings(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/settings/index.html") });
  }

  return (
    <main className="surf-popup-shell">
      <section className="surf-popup-card">
        <div className="grid gap-1">
          <span className="surf-field-label">Surf AI</span>
          <h1 className="text-base font-semibold tracking-[-0.02em]">{t(locale, "appTitle")}</h1>
        </div>
        <Button
          type="button"
          className="w-full justify-between"
          onClick={async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.windowId) {
              await chrome.sidePanel.open({ windowId: tab.windowId });
            }
          }}
        >
          {t(locale, "openSidePanel")}
        </Button>
        <Button type="button" variant="outline" className="w-full justify-between" onClick={() => void openStandalone()}>
          {t(locale, "openStandalone")}
        </Button>
        <Button type="button" variant="outline" className="w-full justify-between" onClick={() => void openSettings()}>
          {t(locale, "openSettings")}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">{t(locale, "popupTipSelection")}</p>
      </section>
    </main>
  );
}
