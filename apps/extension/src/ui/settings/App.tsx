import { useEffect, useMemo, useState } from "react";
import type {
  BridgeAdapter,
  BridgeConnection,
  BridgeModel,
  BridgeModelsResponse,
  BridgeModelsUpdateRequest,
  CodexReasoningEffort,
  UiSidebarMode,
  UiThemeMode
} from "@surf-ai/shared";
import { STORAGE_KEYS } from "@surf-ai/shared";
import {
  getActiveConnectionId,
  getConnections,
  getDefaultAdapter,
  getLocale,
  getSidebarMode,
  getTheme,
  onStorageChanged,
  setActiveConnectionId,
  setConnections,
  setDefaultAdapter,
  setLocale,
  setSidebarMode,
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
import { ModelsEditableTable } from "./components/ModelsEditableTable";

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
const MODEL_ADAPTER_OPTIONS: BridgeAdapter[] = ["codex", "claude", "mock"];
const AUTO_MODEL_ID = "auto";
const SETTINGS_SECTIONS = ["general", "connections", "models"] as const;
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function App(): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(resolveLocale(navigator.language));
  const [connections, setConnectionsState] = useState<BridgeConnection[]>([]);
  const [activeConnectionId, setActiveConnectionIdState] = useState<string | undefined>();
  const [defaultAdapter, setDefaultAdapterState] = useState<BridgeAdapter>("codex");
  const [sidebarMode, setSidebarModeState] = useState<UiSidebarMode>("docked");
  const [themeMode, setThemeModeState] = useState<UiThemeMode>("system");
  const [activeSection, setActiveSection] = useState<SettingsSection>(() =>
    resolveSettingsSection(window.location.hash.replace("#", "")) ?? "general"
  );

  const [newConnName, setNewConnName] = useState("");
  const [newConnUrl, setNewConnUrl] = useState(DEFAULT_CONNECTION_URL);
  const [newConnUserId, setNewConnUserId] = useState(DEFAULT_CONNECTION_USER_ID);
  const [newConnToken, setNewConnToken] = useState("");
  const [models, setModelsState] = useState<BridgeModel[]>([]);
  const [modelsDirty, setModelsDirty] = useState(false);
  const [modelsFeedback, setModelsFeedback] = useState<string | undefined>();
  const [draftModelIdByAdapter, setDraftModelIdByAdapter] = useState<
    Partial<Record<BridgeAdapter, string>>
  >({});
  const [draftModelLabelByAdapter, setDraftModelLabelByAdapter] = useState<
    Partial<Record<BridgeAdapter, string>>
  >({});

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
      const sidebarModeChange = changes[STORAGE_KEYS.sidebarMode];
      if (sidebarModeChange) {
        setSidebarModeState(normalizeSidebarMode(sidebarModeChange.newValue));
      }
    });

    return () => {
      removeStorageListener();
    };
  }, []);

  useEffect(() => {
    const handleHashChange = (): void => {
      const nextSection = resolveSettingsSection(window.location.hash.replace("#", ""));
      if (!nextSection) {
        return;
      }
      setActiveSection(nextSection);
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    const expectedHash = `#${activeSection}`;
    if (window.location.hash === expectedHash) {
      return;
    }
    window.history.replaceState(null, "", expectedHash);
  }, [activeSection]);

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

  useEffect(() => {
    void loadModels(activeConnection);
  }, [activeConnection?.id, activeConnection?.baseUrl, activeConnection?.userId, activeConnection?.token]);

  async function bootstrap(): Promise<void> {
    const [
      storedConnections,
      storedActiveConnectionId,
      storedLocale,
      storedDefaultAdapter,
      storedSidebarMode,
      storedTheme
    ] =
      await Promise.all([
        getConnections(),
        getActiveConnectionId(),
        getLocale(),
        getDefaultAdapter(),
        getSidebarMode(),
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
    setSidebarModeState(normalizeSidebarMode(storedSidebarMode));
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

  async function updateSidebarMode(nextMode: UiSidebarMode): Promise<void> {
    setSidebarModeState(nextMode);
    await setSidebarMode(nextMode);
  }

  async function loadModels(connection: BridgeConnection | undefined): Promise<void> {
    if (!connection) {
      setModelsState([]);
      setModelsDirty(false);
      setModelsFeedback(undefined);
      return;
    }

    try {
      const response = await fetch(`${connection.baseUrl}/models`, {
        method: "GET",
        headers: buildBridgeHeaders(connection)
      });
      if (!response.ok) {
        setModelsFeedback(`${t(locale, "modelsLoadFailed")} (${response.status})`);
        return;
      }
      const payload = (await response.json()) as BridgeModelsResponse;
      setModelsState(normalizeModelList(payload.models));
      setModelsDirty(false);
      setModelsFeedback(undefined);
    } catch {
      setModelsFeedback(t(locale, "modelsLoadFailed"));
    }
  }

  function updateModels(mutator: (previous: BridgeModel[]) => BridgeModel[]): void {
    setModelsState((previous) => {
      const next = normalizeModelList(mutator(previous));
      setModelsDirty(true);
      setModelsFeedback(undefined);
      return next;
    });
  }

  function setDefaultModel(adapter: BridgeAdapter, modelId: string): void {
    updateModels((previous) =>
      previous.map((item) => {
        if (item.adapter !== adapter) {
          return item;
        }
        return {
          ...item,
          isDefault: item.id === modelId,
          enabled: item.id === modelId ? true : item.enabled
        };
      })
    );
  }

  function updateModelReasoningEffort(
    adapter: BridgeAdapter,
    modelId: string,
    effort: CodexReasoningEffort | undefined
  ): void {
    if (adapter !== "codex") {
      return;
    }

    updateModels((previous) =>
      previous.map((item) => {
        if (item.adapter !== adapter || item.id !== modelId) {
          return item;
        }
        if (!effort) {
          const { modelReasoningEffort: _unused, ...rest } = item;
          return rest;
        }
        return {
          ...item,
          modelReasoningEffort: effort
        };
      })
    );
  }

  function toggleModelEnabled(adapter: BridgeAdapter, modelId: string): void {
    updateModels((previous) => {
      const target = previous.find((item) => item.adapter === adapter && item.id === modelId);
      if (!target) {
        return previous;
      }
      const nextEnabled = !target.enabled;
      const next = previous.map((item) => {
        if (item.adapter !== adapter || item.id !== modelId) {
          return item;
        }
        return {
          ...item,
          enabled: nextEnabled,
          isDefault: nextEnabled ? item.isDefault : false
        };
      });

      const enabledModels = next.filter((item) => item.adapter === adapter && item.enabled);
      if (enabledModels.length === 0) {
        return next.map((item) => {
          if (item.adapter !== adapter || item.id !== modelId) {
            return item;
          }
          return {
            ...item,
            enabled: true,
            isDefault: true
          };
        });
      }

      const hasDefault = enabledModels.some((item) => item.isDefault);
      if (hasDefault) {
        return next;
      }

      const fallbackDefaultId = enabledModels[0]?.id;
      if (!fallbackDefaultId) {
        return next;
      }
      return next.map((item) => {
        if (item.adapter !== adapter) {
          return item;
        }
        return {
          ...item,
          isDefault: item.id === fallbackDefaultId
        };
      });
    });
  }

  function removeModel(adapter: BridgeAdapter, modelId: string): void {
    updateModels((previous) => {
      const next = previous.filter((item) => !(item.adapter === adapter && item.id === modelId));
      const adapterModels = next.filter((item) => item.adapter === adapter);
      if (adapterModels.length === 0) {
        next.push({
          id: AUTO_MODEL_ID,
          label: "Auto (CLI default)",
          adapter,
          enabled: true,
          isDefault: true
        });
        return next;
      }
      if (adapterModels.some((item) => item.isDefault && item.enabled)) {
        return next;
      }
      const fallbackDefaultId = adapterModels.find((item) => item.enabled)?.id ?? adapterModels[0]?.id;
      if (!fallbackDefaultId) {
        return next;
      }
      return next.map((item) => {
        if (item.adapter !== adapter) {
          return item;
        }
        return {
          ...item,
          enabled: item.id === fallbackDefaultId ? true : item.enabled,
          isDefault: item.id === fallbackDefaultId
        };
      });
    });
  }

  function addModel(adapter: BridgeAdapter): void {
    const id = draftModelIdByAdapter[adapter]?.trim() ?? "";
    const label = draftModelLabelByAdapter[adapter]?.trim() ?? "";
    if (!id) {
      return;
    }

    updateModels((previous) => {
      if (previous.some((item) => item.adapter === adapter && item.id === id)) {
        return previous;
      }

      const hasDefault = previous.some((item) => item.adapter === adapter && item.isDefault && item.enabled);
      return [
        ...previous,
        {
          id,
          label: label || id,
          adapter,
          enabled: true,
          isDefault: !hasDefault
        }
      ];
    });

    setDraftModelIdByAdapter((previous) => ({ ...previous, [adapter]: "" }));
    setDraftModelLabelByAdapter((previous) => ({ ...previous, [adapter]: "" }));
  }

  function editModel(
    adapter: BridgeAdapter,
    currentId: string,
    patch: { id?: string; label?: string }
  ): void {
    const nextId = typeof patch.id === "string" ? patch.id.trim() : undefined;
    const nextLabel = typeof patch.label === "string" ? patch.label.trim() : undefined;
    if (nextId !== undefined && !nextId) {
      return;
    }

    updateModels((previous) => {
      const target = previous.find((item) => item.adapter === adapter && item.id === currentId);
      if (!target) {
        return previous;
      }

      const resolvedId = nextId ?? target.id;
      const resolvedLabel = nextLabel ?? target.label;
      if (!resolvedId) {
        return previous;
      }

      const duplicated = previous.some(
        (item) => item.adapter === adapter && item.id === resolvedId && item.id !== currentId
      );
      if (duplicated) {
        return previous;
      }

      return previous.map((item) => {
        if (item.adapter !== adapter || item.id !== currentId) {
          return item;
        }
        return {
          ...item,
          id: resolvedId,
          label: resolvedLabel || resolvedId
        };
      });
    });
  }

  async function saveModelsToBackend(): Promise<void> {
    if (!activeConnection) {
      return;
    }

    try {
      const payload: BridgeModelsUpdateRequest = {
        models: normalizeModelList(models)
      };
      const response = await fetch(`${activeConnection.baseUrl}/models`, {
        method: "PUT",
        headers: buildBridgeHeaders(activeConnection, true),
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        setModelsFeedback(`${t(locale, "modelsSaveFailed")} (${response.status})`);
        return;
      }
      const updated = (await response.json()) as BridgeModelsResponse;
      setModelsState(normalizeModelList(updated.models));
      setModelsDirty(false);
      setModelsFeedback(t(locale, "modelsSaved"));
    } catch {
      setModelsFeedback(t(locale, "modelsSaveFailed"));
    }
  }

  function updateDraftModelId(adapter: BridgeAdapter, value: string): void {
    setDraftModelIdByAdapter((previous) => ({ ...previous, [adapter]: value }));
  }

  function updateDraftModelLabel(adapter: BridgeAdapter, value: string): void {
    setDraftModelLabelByAdapter((previous) => ({ ...previous, [adapter]: value }));
  }

  async function openChatPage(): Promise<void> {
    const chatUrl = chrome.runtime.getURL("src/ui/sidepanel/index.html");
    window.location.href = chatUrl;
  }

  const sectionItems: Array<{
    key: SettingsSection;
    labelKey: "settingsSectionGeneral" | "settingsSectionConnections" | "settingsSectionModels";
    descriptionKey:
      | "settingsSectionGeneralDescription"
      | "settingsSectionConnectionsDescription"
      | "settingsSectionModelsDescription";
  }> = [
    {
      key: "general",
      labelKey: "settingsSectionGeneral",
      descriptionKey: "settingsSectionGeneralDescription"
    },
    {
      key: "connections",
      labelKey: "settingsSectionConnections",
      descriptionKey: "settingsSectionConnectionsDescription"
    },
    {
      key: "models",
      labelKey: "settingsSectionModels",
      descriptionKey: "settingsSectionModelsDescription"
    }
  ];

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-6xl content-start gap-4 px-4 py-4 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div className="grid gap-0.5">
          <h1 className="text-base font-semibold">{t(locale, "settingsTitle")}</h1>
          <p className="text-xs text-muted-foreground">{t(locale, "settingsDescription")}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void openChatPage()}>
          {t(locale, "backToChat")}
        </Button>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border bg-card p-2 lg:sticky lg:top-4">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col">
            {sectionItems.map((item) => {
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                  className={`min-w-[120px] rounded-md px-3 py-2 text-left transition-colors lg:min-w-0 ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <div className="text-sm font-medium">{t(locale, item.labelKey)}</div>
                  <div className={`text-[11px] ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    {t(locale, item.descriptionKey)}
                  </div>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="grid content-start gap-4">
          {activeSection === "general" ? (
            <section className="grid gap-3 rounded-xl border bg-card p-4">
              <div className="grid gap-1">
                <h2 className="text-sm font-semibold">{t(locale, "settingsSectionGeneral")}</h2>
                <p className="text-xs text-muted-foreground">
                  {t(locale, "settingsSectionGeneralDescription")}
                </p>
              </div>

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
                <span className="text-xs text-muted-foreground">{t(locale, "sidebarMode")}</span>
                <Select
                  value={sidebarMode}
                  onValueChange={(value) => void updateSidebarMode(value as UiSidebarMode)}
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
          ) : null}

          {activeSection === "connections" ? (
            <>
              <section className="grid gap-3 rounded-xl border bg-card p-4">
                <div className="grid gap-1">
                  <h2 className="text-sm font-semibold">{t(locale, "settingsSectionConnections")}</h2>
                  <p className="text-xs text-muted-foreground">
                    {t(locale, "settingsSectionConnectionsDescription")}
                  </p>
                </div>

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
              </section>

              <section className="grid gap-3 rounded-xl border bg-card p-4">
                <h3 className="text-sm font-semibold">{t(locale, "addConnection")}</h3>
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
                <div>
                  <Button type="button" onClick={() => void addConnection()}>
                    {t(locale, "addConnection")}
                  </Button>
                </div>
              </section>
            </>
          ) : null}

          {activeSection === "models" ? (
            <section className="grid gap-3 rounded-xl border bg-card p-4">
              <div className="grid gap-1">
                <h2 className="text-sm font-semibold">{t(locale, "modelsTitle")}</h2>
                <p className="text-xs text-muted-foreground">{t(locale, "modelsDescription")}</p>
              </div>

              {!activeConnection ? (
                <p className="text-xs text-muted-foreground">{t(locale, "noConnection")}</p>
              ) : (
                <ModelsEditableTable
                  locale={locale}
                  adapters={MODEL_ADAPTER_OPTIONS}
                  models={models}
                  modelsDirty={modelsDirty}
                  modelsFeedback={modelsFeedback}
                  draftModelIdByAdapter={draftModelIdByAdapter}
                  draftModelLabelByAdapter={draftModelLabelByAdapter}
                  onDraftModelIdChange={updateDraftModelId}
                  onDraftModelLabelChange={updateDraftModelLabel}
                  onAddModel={addModel}
                  onEditModel={editModel}
                  onSetDefaultModel={setDefaultModel}
                  onToggleModelEnabled={toggleModelEnabled}
                  onUpdateModelReasoningEffort={updateModelReasoningEffort}
                  onRemoveModel={removeModel}
                  onSaveModels={() => void saveModelsToBackend()}
                />
              )}
            </section>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function buildBridgeHeaders(
  connection: BridgeConnection,
  includeJsonContentType = false
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(connection.userId ? { "x-surf-user-id": connection.userId } : {})
  };
  if (includeJsonContentType) {
    headers["content-type"] = "application/json";
  }
  if (connection.token) {
    headers["x-surf-token"] = connection.token;
  }
  return headers;
}

function normalizeModelList(models: BridgeModel[]): BridgeModel[] {
  const dedup = new Map<string, BridgeModel>();

  for (const item of models) {
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    const key = `${item.adapter}::${id}`;
    const normalized: BridgeModel = {
      id,
      adapter: item.adapter,
      label: item.label.trim() || id,
      enabled: item.enabled,
      isDefault: item.isDefault,
      ...(item.adapter === "codex" && item.modelReasoningEffort
        ? { modelReasoningEffort: item.modelReasoningEffort }
        : {})
    };
    dedup.set(key, normalized);
  }

  return [...dedup.values()].sort((a, b) => {
    const adapterCmp = a.adapter.localeCompare(b.adapter);
    if (adapterCmp !== 0) {
      return adapterCmp;
    }
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}

function normalizeSidebarMode(value: unknown): UiSidebarMode {
  return value === "overlay" ? "overlay" : "docked";
}

function resolveSettingsSection(raw: string): SettingsSection | undefined {
  if (SETTINGS_SECTIONS.includes(raw as SettingsSection)) {
    return raw as SettingsSection;
  }
  return undefined;
}
