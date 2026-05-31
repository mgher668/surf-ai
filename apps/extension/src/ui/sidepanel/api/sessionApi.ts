import type {
  BridgeChatRequest,
  BridgeConnection,
  BridgeSessionAdapterRequest,
  BridgeSessionAdapterResponse,
  BridgeSessionCreateResponse,
  BridgeSessionListResponse,
  BridgeSessionMessagesResponse,
  BridgeSessionRenameRequest,
  BridgeSessionRenameResponse,
  BridgeSessionStarRequest,
  ChatMessage,
  ChatSession
} from "@surf-ai/shared";
import { saveMessages } from "../../../lib/db";
import { type Locale, t } from "../../common/i18n";
import { buildBridgeHeaders } from "../utils/sidepanel-helpers";
import { fetchBridgeJson } from "./bridgeApi";

type RuntimeAlertReporter = (
  code: "backend_unreachable" | "auth_failed" | "rate_limited" | "bridge_request_failed",
  level: "warn" | "error",
  message: string,
  statusCode?: number
) => void;

interface BackendRuntimeHandlers {
  locale: Locale;
  reportRuntimeAlert: RuntimeAlertReporter;
  clearRuntimeAlert: () => void;
}

export async function fetchSessionsFromBackend(
  connection: BridgeConnection,
  handlers: BackendRuntimeHandlers
): Promise<ChatSession[] | null> {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchBridgeJson<BridgeSessionListResponse>(connection, "/sessions");
      if (response.ok) {
        handlers.clearRuntimeAlert();
        return response.data.sessions;
      }
      if (response.status === 401 || response.status === 403) {
        handlers.reportRuntimeAlert(
          "auth_failed",
          "error",
          t(handlers.locale, "alertAuthFailed"),
          response.status
        );
        return null;
      }
      reportBridgeStatus(response.status, handlers, true);
    } catch {
      handlers.reportRuntimeAlert(
        "backend_unreachable",
        "error",
        t(handlers.locale, "alertBackendUnreachable")
      );
    }

    if (attempt < maxAttempts - 1) {
      await sleep(300 * (attempt + 1));
    }
  }
  return null;
}

export async function loadMessagesFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  handlers: BackendRuntimeHandlers
): Promise<ChatMessage[]> {
  try {
    const response = await fetchBridgeJson<BridgeSessionMessagesResponse>(
      connection,
      `/sessions/${sessionId}/messages?afterSeq=0&limit=500`
    );
    if (!response.ok) {
      reportBridgeStatus(response.status, handlers, true);
      throw new Error(`messages_request_failed:${response.status}`);
    }
    await saveMessages(response.data.messages);
    handlers.clearRuntimeAlert();
    return response.data.messages;
  } catch (error) {
    if (error instanceof TypeError) {
      handlers.reportRuntimeAlert(
        "backend_unreachable",
        "error",
        t(handlers.locale, "alertBackendUnreachable")
      );
    }
    return [
      {
        id: crypto.randomUUID(),
        sessionId,
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "load_messages_failed"}`,
        createdAt: Date.now()
      }
    ];
  }
}

export async function createSessionOnBackend(
  connection: BridgeConnection,
  title: string,
  handlers: BackendRuntimeHandlers
): Promise<ChatSession | null> {
  try {
    const response = await fetch(`${connection.baseUrl}/sessions`, {
      method: "POST",
      headers: buildBridgeHeaders(connection, true),
      body: JSON.stringify({ title })
    });
    if (!response.ok) {
      reportBridgeStatus(response.status, handlers, true);
      return null;
    }
    const payload = (await response.json()) as BridgeSessionCreateResponse;
    handlers.clearRuntimeAlert();
    return payload.session;
  } catch {
    handlers.reportRuntimeAlert(
      "backend_unreachable",
      "error",
      t(handlers.locale, "alertBackendUnreachable")
    );
    return null;
  }
}

export async function updateSessionStarOnBackend(
  connection: BridgeConnection,
  sessionId: string,
  starred: boolean,
  handlers: BackendRuntimeHandlers
): Promise<ChatSession | null> {
  try {
    const body: BridgeSessionStarRequest = { starred };
    const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/star`, {
      method: "POST",
      headers: buildBridgeHeaders(connection, true),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      reportBridgeStatus(response.status, handlers, false);
      return null;
    }
    const payload = (await response.json()) as { session: ChatSession };
    handlers.clearRuntimeAlert();
    return payload.session;
  } catch {
    handlers.reportRuntimeAlert(
      "backend_unreachable",
      "error",
      t(handlers.locale, "alertBackendUnreachable")
    );
    return null;
  }
}

export async function updateSessionAdapterOnBackend(
  connection: BridgeConnection,
  sessionId: string,
  nextAdapter: BridgeChatRequest["adapter"],
  handlers: BackendRuntimeHandlers
): Promise<ChatSession | null> {
  try {
    const body: BridgeSessionAdapterRequest = { adapter: nextAdapter };
    const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}/adapter`, {
      method: "POST",
      headers: buildBridgeHeaders(connection, true),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      reportBridgeStatus(response.status, handlers, false);
      return null;
    }
    const payload = (await response.json()) as BridgeSessionAdapterResponse;
    handlers.clearRuntimeAlert();
    return payload.session;
  } catch {
    handlers.reportRuntimeAlert(
      "backend_unreachable",
      "error",
      t(handlers.locale, "alertBackendUnreachable")
    );
    return null;
  }
}

export async function renameSessionOnBackend(
  connection: BridgeConnection,
  sessionId: string,
  title: string,
  handlers: BackendRuntimeHandlers
): Promise<ChatSession | null> {
  try {
    const body: BridgeSessionRenameRequest = { title };
    const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: buildBridgeHeaders(connection, true),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      reportBridgeStatus(response.status, handlers, true);
      return null;
    }
    const payload = (await response.json()) as BridgeSessionRenameResponse;
    handlers.clearRuntimeAlert();
    return payload.session;
  } catch {
    handlers.reportRuntimeAlert(
      "backend_unreachable",
      "error",
      t(handlers.locale, "alertBackendUnreachable")
    );
    return null;
  }
}

export async function deleteSessionOnBackend(
  connection: BridgeConnection,
  sessionId: string,
  handlers: BackendRuntimeHandlers
): Promise<boolean> {
  try {
    const response = await fetch(`${connection.baseUrl}/sessions/${sessionId}`, {
      method: "DELETE",
      headers: buildBridgeHeaders(connection)
    });
    if (response.ok) {
      handlers.clearRuntimeAlert();
      return true;
    }
    reportBridgeStatus(response.status, handlers, false);
    return false;
  } catch {
    handlers.reportRuntimeAlert(
      "backend_unreachable",
      "error",
      t(handlers.locale, "alertBackendUnreachable")
    );
    return false;
  }
}

function reportBridgeStatus(
  status: number,
  handlers: BackendRuntimeHandlers,
  includeBridgeRequestFallback: boolean
): void {
  if (status === 401 || status === 403) {
    handlers.reportRuntimeAlert("auth_failed", "error", t(handlers.locale, "alertAuthFailed"), status);
    return;
  }
  if (status === 429) {
    handlers.reportRuntimeAlert("rate_limited", "warn", t(handlers.locale, "alertRateLimited"), status);
    return;
  }
  if (includeBridgeRequestFallback) {
    handlers.reportRuntimeAlert(
      "bridge_request_failed",
      "warn",
      `${t(handlers.locale, "alertBridgeRequestFailed")} (${status})`,
      status
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
