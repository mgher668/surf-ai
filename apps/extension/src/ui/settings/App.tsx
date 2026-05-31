import { useEffect, useMemo, useState } from "react";
import type {
  BridgeAdapter,
  BridgeConnection,
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
import { type Locale, resolveLocale } from "../common/i18n";
import { applyTheme, listenSystemThemeChange, normalizeThemeMode } from "../common/theme";
import { ConnectionsSection } from "./components/ConnectionsSection";
import { GeneralSection } from "./components/GeneralSection";
import { MemoriesSection } from "./components/MemoriesSection";
import { ModelsSection } from "./components/ModelsSection";
import { SettingsHeader } from "./components/SettingsHeader";
import { SettingsNav } from "./components/SettingsNav";
import { useSettingsMemories } from "./hooks/useSettingsMemories";
import { useSettingsModels } from "./hooks/useSettingsModels";
import { type SettingsSection, resolveSettingsSection } from "./utils/settingsSections";

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
const MODEL_ADAPTER_OPTIONS: BridgeAdapter[] = ["codex", "claude", "openai-compatible", "mock"];

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

  const activeConnection = useMemo(
    () => connections.find((item) => item.id === activeConnectionId),
    [connections, activeConnectionId]
  );

  const {
    models,
    modelsDirty,
    modelsFeedback,
    draftModelIdByAdapter,
    draftModelLabelByAdapter,
    updateDraftModelId,
    updateDraftModelLabel,
    addModel,
    editModel,
    setDefaultModel,
    toggleModelEnabled,
    updateModelReasoningEffort,
    removeModel,
    saveModelsToBackend
  } = useSettingsModels({ activeConnection, locale });

  const {
    memories,
    memoriesFeedback,
    loadMemories,
    confirmMemory,
    rejectMemory,
    deleteMemory
  } = useSettingsMemories({ activeConnection, locale });

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

  async function openChatPage(): Promise<void> {
    const chatUrl = chrome.runtime.getURL("src/ui/sidepanel/index.html");
    window.location.href = chatUrl;
  }

  return (
    <main className="surf-settings-shell">
      <SettingsHeader locale={locale} onBackToChat={() => void openChatPage()} />

      <div className="grid items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <SettingsNav
          locale={locale}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />

        <section className="grid content-start gap-4">
          {activeSection === "general" ? (
            <GeneralSection
              locale={locale}
              adapterOptions={ADAPTER_OPTIONS}
              defaultAdapter={defaultAdapter}
              sidebarMode={sidebarMode}
              themeMode={themeMode}
              onDefaultAdapterChange={(value) => void updateDefaultAdapter(value)}
              onLocaleChange={(value) => void updateLocale(value)}
              onSidebarModeChange={(value) => void updateSidebarMode(value)}
              onThemeModeChange={(value) => void updateThemeMode(value)}
            />
          ) : null}

          {activeSection === "connections" ? (
            <ConnectionsSection
              locale={locale}
              connections={connections}
              activeConnectionId={activeConnectionId}
              activeConnection={activeConnection}
              newConnName={newConnName}
              newConnUrl={newConnUrl}
              newConnUserId={newConnUserId}
              newConnToken={newConnToken}
              onActiveConnectionChange={(value) => void updateActiveConnection(value)}
              onNewConnNameChange={setNewConnName}
              onNewConnUrlChange={setNewConnUrl}
              onNewConnUserIdChange={setNewConnUserId}
              onNewConnTokenChange={setNewConnToken}
              onAddConnection={() => void addConnection()}
            />
          ) : null}

          {activeSection === "models" ? (
            <ModelsSection
              locale={locale}
              activeConnection={activeConnection}
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
          ) : null}

          {activeSection === "memories" ? (
            <MemoriesSection
              locale={locale}
              activeConnection={activeConnection}
              memories={memories}
              memoriesFeedback={memoriesFeedback}
              onRefresh={() => void loadMemories(activeConnection)}
              onConfirmMemory={(memoryId) => void confirmMemory(memoryId)}
              onRejectMemory={(memoryId) => void rejectMemory(memoryId)}
              onDeleteMemory={(memoryId) => void deleteMemory(memoryId)}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function normalizeSidebarMode(value: unknown): UiSidebarMode {
  return value === "overlay" ? "overlay" : "docked";
}
