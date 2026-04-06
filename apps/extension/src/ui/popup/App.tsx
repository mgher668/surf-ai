import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "@surf-ai/shared";
import { getLocale, onStorageChanged } from "../../lib/storage";
import { type Locale, resolveLocale, t } from "../common/i18n";
import { Button } from "../components/ui/button";

export function App(): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(navigator.language));

  useEffect(() => {
    void getLocale().then((stored) => {
      if (stored) {
        setLocaleState(resolveLocale(stored));
      }
    });

    const removeStorageListener = onStorageChanged((changes) => {
      const localeChange = changes[STORAGE_KEYS.locale];
      if (localeChange) {
        const nextLocale = localeChange.newValue as string | undefined;
        setLocaleState(resolveLocale(nextLocale || navigator.language));
      }
    });

    return () => {
      removeStorageListener();
    };
  }, []);

  async function openStandalone(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/sidepanel/index.html") });
  }

  async function openSettings(): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/settings/index.html") });
  }

  return (
    <main className="grid w-[320px] gap-2 p-3">
      <h1 className="text-base font-semibold">{t(locale, "appTitle")}</h1>
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
      <Button type="button" variant="outline" className="w-full" onClick={() => void openStandalone()}>
        {t(locale, "openStandalone")}
      </Button>
      <Button type="button" variant="outline" className="w-full" onClick={() => void openSettings()}>
        {t(locale, "openSettings")}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">{t(locale, "popupTipSelection")}</p>
    </main>
  );
}
