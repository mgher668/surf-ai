import { useState, type Dispatch, type SetStateAction } from "react";
import type {
  BridgeChatRequest,
  BridgeConnection,
  ChatMessage,
  ChatSession
} from "@surf-ai/shared";
import { deleteMessagesBySession } from "../../../lib/db";
import { setSessions } from "../../../lib/storage";
import { type Locale, t } from "../../common/i18n";
import {
  deleteSessionOnBackend,
  renameSessionOnBackend,
  updateSessionStarOnBackend
} from "../api/sessionApi";

type SessionMode = "backend" | "local";

type RuntimeAlertReporter = (
  code: "backend_unreachable" | "auth_failed" | "rate_limited" | "bridge_request_failed",
  level: "warn" | "error",
  message: string,
  statusCode?: number
) => void;

interface UseSessionActionsOptions {
  locale: Locale;
  sessionMode: SessionMode;
  backendDraftSessionId: string;
  activeConnection: BridgeConnection | undefined;
  sessions: ChatSession[];
  setSessionsState: Dispatch<SetStateAction<ChatSession[]>>;
  activeSessionId: string | undefined;
  setActiveSessionId: Dispatch<SetStateAction<string | undefined>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  clearSelectionAndPageContext: () => void;
  createLocalSession: (title: string) => ChatSession;
  reportRuntimeAlert: RuntimeAlertReporter;
  clearRuntimeAlert: () => void;
}

interface UseSessionActionsResult {
  renameDialogOpen: boolean;
  renameTargetSession: ChatSession | null;
  renameTitleInput: string;
  setRenameTitleInput: Dispatch<SetStateAction<string>>;
  renameError: string | undefined;
  setRenameError: Dispatch<SetStateAction<string | undefined>>;
  openRenameDialog: (session: ChatSession) => void;
  closeRenameDialog: () => void;
  submitRenameDialog: () => Promise<void>;
  createNewSession: () => Promise<void>;
  rememberSessionAdapter: (
    sessionId: string,
    nextAdapter: BridgeChatRequest["adapter"]
  ) => void;
  toggleStarSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

export function useSessionActions({
  locale,
  sessionMode,
  backendDraftSessionId,
  activeConnection,
  sessions,
  setSessionsState,
  activeSessionId,
  setActiveSessionId,
  setMessages,
  clearSelectionAndPageContext,
  createLocalSession,
  reportRuntimeAlert,
  clearRuntimeAlert
}: UseSessionActionsOptions): UseSessionActionsResult {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTargetSession, setRenameTargetSession] = useState<ChatSession | null>(null);
  const [renameTitleInput, setRenameTitleInput] = useState("");
  const [renameError, setRenameError] = useState<string | undefined>();

  function openRenameDialog(session: ChatSession): void {
    setRenameTargetSession(session);
    setRenameTitleInput(session.title);
    setRenameError(undefined);
    setRenameDialogOpen(true);
  }

  function closeRenameDialog(): void {
    setRenameDialogOpen(false);
    setRenameTargetSession(null);
    setRenameTitleInput("");
    setRenameError(undefined);
  }

  async function createNewSession(): Promise<void> {
    if (sessionMode === "backend") {
      setActiveSessionId(backendDraftSessionId);
      setMessages([]);
      clearSelectionAndPageContext();
      return;
    }

    const session = createLocalSession(`Chat ${sessions.length + 1}`);
    const next = [session, ...sessions];
    await setSessions(next);
    setSessionsState(next);
    setActiveSessionId(session.id);
  }

  function rememberSessionAdapter(
    sessionId: string,
    nextAdapter: BridgeChatRequest["adapter"]
  ): void {
    if (sessionId === backendDraftSessionId) {
      return;
    }
    setSessionsState((prev) => {
      let changed = false;
      const next = prev.map((item) => {
        if (item.id !== sessionId || item.lastAdapter === nextAdapter) {
          return item;
        }
        changed = true;
        return {
          ...item,
          lastAdapter: nextAdapter
        };
      });
      if (!changed) {
        return prev;
      }
      void setSessions(next);
      return next;
    });
  }

