import type { BridgeAdapter, BridgeConnection, BridgeModel, CodexReasoningEffort } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { ModelsEditableTable } from "./ModelsEditableTable";

interface ModelsSectionProps {
  locale: Locale;
  activeConnection: BridgeConnection | undefined;
  adapters: BridgeAdapter[];
  models: BridgeModel[];
  modelsDirty: boolean;
  modelsFeedback: string | undefined;
  draftModelIdByAdapter: Partial<Record<BridgeAdapter, string>>;
  draftModelLabelByAdapter: Partial<Record<BridgeAdapter, string>>;
  onDraftModelIdChange: (adapter: BridgeAdapter, value: string) => void;
  onDraftModelLabelChange: (adapter: BridgeAdapter, value: string) => void;
  onAddModel: (adapter: BridgeAdapter) => void;
  onEditModel: (
    adapter: BridgeAdapter,
    currentId: string,
    patch: { id?: string; label?: string }
  ) => void;
  onSetDefaultModel: (adapter: BridgeAdapter, modelId: string) => void;
  onToggleModelEnabled: (adapter: BridgeAdapter, modelId: string) => void;
  onUpdateModelReasoningEffort: (
    adapter: BridgeAdapter,
    modelId: string,
    effort: CodexReasoningEffort | undefined
  ) => void;
  onRemoveModel: (adapter: BridgeAdapter, modelId: string) => void;
  onSaveModels: () => void;
}

export function ModelsSection({
  locale,
  activeConnection,
  adapters,
  models,
  modelsDirty,
  modelsFeedback,
  draftModelIdByAdapter,
  draftModelLabelByAdapter,
  onDraftModelIdChange,
  onDraftModelLabelChange,
  onAddModel,
  onEditModel,
  onSetDefaultModel,
  onToggleModelEnabled,
  onUpdateModelReasoningEffort,
  onRemoveModel,
  onSaveModels
}: ModelsSectionProps): JSX.Element {
  return (
    <section className="surf-settings-card">
      <div className="grid gap-1">
        <h2 className="surf-settings-section-title">{t(locale, "modelsTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t(locale, "modelsDescription")}</p>
      </div>

      {!activeConnection ? (
        <p className="text-xs text-muted-foreground">{t(locale, "noConnection")}</p>
      ) : (
        <ModelsEditableTable
          locale={locale}
          adapters={adapters}
          models={models}
          modelsDirty={modelsDirty}
          modelsFeedback={modelsFeedback}
          draftModelIdByAdapter={draftModelIdByAdapter}
          draftModelLabelByAdapter={draftModelLabelByAdapter}
          onDraftModelIdChange={onDraftModelIdChange}
          onDraftModelLabelChange={onDraftModelLabelChange}
          onAddModel={onAddModel}
          onEditModel={onEditModel}
          onSetDefaultModel={onSetDefaultModel}
          onToggleModelEnabled={onToggleModelEnabled}
          onUpdateModelReasoningEffort={onUpdateModelReasoningEffort}
          onRemoveModel={onRemoveModel}
          onSaveModels={onSaveModels}
        />
      )}
    </section>
  );
}
