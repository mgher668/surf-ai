import type { UiThemeMode } from "@surf-ai/shared";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

type EffectiveTheme = "light" | "dark";

export function normalizeThemeMode(raw: string | undefined): UiThemeMode {
  if (raw === "light" || raw === "dark" || raw === "system") {
    return raw;
  }
  return "system";
}

export function resolveEffectiveTheme(themeMode: UiThemeMode): EffectiveTheme {
  if (themeMode === "system") {
    return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
  }
  return themeMode;
}

export function applyTheme(themeMode: UiThemeMode): void {
  const root = document.documentElement;
  const effectiveTheme = resolveEffectiveTheme(themeMode);
  root.classList.toggle("dark", effectiveTheme === "dark");
  root.dataset.themeMode = themeMode;
  root.dataset.effectiveTheme = effectiveTheme;
  root.style.colorScheme = effectiveTheme;
}

export function listenSystemThemeChange(callback: () => void): () => void {
  const mediaQuery = window.matchMedia(SYSTEM_DARK_QUERY);
  const listener = () => callback();

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }

  mediaQuery.addListener(listener);
  return () => mediaQuery.removeListener(listener);
}
