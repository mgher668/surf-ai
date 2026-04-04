export type Locale = "zh-CN" | "en-US";

const dictionary = {
  "zh-CN": {
    appTitle: "Surf AI",
    openSidePanel: "打开侧边栏",
    connection: "连接",
    noConnection: "未连接",
    addConnection: "添加连接",
    connectionName: "名称",
    baseUrl: "Base URL",
    token: "令牌（可选）",
    sessions: "会话",
    newSession: "新会话",
    send: "发送",
    placeholder: "输入你的问题，或使用网页选区触发",
    adapter: "适配器",
    model: "模型",
    favorite: "收藏",
    empty: "暂无消息"
  },
  "en-US": {
    appTitle: "Surf AI",
    openSidePanel: "Open Side Panel",
    connection: "Connection",
    noConnection: "Not connected",
    addConnection: "Add Connection",
    connectionName: "Name",
    baseUrl: "Base URL",
    token: "Token (optional)",
    sessions: "Sessions",
    newSession: "New Session",
    send: "Send",
    placeholder: "Ask anything or use selected text from webpage",
    adapter: "Adapter",
    model: "Model",
    favorite: "Favorite",
    empty: "No messages yet"
  }
} as const;

export type I18nKey = keyof typeof dictionary["zh-CN"];

export function resolveLocale(raw?: string): Locale {
  if (!raw) return "en-US";
  if (raw.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

export function t(locale: Locale, key: I18nKey): string {
  return dictionary[locale][key];
}
