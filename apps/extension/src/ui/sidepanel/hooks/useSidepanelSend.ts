import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  BridgeChatRequest,
  BridgeConnection,
  BridgeModel,
  BridgeSessionRun,
  BridgeSessionRunCreateResponse,
  BridgeUploadCreateResponse,
  ChatMessage,
  ChatSession,
  PageContentPayload,
  SelectionPayload
} from "@surf-ai/shared";
import { saveMessage } from "../../../lib/db";
import { setSessions } from "../../../lib/storage";
import { type Locale, t } from "../../common/i18n";
import { createSessionOnBackend } from "../api/sessionApi";
import {
  buildBridgeHeaders,
  buildChatContext,
  type ComposerAttachment
} from "../utils/sidepanel-helpers";

type SessionMode = "backend" | "local";

type RuntimeAlertReporter = (
  code: "backend_unreachable" | "auth_failed" | "rate_limited" | "bridge_request_failed",
  level: "warn" | "error",
  message: string,
  statusCode?: number
) => void;

interface UseSidepanelSendOptions {
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  composerAttachments: ComposerAttachment[];
  clearComposerAttachments: () => void;
  setComposerAttachmentError: (error: string | undefined) => void;
  activeConnection: BridgeConnection | undefined;
  activeSessionId: string | undefined;
  setActiveSessionId: Dispatch<SetStateAction<string | undefined>>;
  sessionMode: SessionMode;
  backendDraftSessionId: string;
  sessions: ChatSession[];
  setSessionsState: Dispatch<SetStateAction<ChatSession[]>>;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setLoadedMessagesSessionId: Dispatch<SetStateAction<string | undefined>>;
  setPending: Dispatch<SetStateAction<boolean>>;
  isActiveRunBusy: boolean;
  adapter: BridgeChatRequest["adapter"];
  model: string;
  selectedModel: BridgeModel | undefined;
  selectionContext: SelectionPayload | undefined;
  pageContent: PageContentPayload | undefined;
  includePageContext: boolean;
  clearExtractedPageContent: () => void;
  pendingAutoScrollSessionIdRef: MutableRefObject<string | undefined>;
  createLocalSession: (title: string) => ChatSession;
  setActiveRun: Dispatch<SetStateAction<BridgeSessionRun | undefined>>;
  handleRunCreated: (run: BridgeSessionRun) => void;
  locale: Locale;
  reportRuntimeAlert: RuntimeAlertReporter;
  clearRuntimeAlert: () => void;
}

interface UseSidepanelSendResult {
  send: () => Promise<void>;
}

