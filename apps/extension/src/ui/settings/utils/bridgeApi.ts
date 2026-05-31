import type { BridgeConnection, BridgeModel } from "@surf-ai/shared";

export function buildBridgeHeaders(
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

export function normalizeModelList(models: BridgeModel[]): BridgeModel[] {
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
