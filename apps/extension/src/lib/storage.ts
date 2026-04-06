import {
  BRIDGE_DEFAULT_BASE_URL,
  STORAGE_KEYS,
  type BridgeAdapter,
  type BridgeConnection,
  type ChatSession,
  type UiThemeMode
} from "@surf-ai/shared";

interface ExtensionStorageShape {
  [STORAGE_KEYS.connections]?: BridgeConnection[];
  [STORAGE_KEYS.activeConnectionId]?: string;
  [STORAGE_KEYS.sessions]?: ChatSession[];
  [STORAGE_KEYS.locale]?: string;
  [STORAGE_KEYS.defaultAdapter]?: BridgeAdapter;
  [STORAGE_KEYS.theme]?: UiThemeMode;
}

export async function getConnections(): Promise<BridgeConnection[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.connections);
  const list = data[STORAGE_KEYS.connections] as BridgeConnection[] | undefined;

  if (list && list.length > 0) {
    return list;
  }

  const now = Date.now();
  const defaultConnection: BridgeConnection = {
    id: crypto.randomUUID(),
    name: "Local Bridge",
    baseUrl: BRIDGE_DEFAULT_BASE_URL,
    userId: "local",
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
  await setConnections([defaultConnection]);
  await setActiveConnectionId(defaultConnection.id);

  return [defaultConnection];
}

export async function setConnections(connections: BridgeConnection[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.connections]: connections });
}

export async function getActiveConnectionId(): Promise<string | undefined> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.activeConnectionId);
  return data[STORAGE_KEYS.activeConnectionId] as string | undefined;
}

export async function setActiveConnectionId(id: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeConnectionId]: id });
}

export async function getSessions(): Promise<ChatSession[]> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.sessions);
  return (data[STORAGE_KEYS.sessions] as ChatSession[] | undefined) ?? [];
}

export async function setSessions(sessions: ChatSession[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.sessions]: sessions });
}

export async function getLocale(): Promise<string | undefined> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.locale);
  return data[STORAGE_KEYS.locale] as string | undefined;
}

export async function setLocale(locale: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.locale]: locale });
}

export async function getDefaultAdapter(): Promise<BridgeAdapter | undefined> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.defaultAdapter);
  return data[STORAGE_KEYS.defaultAdapter] as BridgeAdapter | undefined;
}

export async function setDefaultAdapter(adapter: BridgeAdapter): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.defaultAdapter]: adapter });
}

export async function getTheme(): Promise<UiThemeMode | undefined> {
  const data = await chrome.storage.local.get(STORAGE_KEYS.theme);
  return data[STORAGE_KEYS.theme] as UiThemeMode | undefined;
}

export async function setTheme(theme: UiThemeMode): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.theme]: theme });
}

export function onStorageChanged(
  callback: (changes: { [key: string]: chrome.storage.StorageChange }) => void
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (areaName !== "local") return;
    callback(changes);
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function clearAllStorage(): Promise<void> {
  await chrome.storage.local.clear();
}

export async function getRawStorage(): Promise<ExtensionStorageShape> {
  return (await chrome.storage.local.get()) as ExtensionStorageShape;
}
