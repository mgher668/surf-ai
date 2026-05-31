import type {
  BridgeConnection,
  BridgeRunApproval,
  BridgeRunStreamEvent,
  BridgeSessionRun,
  BridgeSessionRunApprovalsResponse,
  BridgeSessionRunEventsResponse,
  BridgeSessionRunsResponse
} from "@surf-ai/shared";
import { buildBridgeHeaders } from "../utils/sidepanel-helpers";

export async function fetchLatestSessionRun(
  connection: BridgeConnection,
  sessionId: string
): Promise<BridgeSessionRun | null> {
  const response = await fetchBridgeJson<BridgeSessionRunsResponse>(
    connection,
    `/sessions/${sessionId}/runs?limit=1`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.runs[0] ?? null;
}

export async function fetchSessionRunsFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  limit = 50
): Promise<BridgeSessionRun[] | null> {
  const response = await fetchBridgeJson<BridgeSessionRunsResponse>(
    connection,
    `/sessions/${sessionId}/runs?limit=${limit}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.runs;
}

export async function fetchRunApprovalsFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  runId: string,
  status: "pending" | "all" = "all"
): Promise<BridgeRunApproval[] | null> {
  const response = await fetchBridgeJson<BridgeSessionRunApprovalsResponse>(
    connection,
    `/sessions/${sessionId}/runs/${runId}/approvals?status=${status}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.approvals;
}

export async function fetchRunEventsFromBackend(
  connection: BridgeConnection,
  sessionId: string,
  runId: string,
  limit = 2000
): Promise<BridgeRunStreamEvent[] | null> {
  const response = await fetchBridgeJson<BridgeSessionRunEventsResponse>(
    connection,
    `/sessions/${sessionId}/runs/${runId}/events?limit=${limit}`
  ).catch(() => ({ ok: false as const, status: 0 }));
  if (!response.ok) {
    return null;
  }
  return response.data.events;
}

export async function fetchBridgeJson<T>(
  connection: BridgeConnection,
  path: string
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await fetch(`${connection.baseUrl}${path}`, {
    headers: buildBridgeHeaders(connection),
    cache: "no-store"
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
}
