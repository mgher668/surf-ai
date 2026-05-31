import { useEffect, useMemo, useState } from "react";
import type {
  BridgeCapabilitiesResponse,
  BridgeChatRequest,
  BridgeConnection,
  BridgeModel,
  BridgeModelsResponse,
  ChatMessage,
  ChatSession
} from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { fetchBridgeJson } from "../api/bridgeApi";
import { normalizeModelList } from "../utils/sidepanel-helpers";

const FALLBACK_ADAPTER_OPTIONS: BridgeModel["adapter"][] = ["mock", "codex", "claude"];
const AUTO_MODEL_ID = "auto";
const AUTO_MODEL_LABEL = "Auto (CLI default)";

type RuntimeAlertReporter = (
  code: "backend_unreachable" | "auth_failed" | "rate_limited" | "bridge_request_failed",
  level: "warn" | "error",
  message: string,
  statusCode?: number
) => void;

interface UseSidepanelModelsOptions {
  activeConnection: BridgeConnection | undefined;
  locale: Locale;
  adapter: BridgeChatRequest["adapter"];
  setAdapter: (adapter: BridgeChatRequest["adapter"]) => void;
  defaultAdapter: BridgeChatRequest["adapter"] | undefined;
  backendDraftSessionId: string;
  activeSessionId: string | undefined;
  sessions: ChatSession[];
  messages: ChatMessage[];
  reportRuntimeAlert: RuntimeAlertReporter;
  clearRuntimeAlert: () => void;
}

interface UseSidepanelModelsResult {
  capabilities: BridgeCapabilitiesResponse | undefined;
  capabilitiesError: string | undefined;
  model: string;
  selectedModel: BridgeModel | undefined;
  availableAdapters: Array<{ adapter: BridgeChatRequest["adapter"]; label: string }>;
  availableModels: BridgeModel[];
  ttsReady: boolean;
  selectModelForAdapter: (adapter: BridgeChatRequest["adapter"], modelId: string) => void;
}

