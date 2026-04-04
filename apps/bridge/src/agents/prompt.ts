import type { BridgeChatRequest } from "@surf-ai/shared";

export function buildPrompt(request: BridgeChatRequest): string {
  const lines: string[] = [];

  if (request.context?.pageTitle || request.context?.pageUrl) {
    lines.push("Page context:");
    if (request.context.pageTitle) lines.push(`- title: ${request.context.pageTitle}`);
    if (request.context.pageUrl) lines.push(`- url: ${request.context.pageUrl}`);
    lines.push("");
  }

  if (request.context?.selectedText) {
    lines.push("Selected text:");
    lines.push(request.context.selectedText);
    lines.push("");
  }

  lines.push("Conversation:");
  for (const message of request.messages) {
    lines.push(`[${message.role}] ${message.content}`);
  }

  lines.push("");
  lines.push("Please provide a concise and helpful response.");

  return lines.join("\n");
}
