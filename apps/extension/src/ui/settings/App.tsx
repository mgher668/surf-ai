import { useEffect, useMemo, useState } from "react";
import type { BridgeAdapter, BridgeConnection, UiThemeMode } from "@surf-ai/shared";
import { STORAGE_KEYS } from "@surf-ai/shared";
import {
  getActiveConnectionId,
  getConnections,
  getDefaultAdapter,
  getLocale,
  getTheme,
  onStorageChanged,
  setActiveConnectionId,
  setConnections,
  setDefaultAdapter,
  setLocale,
  setTheme
} from "../../lib/storage";
import { type Locale, resolveLocale, t } from "../common/i18n";
import { applyTheme, listenSystemThemeChange, normalizeThemeMode } from "../common/theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";

const DEFAULT_CONNECTION_URL = "http://127.0.0.1:43127";
const DEFAULT_CONNECTION_USER_ID = "local";
const ADAPTER_OPTIONS: BridgeAdapter[] = [
  "codex",
  "claude",
  "mock",
  "openai-compatible",
  "anthropic",
  "gemini"
];

export function App(): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(navigator.language));
  const [connections, setConnectionsState] = useState<BridgeConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | undefined>();
  const [defaultAdapter, setDefaultAdapterState] = useState<BridgeAdapter>("codex");
  const [themeMode, setThemeModeState] = useState<UiThemeMode>("system");

  const [newConnName, setNewConnName] = useState("");
  const [newConnUrl, setNewConnUrl] = useState(DEFAULT_CONNECTION_URL);
  const [newConnUserId, setNewConnUserId] = useState(DEFAULT_CONNECTION_USER_ID);
  const [newConnToken, setNewConnToken] = useState("");

  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId),
    [connections, activeConnectionId]
  );

  useEffect(() => {
    void bootstrap();
    const removeStorageListener = onStorageChanged((changes) => {
      const connectionChange = changes[STORAGE_KEYS.connections];
      if (connectionChange) {
        const nextConnections = connectionChange.newValue as
          | BridgeConnection[]
          | undefined;
        if (nextConnections) {
          setConnectionsState(nextConnections);
        }
      }
      const activeConnectionChange = changes[STORAGE_KEYS.activeConnectionId];
      if (activeConnectionChange) {
        setActiveConnectionIdState(
          activeConnectionChange.newValue as string | undefined
        );
      }
      const localeChange = changes[STORAGE_KEYS.locale];
      if (localeChange) {
        const rawLocale = localeChange.newValue as string | undefined;
        setLocaleState(resolveLocale(rawLocale || navigator.language));
      }
      const defaultAdapterChange = changes[STORAGE_KEYS.defaultAdapter];
      if (defaultAdapterChange) {
        const nextAdapter = defaultAdapterChange.newValue as
          | BridgeAdapter
          | undefined;
        if (nextAdapter) {
          setDefaultAdapterState(nextAdapter);
        }
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

  async function bootstrap(): Promise<void> {
    const [storedConnections, storedActiveConnectionId, storedLocale, storedDefaultAdapter, storedTheme] =
      await Promise.all([
        getConnections(),
        getActiveConnectionId(),
        getLocale(),
        getDefaultAdapter(),
        getTheme()
      ]);

    setConnectionsState(storedConnections);
    setActiveConnectionIdState(storedActiveConnectionId ?? storedConnections[0]?.id);
    if (storedLocale) {
      setLocaleState(resolveLocale(storedLocale));
    }
    if (storedDefaultAdapter) {
      setDefaultAdapterState(storedDefaultAdapter);
    }
    setThemeModeState(normalizeThemeMode(storedTheme));
  }

  async function addConnection(): Promise<void> {
    if (!newConnName.trim() || !newConnUrl.trim()) {
      return;
    }

    const now = Date.now();
    const nextConnection: BridgeConnection = {
      id: crypto.randomUUID(),
      name: newConnName.trim(),
      baseUrl: newConnUrl.trim().replace(/\/$/, ""),
      ...(newConnUserId.trim() ? { userId: newConnUserId.trim() } : {}),
      enabled: true,
      createdAt: now,
      updatedAt: now,
      ...(newConnToken.trim() ? { token: newConnToken.trim() } : {})
    };

    const nextConnections = [nextConnection, ...connections];
    await setConnections(nextConnections);
    await setActiveConnectionId(nextConnection.id);
    setConnectionsState(nextConnections);
    setActiveConnectionIdState(nextConnection.id);

    setNewConnName("");
    setNewConnUrl(DEFAULT_CONNECTION_URL);
    setNewConnUserId(DEFAULT_CONNECTION_USER_ID);
    setNewConnToken("");
  }

  async function updateActiveConnection(id: string): Promise<void> {
    setActiveConnectionIdState(id);
    await setActiveConnectionId(id);
  }

  async function updateDefaultAdapter(nextAdapter: BridgeAdapter): Promise<void> {
    setDefaultAdapterState(nextAdapter);
    await setDefaultAdapter(nextAdapter);
  }

  async function updateLocale(nextLocale: Locale): Promise<void> {
    setLocaleState(nextLocale);
    await setLocale(nextLocale);
  }

  async function updateThemeMode(nextTheme: UiThemeMode): Promise<void> {
    setThemeModeState(nextTheme);
    await setTheme(nextTheme);
  }

  async function openChatPage(): Promise<void> {
    const chatUrl = chrome.runtime.getURL("src/ui/sidepanel/index.html");
    window.location.href = chatUrl;
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-4xl gap-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="grid gap-0.5">
          <h1 className="text-base font-semibold">{t(locale, "settingsTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t(locale, "settingsDescription")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void openChatPage()}>
          {t(locale, "backToChat")}
        </Button>
      </header>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">{t(locale, "connection")}</h2>
        <div className="grid gap-1">
          <span className="text-xs text-muted-foreground">{t(locale, "currentConnection")}</span>
          <Select
            {...(activeConnectionId ? { value: activeConnectionId } : {})}
            onValueChange={(value) => void updateActiveConnection(value)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t(locale, "noConnection")} />
            </SelectTrigger>
            <SelectContent>
              {connections.map((conn) => (
                <SelectItem key={conn.id} value={conn.id}>
                  {conn.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {activeConnection
              ? `${activeConnection.baseUrl} · ${activeConnection.userId ?? "-"}`
              : t(locale, "noConnection")}
          </p>
        </div>

        <Separator />

        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(locale, "connectionName")}</span>
          <Input value={newConnName} onChange={(event) => setNewConnName(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(locale, "baseUrl")}</span>
          <Input value={newConnUrl} onChange={(event) => setNewConnUrl(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(locale, "connectionUserId")}</span>
          <Input value={newConnUserId} onChange={(event) => setNewConnUserId(event.target.value)} />
        </div>
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(locale, "token")}</span>
          <Input value={newConnToken} onChange={(event) => setNewConnToken(event.target.value)} />
        </div>
        <Button type="button" onClick={() => void addConnection()}>
          {t(locale, "addConnection")}
        </Button>
      </section>

      <section className="grid gap-3 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">{t(locale, "appTitle")}</h2>
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(locale, "defaultAdapter")}</span>
          <Select
            value={defaultAdapter}
            onValueChange={(value) => void updateDefaultAdapter(value as BridgeAdapter)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t(locale, "defaultAdapter")} />
            </SelectTrigger>
            <SelectContent>
              {ADAPTER_OPTIONS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <span className="text-xs text-muted-foreground">{t(locale, "language")}</span>
          <Select
            value={locale}
            onValueChange={(value) => void updateLocale(value as Locale)}
          >
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
          <span className="text-xs text-muted-foreground">{t(locale, "theme")}</span>
          <Select
            value={themeMode}
            onValueChange={(value) => void updateThemeMode(value as UiThemeMode)}
          >
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
    </main>
  );
}
