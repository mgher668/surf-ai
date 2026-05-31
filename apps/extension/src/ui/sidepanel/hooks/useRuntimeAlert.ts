import { useCallback, useEffect, useState } from "react";
import type {
  BridgeAuditEvent,
  BridgeAuditEventsResponse,
  BridgeConnection,
  UiStatusBadgeLevel,
  UiToExtensionMessage
} from "@surf-ai/shared";
import { fetchBridgeJson } from "../api/bridgeApi";

type RuntimeAlertLevel = "warn" | "error";
type RuntimeAlertCode =
  | "backend_unreachable"
  | "auth_failed"
  | "rate_limited"
  | "bridge_request_failed";

interface RuntimeAlert {
  code: RuntimeAlertCode;
  level: RuntimeAlertLevel;
  message: string;
  statusCode?: number;
  updatedAt: number;
}

interface UseRuntimeAlertResult {
  runtimeAlert: RuntimeAlert | undefined;
  recentAuditEvents: BridgeAuditEvent[];
  reportRuntimeAlert: (
    code: RuntimeAlertCode,
    level: RuntimeAlertLevel,
    message: string,
    statusCode?: number
  ) => void;
  clearRuntimeAlert: () => void;
}

export function useRuntimeAlert(
  activeConnection: BridgeConnection | undefined
): UseRuntimeAlertResult {
  const [runtimeAlert, setRuntimeAlert] = useState<RuntimeAlert | undefined>();
  const [recentAuditEvents, setRecentAuditEvents] = useState<BridgeAuditEvent[]>([]);

  const reportRuntimeAlert = useCallback(
    (
      code: RuntimeAlertCode,
      level: RuntimeAlertLevel,
      message: string,
      statusCode?: number
    ): void => {
      setRuntimeAlert((previous) => {
        if (
          previous &&
          previous.code === code &&
          previous.level === level &&
          previous.message === message &&
          previous.statusCode === statusCode
        ) {
          return previous;
        }
        return {
          code,
          level,
          message,
          ...(typeof statusCode === "number" ? { statusCode } : {}),
          updatedAt: Date.now()
        };
      });
    },
    []
  );

  const clearRuntimeAlert = useCallback((): void => {
    setRuntimeAlert(undefined);
  }, []);

  useEffect(() => {
    const level: UiStatusBadgeLevel =
      runtimeAlert?.level === "error"
        ? "error"
        : runtimeAlert?.level === "warn"
          ? "warn"
          : "clear";

    void chrome.runtime
      .sendMessage({
        type: "set_status_badge",
        level,
        ...(level !== "clear" ? { text: "!" } : {})
      } satisfies UiToExtensionMessage)
      .catch(() => undefined);
  }, [runtimeAlert?.code, runtimeAlert?.level]);

  useEffect(() => {
    if (!runtimeAlert || !activeConnection) {
      setRecentAuditEvents([]);
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      const response = await fetchBridgeJson<BridgeAuditEventsResponse>(
        activeConnection,
        "/audit/events?limit=5"
      ).catch(() => ({ ok: false as const, status: 0 }));

      if (cancelled || !response.ok) {
        return;
      }

      setRecentAuditEvents(response.data.events);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [
    runtimeAlert?.code,
    activeConnection?.id,
    activeConnection?.baseUrl,
    activeConnection?.userId,
    activeConnection?.token
  ]);

  return {
    runtimeAlert,
    recentAuditEvents,
    reportRuntimeAlert,
    clearRuntimeAlert
  };
}
