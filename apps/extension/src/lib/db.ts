import type { ChatMessage } from "@surf-ai/shared";

const DB_NAME = "surf-ai";
const DB_VERSION = 1;
const STORE_MESSAGES = "messages";

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

export async function saveMessage(message: ChatMessage): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readwrite");
    tx.objectStore(STORE_MESSAGES).put(message);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to save message"));
  });
}

export async function listMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
  const db = await getDb();

  return await new Promise<ChatMessage[]>((resolve, reject) => {
    const tx = db.transaction(STORE_MESSAGES, "readonly");
    const index = tx.objectStore(STORE_MESSAGES).index("sessionId");
    const request = index.getAll(IDBKeyRange.only(sessionId));

    request.onsuccess = () => {
      const rows = (request.result as ChatMessage[]).sort((a, b) => a.createdAt - b.createdAt);
      resolve(rows);
    };

    request.onerror = () => reject(request.error ?? new Error("Failed to list messages"));
  });
}
