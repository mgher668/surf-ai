export type Locale = "zh-CN" | "en-US";

const dictionary = {
  "zh-CN": {
    appTitle: "Surf AI",
    openSidePanel: "打开侧边栏",
    connection: "连接",
    noConnection: "未连接",
    addConnection: "添加连接",
    connectionName: "名称",
    connectionUserId: "用户ID",
    baseUrl: "Base URL",
    token: "令牌（可选）",
    sessions: "会话",
    newSession: "新会话",
    send: "发送",
    placeholder: "输入你的问题，或使用网页选区触发",
    adapter: "适配器",
    model: "模型",
    favorite: "收藏",
    unfavorite: "取消收藏",
    moreActions: "更多操作",
    renameSession: "重命名",
    renameSessionPrompt: "输入新的会话名称",
    renameSessionDescription: "修改会话标题，不影响消息内容。",
    renameSessionFailed: "会话重命名失败",
    renameSessionEmpty: "会话名称不能为空",
    renameSessionTooLong: "会话名称最多 120 个字符",
    deleteSession: "删除",
    deleteSessionConfirm: "确认删除该会话？此操作不可恢复。",
    cancel: "取消",
    save: "保存",
    empty: "暂无消息",
    extractPage: "提取当前页",
    extractingPage: "提取中...",
    pageContextReady: "已附加页面全文上下文",
    includePageContext: "发送时附带页面全文",
    alertBackendUnreachable: "后端不可达，请检查 bridge 是否已启动",
    alertAuthFailed: "鉴权失败，请检查 User ID 或 Token",
    alertRateLimited: "请求过于频繁，请稍后重试",
    alertBridgeRequestFailed: "后端请求失败",
    recentAuditEvents: "最近安全事件"
  },
  "en-US": {
    appTitle: "Surf AI",
    openSidePanel: "Open Side Panel",
    connection: "Connection",
    noConnection: "Not connected",
    addConnection: "Add Connection",
    connectionName: "Name",
    connectionUserId: "User ID",
    baseUrl: "Base URL",
    token: "Token (optional)",
    sessions: "Sessions",
    newSession: "New Session",
    send: "Send",
    placeholder: "Ask anything or use selected text from webpage",
    adapter: "Adapter",
    model: "Model",
    favorite: "Favorite",
    unfavorite: "Unfavorite",
    moreActions: "More actions",
    renameSession: "Rename",
    renameSessionPrompt: "Enter a new session title",
    renameSessionDescription: "Update the session title without changing message history.",
    renameSessionFailed: "Failed to rename session",
    renameSessionEmpty: "Session title is required",
    renameSessionTooLong: "Session title must be at most 120 characters",
    deleteSession: "Delete",
    deleteSessionConfirm: "Delete this session? This action cannot be undone.",
    cancel: "Cancel",
    save: "Save",
    empty: "No messages yet",
    extractPage: "Extract Page",
    extractingPage: "Extracting...",
    pageContextReady: "Page full-text context attached",
    includePageContext: "Include full page text on send",
    alertBackendUnreachable: "Bridge is unreachable. Check whether the backend is running.",
    alertAuthFailed: "Authentication failed. Check User ID or token.",
    alertRateLimited: "Rate limited. Please retry later.",
    alertBridgeRequestFailed: "Bridge request failed",
    recentAuditEvents: "Recent security events"
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
