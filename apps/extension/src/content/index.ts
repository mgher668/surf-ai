import type { QuickAction, SelectionPayload } from "@surf-ai/shared";
import "./styles.css";

const HANDLE_CLASS = "surf-ai-selection-handle";
const MENU_CLASS = "surf-ai-selection-menu";

let handleEl: HTMLDivElement | null = null;
let menuEl: HTMLDivElement | null = null;
let selectedText = "";

function cleanup(): void {
  handleEl?.remove();
  menuEl?.remove();
  handleEl = null;
  menuEl = null;
}

function createHandle(rangeRect: DOMRect): void {
  cleanup();

  handleEl = document.createElement("div");
  handleEl.className = HANDLE_CLASS;
  handleEl.textContent = "AI";
  handleEl.style.left = `${window.scrollX + rangeRect.right + 8}px`;
  handleEl.style.top = `${window.scrollY + rangeRect.top - 8}px`;

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

    await chrome.runtime.sendMessage({
      type: "open_sidepanel_with_selection",
      payload
    });

    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  return button;
}

function handleSelectionChange(): void {
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

  createHandle(rect);
}

document.addEventListener("mouseup", () => {
  setTimeout(handleSelectionChange, 0);
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
