import { useLocaleThemePreferences } from "../common/hooks/useLocaleThemePreferences";
import { t } from "../common/i18n";
import { Button } from "../components/ui/button";

export function App(): JSX.Element {
  const { locale } = useLocaleThemePreferences();
  const logoUrl = chrome.runtime.getURL("logo-surf-ai-image2.png");

  async function openStandalone(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/sidepanel/index.html") });
  }

  async function openSettings(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/settings/index.html") });
  }

  return (
    <main className="surf-popup-shell">
      <section className="surf-popup-card">
        <div className="surf-popup-brand">
          <img className="surf-brand-mark surf-brand-mark-lg" src={logoUrl} alt="" aria-hidden="true" />
          <div className="grid min-w-0 gap-1">
            <span className="surf-field-label">
              {locale === "zh-CN" ? "本地运行入口" : "Local runtime launcher"}
            </span>
            <h1 className="truncate text-base font-semibold tracking-[-0.01em]">{t(locale, "appTitle")}</h1>
          </div>
        </div>
        <div className="surf-popup-status-grid">
          <div className="surf-popup-status-cell">
            <span className="surf-field-label">mode</span>
            <div className="mt-1 truncate text-sm font-semibold">extension</div>
          </div>
          <div className="surf-popup-status-cell">
            <span className="surf-field-label">surface</span>
            <div className="mt-1 truncate text-sm font-semibold">sidepanel</div>
          </div>
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
        <div className="surf-popup-command">
          <span className="font-mono text-[11px] text-muted-foreground">selection</span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            {t(locale, "popupTipSelection")}
          </span>
        </div>
      </section>
    </main>
  );
}
