import { Readability } from "@mozilla/readability";
import type { PageContentPayload } from "@surf-ai/shared";

const DEFAULT_MAX_CHARS = 60_000;
const MIN_READABILITY_LENGTH = 200;
const READABILITY_MAX_NODE_COUNT = 12_000;

export function extractCurrentPageContent(maxChars = DEFAULT_MAX_CHARS): PageContentPayload {
  const safeMaxChars = clampMaxChars(maxChars);
  const readabilityText = extractWithReadability(safeMaxChars);

  if (readabilityText) {
    return {
      pageTitle: document.title,
      pageUrl: window.location.href,
      text: readabilityText,
      source: "readability",
      charCount: readabilityText.length,
      extractedAt: Date.now()
    };
  }

  const domText = extractWithDomFallback(safeMaxChars);
  return {
    pageTitle: document.title,
    pageUrl: window.location.href,
    text: domText,
    source: "dom",
    charCount: domText.length,
    extractedAt: Date.now()
  };
}

function clampMaxChars(maxChars: number): number {
  if (!Number.isFinite(maxChars)) return DEFAULT_MAX_CHARS;
  const normalized = Math.floor(maxChars);
  if (normalized < 500) return 500;
  if (normalized > 200_000) return 200_000;
  return normalized;
}

function extractWithReadability(maxChars: number): string | null {
  try {
    if (document.getElementsByTagName("*").length > READABILITY_MAX_NODE_COUNT) {
      return null;
    }
    const cloned = document.cloneNode(true) as Document;
    cleanupClonedDocument(cloned);
    const article = new Readability(cloned).parse();
    const candidate = normalizeText(article?.textContent ?? "");
    if (candidate.length < MIN_READABILITY_LENGTH) {
      return null;
    }
    return candidate.slice(0, maxChars);
  } catch {
    return null;
  }
}

function cleanupClonedDocument(cloned: Document): void {
  const removable = cloned.querySelectorAll("script, style, noscript, template");
  for (const node of removable) {
    node.remove();
  }
}

function extractWithDomFallback(maxChars: number): string {
  const fromBody = document.body?.innerText ?? "";
  const fromRoot = document.documentElement?.innerText ?? "";
  const normalized = normalizeText(fromBody.length >= fromRoot.length ? fromBody : fromRoot);
  return normalized.slice(0, maxChars);
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