export function useSidepanelModels({
  activeConnection,
  locale,
  adapter,
  setAdapter,
  defaultAdapter,
  backendDraftSessionId,
  activeSessionId,
  sessions,
  messages,
  reportRuntimeAlert,
  clearRuntimeAlert
}: UseSidepanelModelsOptions): UseSidepanelModelsResult {
  const [capabilities, setCapabilities] = useState<BridgeCapabilitiesResponse | undefined>();
  const [capabilitiesError, setCapabilitiesError] = useState<string | undefined>();
  const [models, setModels] = useState<BridgeModel[]>([]);
  const [model, setModel] = useState<string>(AUTO_MODEL_ID);
  const [modelByAdapter, setModelByAdapter] = useState<
    Partial<Record<BridgeChatRequest["adapter"], string>>
  >({});

  const availableAdapters = useMemo(() => {
    const serverAdapters = capabilities?.chat.adapters.filter((item) => item.enabled);
    if (serverAdapters && serverAdapters.length > 0) {
      return serverAdapters.map((item) => ({ adapter: item.adapter, label: item.label }));
    }
    return FALLBACK_ADAPTER_OPTIONS.map((item) => ({ adapter: item, label: item }));
  }, [capabilities]);

  const availableModels = useMemo(() => {
    const items = models.filter((item) => item.adapter === adapter && item.enabled);
    if (items.length === 0) {
      return [
        {
          id: AUTO_MODEL_ID,
          adapter,
          label: AUTO_MODEL_LABEL,
          enabled: true,
          isDefault: true
        } satisfies BridgeModel
      ];
    }
    return [...items].sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return a.isDefault ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  }, [models, adapter]);

  const selectedModel = useMemo(
    () =>
      availableModels.find((item) => item.id === model) ??
      availableModels.find((item) => item.isDefault) ??
      availableModels[0],
    [availableModels, model]
  );

  const ttsReady = useMemo(() => {
    if (!capabilities) {
      return true;
    }
    return capabilities.tts.minimax.enabled && capabilities.tts.minimax.configured;
  }, [capabilities]);

  useEffect(() => {
    void bootstrapCapabilities(activeConnection);
  }, [activeConnection]);

  useEffect(() => {
    void bootstrapModels(activeConnection);
  }, [activeConnection]);

  useEffect(() => {
    const isCurrentAdapterAvailable = availableAdapters.some((item) => item.adapter === adapter);
    if (isCurrentAdapterAvailable) {
      return;
    }

    const preferredAdapter = defaultAdapter ?? capabilities?.chat.defaultAdapter;
    if (preferredAdapter && availableAdapters.some((item) => item.adapter === preferredAdapter)) {
      setAdapter(preferredAdapter);
      return;
    }

    if (availableAdapters[0]) {
      setAdapter(availableAdapters[0].adapter);
    }
  }, [adapter, availableAdapters, capabilities, defaultAdapter, setAdapter]);

  useEffect(() => {
    const hasCurrentModel = availableModels.some((item) => item.id === model);
    if (hasCurrentModel) {
      return;
    }

    const preferredByAdapter = modelByAdapter[adapter];
    if (preferredByAdapter && availableModels.some((item) => item.id === preferredByAdapter)) {
      setModel(preferredByAdapter);
      return;
    }

    const defaultModel = availableModels.find((item) => item.isDefault) ?? availableModels[0];
    setModel(defaultModel?.id ?? AUTO_MODEL_ID);
  }, [adapter, availableModels, model, modelByAdapter]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === backendDraftSessionId) {
      return;
    }
    const activeSession = sessions.find((item) => item.id === activeSessionId);
    const lastAdapter = activeSession?.lastAdapter;
    if (!lastAdapter) {
      return;
    }
    if (!availableAdapters.some((item) => item.adapter === lastAdapter)) {
      return;
    }
    if (adapter === lastAdapter) {
      return;
    }
    setAdapter(lastAdapter);
  }, [activeSessionId, backendDraftSessionId, sessions, availableAdapters, adapter, setAdapter]);

  useEffect(() => {
    const latestByAdapter = new Map<BridgeChatRequest["adapter"], string>();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const item = messages[index];
      if (!item?.adapter || !item.model) {
        continue;
      }
      if (latestByAdapter.has(item.adapter)) {
        continue;
      }
      latestByAdapter.set(item.adapter, item.model);
    }

    if (latestByAdapter.size === 0) {
      return;
    }

    setModelByAdapter((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [adapterItem, modelId] of latestByAdapter.entries()) {
        if (next[adapterItem] === modelId) {
          continue;
        }
        next[adapterItem] = modelId;
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [messages]);

  function selectModelForAdapter(
    nextAdapter: BridgeChatRequest["adapter"],
    modelId: string
  ): void {
    setModel(modelId);
    setModelByAdapter((prev) => ({
      ...prev,
      [nextAdapter]: modelId
    }));
  }

  async function bootstrapCapabilities(connection: BridgeConnection | undefined): Promise<void> {
    if (!connection) {
      setCapabilities(undefined);
      setCapabilitiesError(undefined);
      return;
    }

    try {
      const capabilityResponse = await fetchBridgeJson<BridgeCapabilitiesResponse>(
        connection,
        "/capabilities"
      );
      if (capabilityResponse.ok) {
        setCapabilities(capabilityResponse.data);
        setCapabilitiesError(undefined);
        clearRuntimeAlert();
        return;
      }

      if (capabilityResponse.status === 401 || capabilityResponse.status === 403) {
        reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), capabilityResponse.status);
      } else if (capabilityResponse.status === 429) {
        reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), capabilityResponse.status);
      } else {
        reportRuntimeAlert(
          "bridge_request_failed",
          "warn",
          `${t(locale, "alertBridgeRequestFailed")} (${capabilityResponse.status})`,
          capabilityResponse.status
        );
      }

      if (capabilityResponse.status !== 404) {
        throw new Error(`capabilities_request_failed:${capabilityResponse.status}`);
      }

      const modelsResponse = await fetchBridgeJson<BridgeModelsResponse>(connection, "/models");
      if (!modelsResponse.ok) {
        throw new Error(`models_request_failed:${modelsResponse.status}`);
      }

      const adapterSet = new Set<BridgeChatRequest["adapter"]>(
        modelsResponse.data.models.map((item) => item.adapter)
      );
      const adapters = FALLBACK_ADAPTER_OPTIONS.filter((item) => adapterSet.has(item)).map((item) => ({
        adapter: item,
        label: item,
        kind: "native" as const,
        enabled: true
      }));

      setCapabilities({
        version: "legacy",
        now: new Date().toISOString(),
        chat: {
          adapters,
          defaultAdapter: adapters[0]?.adapter === "codex" || adapters[0]?.adapter === "claude"
            ? adapters[0].adapter
            : "mock",
          supportsModelOverride: false
        },
        tts: {
          minimax: {
            enabled: true,
            configured: true
          }
        },
        tools: []
      });
      setCapabilitiesError(undefined);
      clearRuntimeAlert();
    } catch (error) {
      setCapabilities(undefined);
      setCapabilitiesError(error instanceof Error ? error.message : "capabilities_unavailable");
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
    }
  }

  async function bootstrapModels(connection: BridgeConnection | undefined): Promise<void> {
    if (!connection) {
      setModels([]);
      setModel(AUTO_MODEL_ID);
      return;
    }

    try {
      const modelsResponse = await fetchBridgeJson<BridgeModelsResponse>(connection, "/models");
      if (!modelsResponse.ok) {
        if (modelsResponse.status === 401 || modelsResponse.status === 403) {
          reportRuntimeAlert("auth_failed", "error", t(locale, "alertAuthFailed"), modelsResponse.status);
        } else if (modelsResponse.status === 429) {
          reportRuntimeAlert("rate_limited", "warn", t(locale, "alertRateLimited"), modelsResponse.status);
        } else {
          reportRuntimeAlert(
            "bridge_request_failed",
            "warn",
            `${t(locale, "alertBridgeRequestFailed")} (${modelsResponse.status})`,
            modelsResponse.status
          );
        }
        setModels([]);
        return;
      }

      setModels(normalizeModelList(modelsResponse.data.models));
    } catch {
      reportRuntimeAlert("backend_unreachable", "error", t(locale, "alertBackendUnreachable"));
      setModels([]);
    }
  }

  return {
    capabilities,
    capabilitiesError,
    model,
    selectedModel,
    availableAdapters,
    availableModels,
    ttsReady,
    selectModelForAdapter
  };
}
