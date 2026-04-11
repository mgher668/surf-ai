import { useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react/dist/offline";
import dotsVertical from "@iconify-icons/mdi/dots-vertical";
import type { BridgeAdapter, BridgeModel, CodexReasoningEffort } from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";

const CODEX_REASONING_EFFORT_OPTIONS: Array<{
  value: CodexReasoningEffort;
  i18nKey:
    | "reasoningEffortMinimal"
    | "reasoningEffortLow"
    | "reasoningEffortMedium"
    | "reasoningEffortHigh"
    | "reasoningEffortXhigh";
}> = [
  { value: "minimal", i18nKey: "reasoningEffortMinimal" },
  { value: "low", i18nKey: "reasoningEffortLow" },
  { value: "medium", i18nKey: "reasoningEffortMedium" },
  { value: "high", i18nKey: "reasoningEffortHigh" },
  { value: "xhigh", i18nKey: "reasoningEffortXhigh" }
];

interface ModelsEditableTableProps {
  locale: Locale;
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

interface AdapterModelsTableSectionProps {
  locale: Locale;
  adapter: BridgeAdapter;
  models: BridgeModel[];
  draftModelId: string;
  draftModelLabel: string;
  onDraftModelIdChange: (value: string) => void;
  onDraftModelLabelChange: (value: string) => void;
  onAddModel: () => void;
  onEditModel: (currentId: string, patch: { id?: string; label?: string }) => void;
  onSetDefaultModel: (modelId: string) => void;
  onToggleModelEnabled: (modelId: string) => void;
  onUpdateModelReasoningEffort: (modelId: string, effort: CodexReasoningEffort | undefined) => void;
  onRemoveModel: (modelId: string) => void;
}

export function ModelsEditableTable({
  locale,
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
}: ModelsEditableTableProps): JSX.Element {
  const [activeAdapter, setActiveAdapter] = useState<BridgeAdapter | undefined>(adapters[0]);

  useEffect(() => {
    if (!activeAdapter || !adapters.includes(activeAdapter)) {
      setActiveAdapter(adapters[0]);
    }
  }, [adapters, activeAdapter]);

  const activeAdapterValue = activeAdapter ?? adapters[0];
  const modelsByAdapter = useMemo(() => {
    const result = new Map<BridgeAdapter, BridgeModel[]>();
    for (const adapter of adapters) {
      result.set(adapter, getModelsForAdapter(models, adapter));
    }
    return result;
  }, [adapters, models]);

  if (!activeAdapterValue) {
    return (
      <div className="grid gap-2">
        <div className="text-xs text-muted-foreground">{t(locale, "empty")}</div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Tabs
        value={activeAdapterValue}
        onValueChange={(value) => setActiveAdapter(value as BridgeAdapter)}
        className="grid gap-2"
      >
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-md p-1">
          {adapters.map((adapter) => (
            <TabsTrigger key={adapter} value={adapter} className="uppercase">
              {adapter}
            </TabsTrigger>
          ))}
        </TabsList>

        {adapters.map((adapter) => (
          <TabsContent key={adapter} value={adapter} className="mt-2">
            <AdapterModelsTableSection
              locale={locale}
              adapter={adapter}
              models={modelsByAdapter.get(adapter) ?? []}
              draftModelId={draftModelIdByAdapter[adapter] ?? ""}
              draftModelLabel={draftModelLabelByAdapter[adapter] ?? ""}
              onDraftModelIdChange={(value) => onDraftModelIdChange(adapter, value)}
              onDraftModelLabelChange={(value) => onDraftModelLabelChange(adapter, value)}
              onAddModel={() => onAddModel(adapter)}
              onEditModel={(currentId, patch) => onEditModel(adapter, currentId, patch)}
              onSetDefaultModel={(modelId) => onSetDefaultModel(adapter, modelId)}
              onToggleModelEnabled={(modelId) => onToggleModelEnabled(adapter, modelId)}
              onUpdateModelReasoningEffort={(modelId, effort) =>
                onUpdateModelReasoningEffort(adapter, modelId, effort)
              }
              onRemoveModel={(modelId) => onRemoveModel(adapter, modelId)}
            />
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={onSaveModels} disabled={!modelsDirty}>
          {t(locale, "saveModels")}
        </Button>
        {modelsFeedback ? <span className="text-xs text-muted-foreground">{modelsFeedback}</span> : null}
      </div>
    </div>
  );
}

function AdapterModelsTableSection({
  locale,
  adapter,
  models,
  draftModelId,
  draftModelLabel,
  onDraftModelIdChange,
  onDraftModelLabelChange,
  onAddModel,
  onEditModel,
  onSetDefaultModel,
  onToggleModelEnabled,
  onUpdateModelReasoningEffort,
  onRemoveModel
}: AdapterModelsTableSectionProps): JSX.Element {
  return (
    <section className="grid gap-3 rounded-lg border border-border p-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[680px] border-collapse text-xs">
          <thead>
            <tr className="bg-muted/40 text-muted-foreground">
              <th className="border-b border-border px-3 py-2 text-left font-medium">{t(locale, "modelId")}</th>
              <th className="border-b border-border px-3 py-2 text-left font-medium">{t(locale, "modelLabel")}</th>
              <th className="border-b border-border px-3 py-2 text-left font-medium">
                {t(locale, "codexReasoningEffort")}
              </th>
              <th className="w-[104px] border-b border-border px-3 py-2 text-right font-medium">
                {t(locale, "moreActions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {models.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-muted-foreground">
                  {t(locale, "empty")}
                </td>
              </tr>
            ) : (
              models.map((item, index) => (
                <tr key={`${item.adapter}:${item.id}:${index}`} className="align-top">
                  <td className="border-b border-border px-3 py-2">
                    <Input
                      defaultValue={item.id}
                      placeholder={t(locale, "modelId")}
                      className="h-8"
                      onBlur={(event) => onEditModel(item.id, { id: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    <Input
                      defaultValue={item.label}
                      placeholder={t(locale, "modelLabel")}
                      className="h-8"
                      onBlur={(event) => onEditModel(item.id, { label: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.currentTarget.blur();
                        }
                      }}
                    />
                  </td>
                  <td className="border-b border-border px-3 py-2">
                    {adapter === "codex" ? (
                      <Select
                        value={item.modelReasoningEffort ?? "default"}
                        onValueChange={(value) =>
                          onUpdateModelReasoningEffort(
                            item.id,
                            value === "default" ? undefined : (value as CodexReasoningEffort)
                          )
                        }
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder={t(locale, "codexReasoningEffort")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">{t(locale, "reasoningEffortDefault")}</SelectItem>
                          {CODEX_REASONING_EFFORT_OPTIONS.map((effort) => (
                            <SelectItem key={effort.value} value={effort.value}>
                              {t(locale, effort.i18nKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </td>
                  <td className="border-b border-border px-3 py-2 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                          aria-label={t(locale, "moreActions")}
                        >
                          <Icon icon={dotsVertical} width={16} height={16} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[156px]">
                        <DropdownMenuItem
                          onSelect={() => onSetDefaultModel(item.id)}
                          disabled={item.isDefault}
                        >
                          {t(locale, "modelSetDefault")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onToggleModelEnabled(item.id)}>
                          {item.enabled ? t(locale, "modelDisable") : t(locale, "modelEnable")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => onRemoveModel(item.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          {t(locale, "modelDelete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          placeholder={t(locale, "modelId")}
          value={draftModelId}
          onChange={(event) => onDraftModelIdChange(event.target.value)}
        />
        <Input
          placeholder={t(locale, "modelLabel")}
          value={draftModelLabel}
          onChange={(event) => onDraftModelLabelChange(event.target.value)}
        />
        <Button type="button" onClick={onAddModel}>
          {t(locale, "addModel")}
        </Button>
      </div>
    </section>
  );
}

function getModelsForAdapter(models: BridgeModel[], adapter: BridgeAdapter): BridgeModel[] {
  const filtered = models.filter((item) => item.adapter === adapter);
  return [...filtered].sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
}
