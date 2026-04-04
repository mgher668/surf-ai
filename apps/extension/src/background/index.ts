import type { ExtensionToUiMessage, QuickAction, SelectionPayload } from "@surf-ai/shared";

const ROOT_MENU = "surf-ai-root";
const MENU_SUMMARY = "surf-ai-summary";
const MENU_TRANSLATE = "surf-ai-translate";
const MENU_READ = "surf-ai-read";

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "open_sidepanel_with_selection") {
    return;
  }

  const payload = message.payload as SelectionPayload;
  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;

  if (!tabId || !windowId) {
    sendResponse({ ok: false, error: "missing_sender_tab" });
    return;
  }

  void openPanelAndSend(tabId, windowId, payload)
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "unknown"
      });
    });

  return true;
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