  async function toggleStarSession(id: string): Promise<void> {
    if (sessionMode === "backend" && activeConnection) {
      const current = sessions.find((item) => item.id === id);
      if (!current) {
        return;
      }
      const updated = await updateSessionStarOnBackend(
        activeConnection,
        id,
        !current.starred,
        getBackendRuntimeHandlers()
      );
      if (!updated) {
        return;
      }
      setSessionsState((prev) => {
        const next = prev.map((item) => (item.id === id ? updated : item));
        void setSessions(next);
        return next;
      });
      return;
    }

    const next = sessions.map((item) =>
      item.id === id ? { ...item, starred: !item.starred, updatedAt: Date.now() } : item
    );
    await setSessions(next);
    setSessionsState(next);
  }

  async function renameSession(session: ChatSession, title: string): Promise<boolean> {
    if (!title || title === session.title) {
      return true;
    }
    if (sessionMode === "backend") {
      if (!activeConnection) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? session.id,
            role: "assistant",
            content: "Error: no active bridge connection. Please add/select one in Settings first.",
            createdAt: Date.now()
          }
        ]);
        return false;
      }
      const updated = await renameSessionOnBackend(
        activeConnection,
        session.id,
        title,
        getBackendRuntimeHandlers()
      );
      if (!updated) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? session.id,
            role: "assistant",
            content: `${t(locale, "renameSessionFailed")}.`,
            createdAt: Date.now()
          }
        ]);
        return false;
      }
      setSessionsState((prev) => {
        const next = prev.map((item) => (item.id === session.id ? updated : item));
        void setSessions(next);
        return next;
      });
      return true;
    }

    const next = sessions.map((item) =>
      item.id === session.id
        ? {
            ...item,
            title,
            updatedAt: Date.now()
          }
        : item
    );
    await setSessions(next);
    setSessionsState(next);
    return true;
  }

  async function submitRenameDialog(): Promise<void> {
    if (!renameTargetSession) {
      closeRenameDialog();
      return;
    }
    const title = renameTitleInput.trim();
    if (!title) {
      setRenameError(t(locale, "renameSessionEmpty"));
      return;
    }
    if (title.length > 120) {
      setRenameError(t(locale, "renameSessionTooLong"));
      return;
    }

    const renamed = await renameSession(renameTargetSession, title);
    if (!renamed) {
      setRenameError(t(locale, "renameSessionFailed"));
      return;
    }

    closeRenameDialog();
  }

  async function deleteSession(id: string): Promise<void> {
    const confirmed = window.confirm(t(locale, "deleteSessionConfirm"));
    if (!confirmed) {
      return;
    }

    if (sessionMode === "backend") {
      if (!activeConnection) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? "pending",
            role: "assistant",
            content: "Error: no active bridge connection. Please add/select one in Settings first.",
            createdAt: Date.now()
          }
        ]);
        return;
      }
      const deleted = await deleteSessionOnBackend(
        activeConnection,
        id,
        getBackendRuntimeHandlers()
      );
      if (!deleted) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            sessionId: activeSessionId ?? "pending",
            role: "assistant",
            content: "Error: failed to delete backend session.",
            createdAt: Date.now()
          }
        ]);
        return;
      }

      await deleteMessagesBySession(id).catch(() => undefined);
      setSessionsState((prev) => {
        const filtered = prev.filter((item) => item.id !== id);
        void setSessions(filtered);
        return filtered;
      });
      setActiveSessionId(backendDraftSessionId);
      return;
    }

    await deleteMessagesBySession(id).catch(() => undefined);
    const replacement = createLocalSession("New chat");
    const filtered = sessions.filter((item) => item.id !== id);
    const next = [replacement, ...filtered];
    await setSessions(next);
    setSessionsState(next);
    setActiveSessionId(replacement.id);
  }

  function getBackendRuntimeHandlers() {
    return {
      locale,
      reportRuntimeAlert,
      clearRuntimeAlert
    };
  }

  return {
    renameDialogOpen,
    renameTargetSession,
    renameTitleInput,
    setRenameTitleInput,
    renameError,
    setRenameError,
    openRenameDialog,
    closeRenameDialog,
    submitRenameDialog,
    createNewSession,
    rememberSessionAdapter,
    toggleStarSession,
    deleteSession
  };
}
