import type {
  ExtensionToUiMessage,
  PageContentPayload,
  QuickAction,
  SelectionPayload,
  UiToExtensionMessage,
  UiToExtensionResponse
} from "@surf-ai/shared";

const ROOT_MENU = "surf-ai-root";
const MENU_SUMMARY = "surf-ai-summary";
const MENU_TRANSLATE = "surf-ai-translate";
const MENU_READ = "surf-ai-read";
const EXTRACT_DEFAULT_MAX_CHARS = 60_000;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();

  chrome.contextMenus.create({
    id: ROOT_MENU,
    title: "Surf AI",
    contexts: ["selection", "page"]
  });

  chrome.contextMenus.create({
    id: MENU_SUMMARY,
    parentId: ROOT_MENU,
    title: "Summarize",
    contexts: ["selection", "page"]
  });

  chrome.contextMenus.create({
    id: MENU_TRANSLATE,
    parentId: ROOT_MENU,
    title: "Translate",
    contexts: ["selection", "page"]
  });

  chrome.contextMenus.create({
    id: MENU_READ,
    parentId: ROOT_MENU,
    title: "Read Aloud",
    contexts: ["selection", "page"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab.windowId) return;

  const action = mapMenuIdToAction(info.menuItemId.toString());
  if (!action) return;

  const text = (info.selectionText || "").trim();
  if (!text) return;

  await openPanelAndSend(tab.id, tab.windowId, {
    action,
    text,
    pageTitle: tab.title ?? "",
    pageUrl: tab.url ?? "",
    createdAt: Date.now()
  });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  const targetTab = tab ?? (await getActiveTab());
  if (!targetTab?.id || !targetTab.windowId) return;

  if (command === "open-side-panel") {
    await chrome.sidePanel.open({ windowId: targetTab.windowId });
    return;
  }

  if (command === "quick-summarize") {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: () => window.getSelection()?.toString().trim() ?? ""
    });

    const text = (injected?.result as string | undefined) ?? "";
    if (!text) return;

    await openPanelAndSend(targetTab.id, targetTab.windowId, {
      action: "summarize",
      text,
      pageTitle: targetTab.title ?? "",
      pageUrl: targetTab.url ?? "",
      createdAt: Date.now()
    });
  }
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = rawMessage as UiToExtensionMessage | undefined;
  if (!message) return;

  if (message.type === "open_sidepanel_with_selection") {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    if (!tabId || !windowId) {
      sendResponse({ ok: false, error: "missing_sender_tab" } satisfies UiToExtensionResponse);
      return;
    }

    void openPanelAndSend(tabId, windowId, message.payload)
      .then(() => sendResponse({ ok: true } satisfies UiToExtensionResponse))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "unknown"
        } satisfies UiToExtensionResponse);
      });
    return true;
  }

  if (message.type === "extract_active_tab_content") {
    void handleExtractActiveTab(message.maxChars)
      .then((payload) => {
        sendResponse({ ok: true, payload } satisfies UiToExtensionResponse);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "extract_failed";
        sendResponse({
          ok: false,
          error: message
        } satisfies UiToExtensionResponse);
      });
    return true;
  }
});

function mapMenuIdToAction(menuId: string): QuickAction | null {
  if (menuId === MENU_SUMMARY) return "summarize";
  if (menuId === MENU_TRANSLATE) return "translate";
  if (menuId === MENU_READ) return "read_aloud";
  return null;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function openPanelAndSend(tabId: number, windowId: number, payload: SelectionPayload): Promise<void> {
  await chrome.sidePanel.setOptions({ tabId, enabled: true });
  await chrome.sidePanel.open({ windowId });

  const message: ExtensionToUiMessage = {
    type: "selection_payload",
    payload
  };

  await chrome.runtime.sendMessage(message);
}

async function handleExtractActiveTab(maxChars?: number): Promise<PageContentPayload> {
  const activeTab = await getActiveTab();
  if (!activeTab?.id) {
    throw new Error("active_tab_not_found");
  }

  const payload = await extractPageContentFromTab(activeTab.id, maxChars ?? EXTRACT_DEFAULT_MAX_CHARS);
  return {
    ...payload,
    pageTitle: payload.pageTitle || activeTab.title || "",
    pageUrl: payload.pageUrl || activeTab.url || ""
  };
}

async function extractPageContentFromTab(tabId: number, maxChars: number): Promise<PageContentPayload> {
  try {
    const request: UiToExtensionMessage = {
      type: "extract_active_tab_content",
      maxChars
    };
    const response = (await chrome.tabs.sendMessage(tabId, request)) as UiToExtensionResponse;
    if (response?.ok && response.payload?.text) {
      return response.payload;
    }
  } catch {
    // Continue to executeScript fallback.
  }

  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (requestedMaxChars: number) => {
      const max = Number.isFinite(requestedMaxChars)
        ? Math.min(Math.max(Math.floor(requestedMaxChars), 500), 200_000)
        : 60_000;
      const text = (document.body?.innerText || document.documentElement?.innerText || "")
        .replace(/\r/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
        .slice(0, max);

      return {
        pageTitle: document.title || "",
        pageUrl: window.location.href || "",
        text,
        source: "dom" as const,
        charCount: text.length,
        extractedAt: Date.now()
      };
    },
    args: [maxChars]
  });

  const payload = injected?.result;
  if (!payload?.text) {
    throw new Error("page_content_empty_or_unavailable");
  }
  return payload;
}
