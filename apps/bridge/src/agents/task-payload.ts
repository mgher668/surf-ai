import type { BridgeChatRequest } from "@surf-ai/shared";

const MAX_HISTORY_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_SELECTED_TEXT_CHARS = 12_000;
const MAX_PAGE_TEXT_CHARS = 100_000;

interface ClippedText {
  content: string;
  truncated: boolean;
  originalLength: number;
}

export interface AgentTaskPayload {
  sessionId: string;
  conversation: {
    totalMessages: number;
    droppedMessages: number;
    messages: Array<{
      role: BridgeChatRequest["messages"][number]["role"];
      text: ClippedText;
    }>;
  };
  userRequest: ClippedText;
  pageContext?: {
    pageTitle?: string;
    pageUrl?: string;
    selectedText?: ClippedText;
    pageText?: ClippedText & {
      source?: NonNullable<BridgeChatRequest["context"]>["pageTextSource"];
    };
  };
}

export function buildAgentTaskPayload(request: BridgeChatRequest): AgentTaskPayload {
  const scopedMessages = request.messages.slice(-MAX_HISTORY_MESSAGES);
  const droppedMessages = Math.max(0, request.messages.length - scopedMessages.length);
  const messages = scopedMessages.map((item) => ({
    role: item.role,
    text: clipText(item.content, MAX_MESSAGE_CHARS)
  }));

  const lastUserMessage =
    [...scopedMessages].reverse().find((item) => item.role === "user")?.content ??
    scopedMessages.at(-1)?.content ??
    "";

  const pageContext = buildPageContext(request);

  return {
    sessionId: request.sessionId,
    conversation: {
      totalMessages: request.messages.length,
      droppedMessages,
      messages
    },
    userRequest: clipText(lastUserMessage, MAX_MESSAGE_CHARS),
    ...(pageContext ? { pageContext } : {})
  };
}

function buildPageContext(request: BridgeChatRequest): AgentTaskPayload["pageContext"] | undefined {
  const context = request.context;
  if (!context) {
    return undefined;
  }

  const pageContext: NonNullable<AgentTaskPayload["pageContext"]> = {};

  if (context.pageTitle) {
    pageContext.pageTitle = context.pageTitle;
  }
  if (context.pageUrl) {
    pageContext.pageUrl = context.pageUrl;
  }
  if (context.selectedText) {
    pageContext.selectedText = clipText(context.selectedText, MAX_SELECTED_TEXT_CHARS);
  }
  if (context.pageText) {
    pageContext.pageText = {
      ...clipText(context.pageText, MAX_PAGE_TEXT_CHARS),
      ...(context.pageTextSource ? { source: context.pageTextSource } : {})
    };
  }

  return Object.keys(pageContext).length > 0 ? pageContext : undefined;
}

function clipText(raw: string, limit: number): ClippedText {
  const content = raw.slice(0, limit);
  return {
    content,
    truncated: raw.length > limit,
    originalLength: raw.length
  };
}
