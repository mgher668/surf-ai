import { useEffect, useState } from "react";
import { STORAGE_KEYS, type UiThemeMode } from "@surf-ai/shared";
import { getLocale, getTheme, onStorageChanged } from "../../../lib/storage";
import { type Locale, resolveLocale } from "../i18n";
import { applyTheme, listenSystemThemeChange, normalizeThemeMode } from "../theme";

interface LocaleThemePreferences {
  locale: Locale;
  themeMode: UiThemeMode;
}

export function useLocaleThemePreferences(): LocaleThemePreferences {
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(navigator.language));
  const [themeMode, setThemeModeState] = useState<UiThemeMode>("system");

  useEffect(() => {
    void Promise.all([getLocale(), getTheme()]).then(([storedLocale, storedTheme]) => {
      if (storedLocale) {
        setLocaleState(resolveLocale(storedLocale));
      }
      setThemeModeState(normalizeThemeMode(storedTheme));
    });

    const removeStorageListener = onStorageChanged((changes) => {
      const localeChange = changes[STORAGE_KEYS.locale];
      if (localeChange) {
        const nextLocale = localeChange.newValue as string | undefined;
        setLocaleState(resolveLocale(nextLocale || navigator.language));
      }

      const themeChange = changes[STORAGE_KEYS.theme];
      if (themeChange) {
        const nextTheme = normalizeThemeMode(themeChange.newValue as string | undefined);
        setThemeModeState(nextTheme);
      }
    });

    return () => {
      removeStorageListener();
    };
  }, []);

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") {
      return;
    }
    return listenSystemThemeChange(() => {
      applyTheme("system");
    });
  }, [themeMode]);

  return { locale, themeMode };
}
