import type {
  QuickAction,
  SelectionPayload,
  UiToExtensionMessage,
  UiToExtensionResponse
} from "@surf-ai/shared";
import { extractCurrentPageContent } from "./extract";
import "./styles.css";

const HANDLE_CLASS = "surf-ai-selection-handle";
const MENU_CLASS = "surf-ai-selection-menu";
const HANDLE_SIZE = 30;

let handleEl: HTMLDivElement | null = null;
let menuEl: HTMLDivElement | null = null;
let menuStatusEl: HTMLDivElement | null = null;
let menuStatusTimer: number | undefined;
let selectedText = "";

function cleanup(): void {
  handleEl?.remove();
  menuEl?.remove();
  handleEl = null;
  menuEl = null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createHandle(options: { point?: { clientX: number; clientY: number }; rangeRect: DOMRect }): void {
  cleanup();

  handleEl = document.createElement("div");
  handleEl.className = HANDLE_CLASS;
  handleEl.textContent = "AI";
  if (options.point) {
    const clampedClientX = clamp(options.point.clientX, 0, window.innerWidth);
    const clampedClientY = clamp(options.point.clientY, 0, window.innerHeight);
    const leftInViewport = clamp(
      clampedClientX - HANDLE_SIZE / 2,
      0,
      Math.max(0, window.innerWidth - HANDLE_SIZE)
    );
    const topInViewport = clamp(
      clampedClientY - HANDLE_SIZE / 2,
      0,
      Math.max(0, window.innerHeight - HANDLE_SIZE)
    );
    handleEl.style.left = `${window.scrollX + leftInViewport}px`;
    handleEl.style.top = `${window.scrollY + topInViewport}px`;
  } else {
    handleEl.style.left = `${window.scrollX + options.rangeRect.right + 8}px`;
    handleEl.style.top = `${window.scrollY + options.rangeRect.top - 8}px`;
  }

  handleEl.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu();
  });

  document.body.appendChild(handleEl);
}

function toggleMenu(): void {
  if (!handleEl) return;

  if (menuEl) {
    menuEl.remove();
    menuEl = null;
    return;
  }

  menuEl = document.createElement("div");
  menuEl.className = MENU_CLASS;

  menuEl.appendChild(createActionButton("Summarize", "summarize"));
  menuEl.appendChild(createActionButton("Translate", "translate"));
  menuEl.appendChild(createActionButton("Read", "read_aloud"));

  const rect = handleEl.getBoundingClientRect();
  menuEl.style.left = `${window.scrollX + rect.left}px`;
  menuEl.style.top = `${window.scrollY + rect.bottom + 8}px`;

  document.body.appendChild(menuEl);
}

function showMenuStatus(message: string): void {
  if (!menuEl) {
    return;
  }

  if (!menuStatusEl) {
    menuStatusEl = document.createElement("div");
    menuStatusEl.style.marginTop = "2px";
    menuStatusEl.style.fontSize = "11px";
    menuStatusEl.style.color = "#9f2f2f";
    menuStatusEl.style.lineHeight = "1.3";
    menuEl.appendChild(menuStatusEl);
  }

  menuStatusEl.textContent = message;

  if (menuStatusTimer !== undefined) {
    window.clearTimeout(menuStatusTimer);
  }
  menuStatusTimer = window.setTimeout(() => {
    menuStatusEl?.remove();
    menuStatusEl = null;
  }, 3200);
}

function createActionButton(label: string, action: QuickAction): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const payload: SelectionPayload = {
      action,
      text: selectedText,
      pageTitle: document.title,
      pageUrl: window.location.href,
      createdAt: Date.now()
    };

    const request: UiToExtensionMessage = {
      type: "open_sidepanel_with_selection",
      payload
    };
    const response = (await chrome.runtime.sendMessage(request)) as UiToExtensionResponse;
    if (!response?.ok) {
      showMenuStatus(`Action failed: ${response?.error ?? "unknown_error"}`);
      return;
    }

    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  return button;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const typedMessage = message as UiToExtensionMessage | undefined;
  if (typedMessage?.type !== "extract_active_tab_content") {
    return;
  }

  try {
    const payload = extractCurrentPageContent(typedMessage.maxChars);
    sendResponse({ ok: true, payload } satisfies UiToExtensionResponse);
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "extract_failed"
    } satisfies UiToExtensionResponse);
  }

  return true;
});

function handleSelectionChange(point?: { clientX: number; clientY: number }): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    cleanup();
    return;
  }

  const text = selection.toString().trim();
  selectedText = text.slice(0, 12_000);

  if (!selectedText) {
    cleanup();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    cleanup();
    return;
  }

  createHandle({ rangeRect: rect, ...(point ? { point } : {}) });
}

document.addEventListener("mouseup", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(`.${HANDLE_CLASS}`) || target?.closest(`.${MENU_CLASS}`)) {
    return;
  }
  const point = { clientX: event.clientX, clientY: event.clientY };
  setTimeout(() => {
    handleSelectionChange(point);
  }, 0);
});

document.addEventListener("keyup", (event) => {
  if (event.key === "Shift" || event.key.startsWith("Arrow")) {
    setTimeout(handleSelectionChange, 0);
  }
});

document.addEventListener("scroll", () => {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
});

document.addEventListener("mousedown", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest(`.${HANDLE_CLASS}`) || target?.closest(`.${MENU_CLASS}`)) {
    return;
  }
  cleanup();
});
