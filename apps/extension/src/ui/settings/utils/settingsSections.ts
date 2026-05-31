export const SETTINGS_SECTIONS = ["general", "connections", "models", "memories"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface SettingsSectionItem {
  key: SettingsSection;
  labelKey:
    | "settingsSectionGeneral"
    | "settingsSectionConnections"
    | "settingsSectionModels"
    | "settingsSectionMemories";
  descriptionKey:
    | "settingsSectionGeneralDescription"
    | "settingsSectionConnectionsDescription"
    | "settingsSectionModelsDescription"
    | "settingsSectionMemoriesDescription";
}

export const SETTINGS_SECTION_ITEMS: SettingsSectionItem[] = [
  {
    key: "general",
    labelKey: "settingsSectionGeneral",
    descriptionKey: "settingsSectionGeneralDescription"
  },
  {
    key: "connections",
    labelKey: "settingsSectionConnections",
    descriptionKey: "settingsSectionConnectionsDescription"
  },
  {
    key: "models",
    labelKey: "settingsSectionModels",
    descriptionKey: "settingsSectionModelsDescription"
  },
  {
    key: "memories",
    labelKey: "settingsSectionMemories",
    descriptionKey: "settingsSectionMemoriesDescription"
  }
];

export function resolveSettingsSection(raw: string): SettingsSection | undefined {
  if (SETTINGS_SECTIONS.includes(raw as SettingsSection)) {
    return raw as SettingsSection;
  }
  return undefined;
}
