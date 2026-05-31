import { useEffect, useState } from "react";
import type {
  BridgeAdapter,
  BridgeConnection,
  BridgeModel,
  BridgeModelsResponse,
  BridgeModelsUpdateRequest,
  CodexReasoningEffort
} from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { buildBridgeHeaders, normalizeModelList } from "../utils/bridgeApi";

const AUTO_MODEL_ID = "auto";

interface UseSettingsModelsOptions {
  activeConnection: BridgeConnection | undefined;
  locale: Locale;
}

export function useSettingsModels({
  activeConnection,
  locale
}: UseSettingsModelsOptions): {
  models: BridgeModel[];
  modelsDirty: boolean;
  modelsFeedback: string | undefined;
  draftModelIdByAdapter: Partial<Record<BridgeAdapter, string>>;
  draftModelLabelByAdapter: Partial<Record<BridgeAdapter, string>>;
  updateDraftModelId: (adapter: BridgeAdapter, value: string) => void;
  updateDraftModelLabel: (adapter: BridgeAdapter, value: string) => void;
  addModel: (adapter: BridgeAdapter) => void;
  editModel: (
    adapter: BridgeAdapter,
    currentId: string,
    patch: { id?: string; label?: string }
  ) => void;
  setDefaultModel: (adapter: BridgeAdapter, modelId: string) => void;
  toggleModelEnabled: (adapter: BridgeAdapter, modelId: string) => void;
  updateModelReasoningEffort: (
    adapter: BridgeAdapter,
    modelId: string,
    effort: CodexReasoningEffort | undefined
  ) => void;
  removeModel: (adapter: BridgeAdapter, modelId: string) => void;
  saveModelsToBackend: () => Promise<void>;
} {
  const [models, setModelsState] = useState<BridgeModel[]>([]);
  const [modelsDirty, setModelsDirty] = useState(false);
  const [modelsFeedback, setModelsFeedback] = useState<string | undefined>();
  const [draftModelIdByAdapter, setDraftModelIdByAdapter] = useState<
    Partial<Record<BridgeAdapter, string>>
  >({});
  const [draftModelLabelByAdapter, setDraftModelLabelByAdapter] = useState<
    Partial<Record<BridgeAdapter, string>>
  >({});

  useEffect(() => {
    void loadModels(activeConnection);
  }, [activeConnection?.id, activeConnection?.baseUrl, activeConnection?.userId, activeConnection?.token]);

  async function loadModels(connection: BridgeConnection | undefined): Promise<void> {
    if (!connection) {
      setModelsState([]);
      setModelsDirty(false);
      setModelsFeedback(undefined);
      return;
    }

    try {
      const response = await fetch(`${connection.baseUrl}/models`, {
        method: "GET",
        headers: buildBridgeHeaders(connection)
      });
      if (!response.ok) {
        setModelsFeedback(`${t(locale, "modelsLoadFailed")} (${response.status})`);
        return;
      }
      const payload = (await response.json()) as BridgeModelsResponse;
      setModelsState(normalizeModelList(payload.models));
      setModelsDirty(false);
      setModelsFeedback(undefined);
    } catch {
      setModelsFeedback(t(locale, "modelsLoadFailed"));
    }
  }

  function updateModels(mutator: (previous: BridgeModel[]) => BridgeModel[]): void {
    setModelsState((previous) => {
      const next = normalizeModelList(mutator(previous));
      setModelsDirty(true);
      setModelsFeedback(undefined);
      return next;
    });
  }

  function setDefaultModel(adapter: BridgeAdapter, modelId: string): void {
    updateModels((previous) =>
      previous.map((item) => {
        if (item.adapter !== adapter) {
          return item;
        }
        return {
          ...item,
          isDefault: item.id === modelId,
          enabled: item.id === modelId ? true : item.enabled
        };
      })
    );
  }

  function updateModelReasoningEffort(
    adapter: BridgeAdapter,
    modelId: string,
    effort: CodexReasoningEffort | undefined
  ): void {
    if (adapter !== "codex") {
      return;
    }

    updateModels((previous) =>
      previous.map((item) => {
        if (item.adapter !== adapter || item.id !== modelId) {
          return item;
        }
        if (!effort) {
          const { modelReasoningEffort: _unused, ...rest } = item;
          return rest;
        }
        return {
          ...item,
          modelReasoningEffort: effort
        };
      })
    );
  }

  function toggleModelEnabled(adapter: BridgeAdapter, modelId: string): void {
    updateModels((previous) => {
      const target = previous.find((item) => item.adapter === adapter && item.id === modelId);
      if (!target) {
        return previous;
      }
      const nextEnabled = !target.enabled;
      const next = previous.map((item) => {
        if (item.adapter !== adapter || item.id !== modelId) {
          return item;
        }
        return {
          ...item,
          enabled: nextEnabled,
          isDefault: nextEnabled ? item.isDefault : false
        };
      });

      const enabledModels = next.filter((item) => item.adapter === adapter && item.enabled);
      if (enabledModels.length === 0) {
        return next.map((item) => {
          if (item.adapter !== adapter || item.id !== modelId) {
            return item;
          }
          return {
            ...item,
            enabled: true,
            isDefault: true
          };
        });
      }

      const hasDefault = enabledModels.some((item) => item.isDefault);
      if (hasDefault) {
        return next;
      }

      const fallbackDefaultId = enabledModels[0]?.id;
      if (!fallbackDefaultId) {
        return next;
      }
      return next.map((item) => {
        if (item.adapter !== adapter) {
          return item;
        }
        return {
          ...item,
          isDefault: item.id === fallbackDefaultId
        };
      });
    });
  }

  function removeModel(adapter: BridgeAdapter, modelId: string): void {
    updateModels((previous) => {
      const next = previous.filter((item) => !(item.adapter === adapter && item.id === modelId));
      const adapterModels = next.filter((item) => item.adapter === adapter);
      if (adapterModels.length === 0) {
        next.push({
          id: AUTO_MODEL_ID,
          label: "Auto (CLI default)",
          adapter,
          enabled: true,
          isDefault: true
        });
        return next;
      }
      if (adapterModels.some((item) => item.isDefault && item.enabled)) {
        return next;
      }
      const fallbackDefaultId = adapterModels.find((item) => item.enabled)?.id ?? adapterModels[0]?.id;
      if (!fallbackDefaultId) {
        return next;
      }
      return next.map((item) => {
        if (item.adapter !== adapter) {
          return item;
        }
        return {
          ...item,
          enabled: item.id === fallbackDefaultId ? true : item.enabled,
          isDefault: item.id === fallbackDefaultId
        };
      });
    });
  }

  function addModel(adapter: BridgeAdapter): void {
    const id = draftModelIdByAdapter[adapter]?.trim() ?? "";
    const label = draftModelLabelByAdapter[adapter]?.trim() ?? "";
    if (!id) {
      return;
    }

    updateModels((previous) => {
      if (previous.some((item) => item.adapter === adapter && item.id === id)) {
        return previous;
      }

      const hasDefault = previous.some((item) => item.adapter === adapter && item.isDefault && item.enabled);
      return [
        ...previous,
        {
          id,
          label: label || id,
          adapter,
          enabled: true,
          isDefault: !hasDefault
        }
      ];
    });

    setDraftModelIdByAdapter((previous) => ({ ...previous, [adapter]: "" }));
    setDraftModelLabelByAdapter((previous) => ({ ...previous, [adapter]: "" }));
  }

  function editModel(
    adapter: BridgeAdapter,
    currentId: string,
    patch: { id?: string; label?: string }
  ): void {
    const nextId = typeof patch.id === "string" ? patch.id.trim() : undefined;
    const nextLabel = typeof patch.label === "string" ? patch.label.trim() : undefined;
    if (nextId !== undefined && !nextId) {
      return;
    }

    updateModels((previous) => {
      const target = previous.find((item) => item.adapter === adapter && item.id === currentId);
      if (!target) {
        return previous;
      }

      const resolvedId = nextId ?? target.id;
      const resolvedLabel = nextLabel ?? target.label;
      if (!resolvedId) {
        return previous;
      }

      const duplicated = previous.some(
        (item) => item.adapter === adapter && item.id === resolvedId && item.id !== currentId
      );
      if (duplicated) {
        return previous;
      }

      return previous.map((item) => {
        if (item.adapter !== adapter || item.id !== currentId) {
          return item;
        }
        return {
          ...item,
          id: resolvedId,
          label: resolvedLabel || resolvedId
        };
      });
    });
  }

  async function saveModelsToBackend(): Promise<void> {
    if (!activeConnection) {
      return;
    }

    try {
      const payload: BridgeModelsUpdateRequest = {
        models: normalizeModelList(models)
      };
      const response = await fetch(`${activeConnection.baseUrl}/models`, {
        method: "PUT",
        headers: buildBridgeHeaders(activeConnection, true),
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        setModelsFeedback(`${t(locale, "modelsSaveFailed")} (${response.status})`);
        return;
      }
      const updated = (await response.json()) as BridgeModelsResponse;
      setModelsState(normalizeModelList(updated.models));
      setModelsDirty(false);
      setModelsFeedback(t(locale, "modelsSaved"));
    } catch {
      setModelsFeedback(t(locale, "modelsSaveFailed"));
    }
  }

  function updateDraftModelId(adapter: BridgeAdapter, value: string): void {
    setDraftModelIdByAdapter((previous) => ({ ...previous, [adapter]: value }));
  }

  function updateDraftModelLabel(adapter: BridgeAdapter, value: string): void {
    setDraftModelLabelByAdapter((previous) => ({ ...previous, [adapter]: value }));
  }

  return {
    models,
    modelsDirty,
    modelsFeedback,
    draftModelIdByAdapter,
    draftModelLabelByAdapter,
    updateDraftModelId,
    updateDraftModelLabel,
    addModel,
    editModel,
    setDefaultModel,
    toggleModelEnabled,
    updateModelReasoningEffort,
    removeModel,
    saveModelsToBackend
  };
}
