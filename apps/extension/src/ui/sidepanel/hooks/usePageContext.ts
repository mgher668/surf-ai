import { useState } from "react";
import type {
  PageContentPayload,
  QuickAction,
  SelectionPayload,
  UiToExtensionMessage,
  UiToExtensionResponse
} from "@surf-ai/shared";

const ACTION_PROMPT_PREFIX: Record<QuickAction, string> = {
  summarize: "Please summarize this content:",
  translate: "Please translate this content into Chinese and English:",
  read_aloud: "Please prepare this content for read-aloud:",
  ask: "Please help answer based on this content:"
};

interface UsePageContextOptions {
  input: string;
  setInput: (value: string) => void;
  requestTts: (text: string) => void | Promise<void>;
}

interface UsePageContextResult {
  extractingPage: boolean;
  extractError: string | undefined;
  pageContent: PageContentPayload | undefined;
  includePageContext: boolean;
  selectionContext: SelectionPayload | undefined;
  setIncludePageContext: (include: boolean) => void;
  consumePendingSelectionPayload: () => Promise<void>;
  applySelectionPayload: (payload: SelectionPayload) => void;
  applyPageContentPayload: (payload: PageContentPayload) => void;
  applyPageContentError: (message: string) => void;
  extractCurrentPage: () => Promise<void>;
  clearExtractedPageContent: () => void;
  clearSelectionAndPageContext: () => void;
}

export function usePageContext({
  input,
  setInput,
  requestTts
}: UsePageContextOptions): UsePageContextResult {
  const [extractingPage, setExtractingPage] = useState(false);
  const [extractError, setExtractError] = useState<string | undefined>();
  const [pageContent, setPageContent] = useState<PageContentPayload | undefined>();
  const [includePageContext, setIncludePageContext] = useState(false);
  const [selectionContext, setSelectionContext] = useState<SelectionPayload | undefined>();

  async function consumePendingSelectionPayload(): Promise<void> {
    try {
      const activeTab = await getActiveTab();
      const request: UiToExtensionMessage = {
        type: "consume_pending_selection_payload",
        ...(activeTab?.id ? { tabId: activeTab.id } : {})
      };
      const response = (await chrome.runtime.sendMessage(request)) as UiToExtensionResponse;
      if (response?.ok && response.selectionPayload) {
        applySelectionPayload(response.selectionPayload);
      }
    } catch {
      // Ignore; sidepanel can still receive live runtime messages.
    }
  }

  function applySelectionPayload(payload: SelectionPayload): void {
    const text = `${ACTION_PROMPT_PREFIX[payload.action]}\n\n${payload.text}`;
    setInput(text);
    setSelectionContext(payload);
    setPageContent(undefined);
    setExtractError(undefined);
    setIncludePageContext(false);
    if (payload.action === "read_aloud") {
      void requestTts(payload.text);
    }
  }

  function applyPageContentPayload(payload: PageContentPayload): void {
    setPageContent(payload);
    setExtractError(undefined);
    setIncludePageContext(false);
  }

  function applyPageContentError(message: string): void {
    setExtractError(message);
  }

  async function extractCurrentPage(): Promise<void> {
    setExtractingPage(true);
    setExtractError(undefined);

    try {
      const request: UiToExtensionMessage = {
        type: "extract_active_tab_content",
        maxChars: 100_000
      };
      const response = (await chrome.runtime.sendMessage(request)) as UiToExtensionResponse;
      if (!response?.ok) {
        throw new Error(response?.error || "extract_failed");
      }
      if (response.payload) {
        applyPageContentPayload(response.payload);
      }
      if (!input.trim()) {
        setInput("Please summarize the current tab using extracted full-page content.");
      }
    } catch (error) {
      setExtractError(error instanceof Error ? error.message : "extract_failed");
      setPageContent(undefined);
      setIncludePageContext(false);
    } finally {
      setExtractingPage(false);
    }
  }

  function clearExtractedPageContent(): void {
    setPageContent(undefined);
    setExtractError(undefined);
    setIncludePageContext(false);
  }

  function clearSelectionAndPageContext(): void {
    setSelectionContext(undefined);
    clearExtractedPageContent();
  }

  return {
    extractingPage,
    extractError,
    pageContent,
    includePageContext,
    selectionContext,
    setIncludePageContext,
    consumePendingSelectionPayload,
    applySelectionPayload,
    applyPageContentPayload,
    applyPageContentError,
    extractCurrentPage,
    clearExtractedPageContent,
    clearSelectionAndPageContext
  };
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}
