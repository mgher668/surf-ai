import { resolveLocale, t } from "../common/i18n";

export function App(): JSX.Element {
  const locale = resolveLocale(navigator.language);

  return (
    <main style={{ width: 320, padding: 14 }}>
      <h1 style={{ margin: "0 0 12px", fontSize: 18 }}>{t(locale, "appTitle")}</h1>
      <button
        type="button"
        style={{
          width: "100%",
          border: "1px solid #0f7a8a",
          borderRadius: 10,
          padding: "10px 12px",
          background: "linear-gradient(180deg, #15a0a5 0%, #0f7a8a 100%)",
          color: "#fff",
          cursor: "pointer"
        }}
        onClick={async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.windowId) {
            await chrome.sidePanel.open({ windowId: tab.windowId });
          }
        }}
      >
        {t(locale, "openSidePanel")}
      </button>
      <p style={{ margin: "10px 0 0", color: "#4c6979", fontSize: 12 }}>
        Tip: select text on page to trigger quick actions.
      </p>
    </main>
  );
}