export function useSidepanelSend({
  input,
  setInput,
  composerAttachments,
  clearComposerAttachments,
  setComposerAttachmentError,
  activeConnection,
  activeSessionId,
  setActiveSessionId,
  sessionMode,
  backendDraftSessionId,
  sessions,
  setSessionsState,
  messages,
  setMessages,
  setLoadedMessagesSessionId,
  setPending,
  isActiveRunBusy,
  adapter,
  model,
  selectedModel,
  selectionContext,
  pageContent,
  includePageContext,
  clearExtractedPageContent,
  pendingAutoScrollSessionIdRef,
  createLocalSession,
  setActiveRun,
  handleRunCreated,
  locale,
  reportRuntimeAlert,
  clearRuntimeAlert
}: UseSidepanelSendOptions): UseSidepanelSendResult {
  async function send(): Promise<void> {
    const content = input.trim();
    const hasAttachments = composerAttachments.length > 0;
    if (!content && !hasAttachments) {
      return;
    }
    if (isActiveRunBusy) {
      return;
    }
    if (!activeConnection) {
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId ?? "pending",
        role: "assistant",
        adapter,
        model,
        content: "Error: no active bridge connection. Please add/select one in Settings first.",
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, errMessage]);
      return;
    }

    if (sessionMode === "backend") {
      let sessionId = activeSessionId;
      if (!sessionId || sessionId === backendDraftSessionId) {
        const created = await createSessionOnBackend(
          activeConnection,
          "New chat",
          getBackendRuntimeHandlers()
        );
        if (!created) {
          const errMessage: ChatMessage = {
            id: crypto.randomUUID(),
            sessionId: "pending",
            role: "assistant",
            adapter,
            model,
            content: "Error: no active backend session and failed to create one.",
            createdAt: Date.now()
          };
          setMessages((prev) => [...prev, errMessage]);
          return;
        }

        setSessionsState((prev) => {
          const next = [created, ...prev];
          void setSessions(next);
          return next;
        });
        setActiveSessionId(created.id);
        sessionId = created.id;
      }

      await sendWithBackend(activeConnection, sessionId, content, composerAttachments);
      return;
    }

    if (hasAttachments) {
      setComposerAttachmentError(t(locale, "composerAttachmentBackendOnly"));
      return;
    }

    if (!activeSessionId) {
      const session = createLocalSession("New chat");
      const next = [session, ...sessions];
      await setSessions(next);
      setSessionsState(next);
      setActiveSessionId(session.id);
      await sendWithBackend(activeConnection, session.id, content, composerAttachments);
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      role: "user",
      adapter,
      model,
      content,
      createdAt: Date.now()
    };

    await saveMessage(userMessage);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPending(true);

    try {
      const context = buildChatContext(selectionContext, pageContent, includePageContext);

      const requestPayload: BridgeChatRequest = {
        adapter,
        model,
        ...(adapter === "codex" && selectedModel?.modelReasoningEffort
          ? { modelReasoningEffort: selectedModel.modelReasoningEffort }
          : {}),
        sessionId: activeSessionId,
        messages: [...messages, userMessage].map((item) => ({
          role: item.role,
          content: item.content
        }))
      };
      if (Object.keys(context).length > 0) {
        requestPayload.context = context;
      }

      const response = await fetch(`${activeConnection.baseUrl}/chat`, {
        method: "POST",
        headers: buildBridgeHeaders(activeConnection, true),
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        reportBridgeStatus(response.status);
        const failedText = await response.text();
        throw new Error(`Bridge request failed: ${response.status} ${failedText}`);
      }

      const result = (await response.json()) as { output: string };
      clearRuntimeAlert();

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: "assistant",
        adapter,
        model,
        content: result.output,
        createdAt: Date.now()
      };

      await saveMessage(assistantMessage);
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: activeSessionId,
        role: "assistant",
        adapter,
        model,
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      await saveMessage(errMessage);
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
      clearExtractedPageContent();
    }
  }

  async function sendWithBackend(
    connection: BridgeConnection,
    sessionId: string,
    content: string,
    attachments: ComposerAttachment[]
  ): Promise<void> {
    setPending(true);
    setComposerAttachmentError(undefined);

    try {
      const attachmentIds: string[] = [];
      for (const attachment of attachments) {
        const uploadUrl = new URL("/uploads", connection.baseUrl);
        uploadUrl.searchParams.set("sessionId", sessionId);
        if (attachment.file.name) {
          uploadUrl.searchParams.set("fileName", attachment.file.name);
        }

        const uploadResponse = await fetch(uploadUrl.toString(), {
          method: "POST",
          headers: {
            ...buildBridgeHeaders(connection),
            ...(attachment.mimeType ? { "content-type": attachment.mimeType } : {})
          },
          body: attachment.file
        });

        if (!uploadResponse.ok) {
          reportBridgeStatus(uploadResponse.status);

          if (uploadResponse.status === 413) {
            setComposerAttachmentError(t(locale, "composerAttachmentFileTooLarge"));
          } else if (uploadResponse.status === 415) {
            setComposerAttachmentError(t(locale, "composerAttachmentTypeNotAllowed"));
          } else {
            setComposerAttachmentError(t(locale, "composerAttachmentUploadFailed"));
          }

          const failedText = await uploadResponse.text();
          throw new Error(`Bridge upload failed: ${uploadResponse.status} ${failedText}`);
        }

        const uploadPayload = (await uploadResponse.json()) as BridgeUploadCreateResponse;
        attachmentIds.push(uploadPayload.attachment.id);
      }

      const context = buildChatContext(selectionContext, pageContent, includePageContext);
      const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/runs`, {
        method: "POST",
        headers: buildBridgeHeaders(connection, true),
        body: JSON.stringify({
          adapter,
          model,
          ...(adapter === "codex" && selectedModel?.modelReasoningEffort
            ? { modelReasoningEffort: selectedModel.modelReasoningEffort }
            : {}),
          content,
          ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
          ...(Object.keys(context).length > 0 ? { context } : {})
        })
      });

      if (response.status === 409) {
        const conflictPayload = (await response.json().catch(() => null)) as
          | { run?: BridgeSessionRun }
          | null;
        if (conflictPayload?.run) {
          setActiveRun(conflictPayload.run);
        }
        reportRuntimeAlert(
          "bridge_request_failed",
          "warn",
          `${t(locale, "runAlreadyInProgress")}`,
          response.status
        );
        return;
      }

      if (!response.ok) {
        reportBridgeStatus(response.status);
        const failedText = await response.text();
        throw new Error(`Bridge session run failed: ${response.status} ${failedText}`);
      }

      const payload = (await response.json()) as BridgeSessionRunCreateResponse;
      clearRuntimeAlert();
      setInput("");
      clearComposerAttachments();
      pendingAutoScrollSessionIdRef.current = sessionId;
      setMessages((prev) => [...prev, payload.userMessage]);
      setLoadedMessagesSessionId(sessionId);
      await saveMessage(payload.userMessage);
      handleRunCreated(payload.run);
      setSessionsState((prev) => {
        const existingIndex = prev.findIndex((item) => item.id === payload.session.id);
        const next =
          existingIndex >= 0
            ? prev.map((item) => (item.id === payload.session.id ? payload.session : item))
            : [payload.session, ...prev];
        void setSessions(next);
        return next;
      });
    } catch (error) {
      if (error instanceof TypeError) {
        reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      }
      const errMessage: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        adapter,
        model,
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, errMessage]);
    } finally {
      setPending(false);
      clearExtractedPageContent();
    }
  }

  function getBackendRuntimeHandlers() {
    return {
      locale,
      reportRuntimeAlert,
      clearRuntimeAlert
    };
  }

  function reportBridgeStatus(status: number): void {
    if (status === 401 || status === 403) {
      reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), status);
      return;
    }
    if (status === 429) {
      reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), status);
      return;
    }
    reportRuntimeAlert(
      "bridge_request_failed",
      "warn",
      `${t(locale, "alertBridgeRequestFailed")} (${status})`,
      status
    );
  }

  return { send };
}
