import { useEffect, useState } from "react";
import type {
  BridgeConnection,
  BridgeMemory,
  BridgeMemoryListResponse,
  BridgeMemoryResponse
} from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { buildBridgeHeaders } from "../utils/bridgeApi";

interface UseSettingsMemoriesOptions {
  activeConnection: BridgeConnection | undefined;
  locale: Locale;
}

export function useSettingsMemories({
  activeConnection,
  locale
}: UseSettingsMemoriesOptions): {
  memories: BridgeMemory[];
  memoriesFeedback: string | undefined;
  loadMemories: (connection: BridgeConnection | undefined) => Promise<void>;
  confirmMemory: (memoryId: string) => Promise<void>;
  rejectMemory: (memoryId: string) => Promise<void>;
  deleteMemory: (memoryId: string) => Promise<void>;
} {
  const [memories, setMemoriesState] = useState<BridgeMemory[]>([]);
  const [memoriesFeedback, setMemoriesFeedback] = useState<string | undefined>();

  useEffect(() => {
    void loadMemories(activeConnection);
  }, [activeConnection?.id, activeConnection?.baseUrl, activeConnection?.userId, activeConnection?.token]);

  async function loadMemories(connection: BridgeConnection | undefined): Promise<void> {
    setMemoriesFeedback(undefined);
    if (!connection) {
      setMemoriesState([]);
      return;
    }

    try {
      const response = await fetch(`${connection.baseUrl}/memories?limit=100`, {
        headers: buildBridgeHeaders(connection)
      });
      if (!response.ok) {
        setMemoriesFeedback(`${t(locale, "memoriesLoadFailed")} (${response.status})`);
        return;
      }
      const payload = (await response.json()) as BridgeMemoryListResponse;
      setMemoriesState(payload.memories);
    } catch {
      setMemoriesFeedback(t(locale, "memoriesLoadFailed"));
    }
  }

  async function confirmMemory(memoryId: string): Promise<void> {
    await mutateMemory(memoryId, "confirm");
  }

  async function rejectMemory(memoryId: string): Promise<void> {
    await mutateMemory(memoryId, "reject");
  }

  async function deleteMemory(memoryId: string): Promise<void> {
    await mutateMemory(memoryId, "delete");
  }

  async function mutateMemory(
    memoryId: string,
    action: "confirm" | "reject" | "delete"
  ): Promise<void> {
    if (!activeConnection) {
      return;
    }

    setMemoriesFeedback(undefined);
    try {
      const url =
        action === "delete"
          ? `${activeConnection.baseUrl}/memories/${memoryId}`
          : `${activeConnection.baseUrl}/memories/${memoryId}/${action}`;
      const response = await fetch(url, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: buildBridgeHeaders(activeConnection, action !== "delete")
      });
      if (!response.ok) {
        setMemoriesFeedback(`${t(locale, "memoriesActionFailed")} (${response.status})`);
        return;
      }

      if (action === "delete") {
        setMemoriesState((prev) => prev.filter((item) => item.id !== memoryId));
        setMemoriesFeedback(t(locale, "memoriesDeleted"));
        return;
      }

      const payload = (await response.json()) as BridgeMemoryResponse;
      setMemoriesState((prev) =>
        prev.map((item) => (item.id === payload.memory.id ? payload.memory : item))
      );
      setMemoriesFeedback(
        action === "confirm" ? t(locale, "memoriesConfirmed") : t(locale, "memoriesRejected")
      );
    } catch {
      setMemoriesFeedback(t(locale, "memoriesActionFailed"));
    }
  }

  return {
    memories,
    memoriesFeedback,
    loadMemories,
    confirmMemory,
    rejectMemory,
    deleteMemory
  };
}
