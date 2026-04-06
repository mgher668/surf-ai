import { resolveLocale, t } from "../common/i18n";
import { Button } from "../components/ui/button";

export function App(): JSX.Element {
  const locale = resolveLocale(navigator.language);

  return (
    <main style={{ width: 320, padding: 14 }}>
      <h1 style={{ margin: "0 0 12px", fontSize: 18 }}>{t(locale, "appTitle")}</h1>
      <Button
        type="button"
        className="w-full"
        onClick={async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.windowId) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
          }
        }}
      >
        {t(locale, "openSidePanel")}
      </Button>
      <p style={{ margin: "10px 0 0", color: "var(--muted-text)", fontSize: 12 }}>
        Tip: select text on page to trigger quick actions.
      </p>
    </main>
  );
}
