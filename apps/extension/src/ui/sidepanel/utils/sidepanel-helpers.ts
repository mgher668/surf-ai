import type {
  BridgeAssistantMessagePhase,
  BridgeChatRequest,
  BridgeConnection,
  BridgeModel,
  BridgeRunApproval,
  BridgeRunStreamEvent,
  BridgeSessionRun,
  ChatMessage,
  ChatMessagePart,
  ChatSession,
  PageContentPayload,
  SelectionPayload,
  UiSidebarMode
} from "@surf-ai/shared";
import { type Locale, t } from "../../common/i18n";

export type StreamAssistantByPhase = Record<BridgeAssistantMessagePhase, string>;

export interface RunArtifacts {
  assistantByPhase: StreamAssistantByPhase;
  reasoningSummary: string;
  reasoningText: string;
  commandOutput: string;
  errorMessage?: string;
}

export interface SessionRunProcessState {
  events: BridgeRunStreamEvent[];
  approvals: BridgeRunApproval[];
}

export interface ProcessTimelineItem {
  id: string;
  ts: number;
  kind:
    | "approval"
    | "commentary"
    | "reasoning_summary"
    | "reasoning_text"
    | "command_output"
    | "runtime_error"
    | "tool_call"
    | "tool_result"
    | "tool_failed";
  approval?: BridgeRunApproval;
  toolCallId?: string;
  toolId?: string;
  outputKind?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  content?: string;
  segments?: string[];
  message?: string;
  code?: string;
}

export interface ComposerAttachment {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SessionGalleryImage {
  key: string;
  src: string;
  alt: string;
  fileName?: string;
}

export type ConversationTimelineItem =
  | {
      id: string;
      ts: number;
      kind: "message";
      message: ChatMessage;
    }
  | {
      id: string;
      ts: number;
      kind: "process";
      process: ProcessTimelineItem;
    };

export function createEmptyStreamAssistantByPhase(): StreamAssistantByPhase {
  return {
    commentary: "",
    final_answer: "",
    unknown: ""
  };
}

export function createSessionGalleryImageKey(
  messageId: string,
  attachmentId: string,
  imageIndexInMessage: number
): string {
  return `${messageId}:${attachmentId}:${imageIndexInMessage}`;
}

export function createComposerGalleryImageKey(attachmentId: string, index: number): string {
  return `${attachmentId}:${index}`;
}

export function buildSessionGalleryImages(
  messages: ChatMessage[],
  activeConnection: BridgeConnection | undefined,
  locale: Locale
): SessionGalleryImage[] {
  const images: SessionGalleryImage[] = [];
  for (const message of messages) {
    const imageParts = extractImageParts(message.parts);
    if (imageParts.length === 0) {
      continue;
    }
    imageParts.forEach((part, index) => {
      const src = resolveMessageImageSrc(activeConnection, part);
      if (!src) {
        return;
      }
      images.push({
        key: createSessionGalleryImageKey(message.id, part.attachment.id, index),
        src,
        alt:
          part.attachment.fileName ??
          `${t(locale, "composerImagePreviewAltPrefix")} ${images.length + 1}`,
        ...(part.attachment.fileName ? { fileName: part.attachment.fileName } : {})
      });
    });
  }
  return images;
}

export function buildComposerGalleryImages(
  attachments: ComposerAttachment[],
  locale: Locale
): SessionGalleryImage[] {
  return attachments.map((attachment, index) => {
    const fileName = attachment.file.name?.trim();
    return {
      key: createComposerGalleryImageKey(attachment.id, index),
      src: attachment.previewUrl,
      alt: fileName || `${t(locale, "composerImagePreviewAltPrefix")} ${index + 1}`,
      ...(fileName ? { fileName } : {})
    };
  });
}

export function extractImageParts(
  parts: ChatMessagePart[] | undefined
): Array<Extract<ChatMessagePart, { type: "image" }>> {
  if (!parts || parts.length === 0) {
    return [];
  }
  return parts.filter(
    (part): part is Extract<ChatMessagePart, { type: "image" }> => part.type === "image"
  );
}

export function resolveUserMessageText(message: ChatMessage): string | undefined {
  if (message.parts && message.parts.length > 0) {
    const text = message.parts
      .filter((part): part is Extract<ChatMessagePart, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (text.length > 0) {
      return text;
    }

    if (
      extractImageParts(message.parts).length > 0 &&
      /^\[\d+\simage(?:s)?\]$/iu.test(message.content.trim())
    ) {
      return undefined;
    }
  }

  return message.content;
}

export function resolveMessageImageSrc(
  activeConnection: BridgeConnection | undefined,
  part: Extract<ChatMessagePart, { type: "image" }>
): string | undefined {
  const { attachment } = part;
  if (attachment.url) {
    if (
      attachment.url.startsWith("http://") ||
      attachment.url.startsWith("https://") ||
      attachment.url.startsWith("data:") ||
      attachment.url.startsWith("blob:")
    ) {
      return attachment.url;
    }

    if (activeConnection) {
      return joinBridgeUrl(activeConnection.baseUrl, attachment.url);
    }
    return attachment.url;
  }

  if (!activeConnection) {
    return undefined;
  }
  return joinBridgeUrl(activeConnection.baseUrl, `/uploads/${attachment.id}`);
}

function joinBridgeUrl(baseUrl: string, path: string): string {
  try {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    return new URL(path, normalizedBase).toString();
  } catch {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizedBase}${normalizedPath}`;
  }
}

export function normalizeSidebarMode(value: unknown): UiSidebarMode {
  return value === "overlay" ? "overlay" : "docked";
}

export function mergeSessionsWithLocalAdapters(
  localSessions: ChatSession[],
  backendSessions: ChatSession[]
): ChatSession[] {
  if (localSessions.length === 0 || backendSessions.length === 0) {
    return backendSessions;
  }
  const adapterBySessionId = new Map(
    localSessions
      .filter((item) => Boolean(item.lastAdapter))
      .map((item) => [item.id, item.lastAdapter])
  );
  if (adapterBySessionId.size === 0) {
    return backendSessions;
  }
  return backendSessions.map((session) => {
    if (session.lastAdapter) {
      return session;
    }
    const localAdapter = adapterBySessionId.get(session.id);
    if (!localAdapter) {
      return session;
    }
    return {
      ...session,
      lastAdapter: localAdapter
    };
  });
}

export function areSessionListsEqual(left: ChatSession[], right: ChatSession[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }
    if (
      a.id !== b.id ||
      a.title !== b.title ||
      a.starred !== b.starred ||
      a.lastAdapter !== b.lastAdapter ||
      a.status !== b.status ||
      a.lastActiveAt !== b.lastActiveAt ||
      a.createdAt !== b.createdAt ||
      a.updatedAt !== b.updatedAt
    ) {
      return false;
    }
  }

  return true;
}

export function normalizeModelList(models: BridgeModel[]): BridgeModel[] {
  const dedup = new Map<string, BridgeModel>();
  for (const item of models) {
    if (!item.id.trim()) {
      continue;
    }
    const key = `${item.adapter}::${item.id}`;
    dedup.set(key, {
      ...item,
      id: item.id.trim(),
      label: item.label.trim() || item.id.trim()
    });
  }
  return [...dedup.values()];
}

export function normalizeAssistantStreamPhase(phase: string | undefined): BridgeAssistantMessagePhase {
  if (phase === "commentary" || phase === "final_answer") {
    return phase;
  }
  return "unknown";
}

export function mergeAssistantCompletedContent(
  phase: BridgeAssistantMessagePhase,
  existing: string,
  completed: string
): string {
  if (phase !== "commentary") {
    return completed;
  }

  const nextText = completed.trim();
  if (!nextText) {
    return existing;
  }

  const currentText = existing.trim();
  if (!currentText) {
    return completed;
  }

  if (currentText === nextText || currentText.endsWith(nextText)) {
    return existing;
  }

  return `${existing.replace(/\s+$/u, "")}\n\n${completed}`;
}

export function buildRunArtifacts(events: BridgeRunStreamEvent[]): RunArtifacts {
  const assistantByPhase = createEmptyStreamAssistantByPhase();
  let reasoningSummary = "";
  let reasoningText = "";
  let commandOutput = "";
  let errorMessage: string | undefined;

  for (const event of events) {
    if (event.type === "assistant.delta") {
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      assistantByPhase[phase] += event.data.delta;
      continue;
    }

    if (event.type === "assistant.completed") {
      if (typeof event.data.content !== "string") {
        continue;
      }
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      assistantByPhase[phase] = mergeAssistantCompletedContent(
        phase,
        assistantByPhase[phase] ?? "",
        event.data.content
      );
      continue;
    }

    if (event.type === "reasoning.summary.delta") {
      reasoningSummary += event.data.delta;
      continue;
    }

    if (event.type === "reasoning.text.delta") {
      reasoningText += event.data.delta;
      continue;
    }

    if (event.type === "command.output.delta") {
      commandOutput += event.data.delta;
      continue;
    }

    if (event.type === "error") {
      errorMessage = event.data.message;
    }
  }

  return {
    assistantByPhase,
    reasoningSummary,
    reasoningText,
    commandOutput,
    ...(errorMessage ? { errorMessage } : {})
  };
}

export function buildSessionProcessTimelineItems(
  sessionRunProcesses: Record<string, SessionRunProcessState>
): ProcessTimelineItem[] {
  const items: ProcessTimelineItem[] = [];
  for (const [runId, process] of Object.entries(sessionRunProcesses)) {
    items.push(...buildProcessTimelineItems(runId, process.events, process.approvals));
  }
  items.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    return left.id.localeCompare(right.id);
  });
  return items;
}

function buildProcessTimelineItems(
  runId: string,
  events: BridgeRunStreamEvent[],
  approvals: BridgeRunApproval[]
): ProcessTimelineItem[] {
  const artifacts = buildRunArtifacts(events);
  const firstSeen = extractProcessFirstSeenTs(events);
  const items: ProcessTimelineItem[] = [];
  const mergedApprovals = mergeApprovalsFromEvents(events, approvals);
  const commentarySegments = extractCommentarySegments(events);

  items.push(...buildToolTimelineItems(runId, events));

  for (const approval of mergedApprovals) {
    items.push({
      id: `approval-${runId}-${approval.id}`,
      ts: approval.requestedAt,
      kind: "approval",
      approval
    });
  }

  if (commentarySegments.length > 0 && typeof firstSeen.commentary === "number") {
    items.push({
      id: `${runId}:commentary`,
      ts: firstSeen.commentary,
      kind: "commentary",
      content: commentarySegments.join("\n\n"),
      segments: commentarySegments
    });
  } else if (artifacts.assistantByPhase.commentary && typeof firstSeen.commentary === "number") {
    items.push({
      id: `${runId}:commentary`,
      ts: firstSeen.commentary,
      kind: "commentary",
      content: artifacts.assistantByPhase.commentary,
      segments: [artifacts.assistantByPhase.commentary]
    });
  }

  if (artifacts.reasoningSummary && typeof firstSeen.reasoningSummary === "number") {
    items.push({
      id: `${runId}:reasoning-summary`,
      ts: firstSeen.reasoningSummary,
      kind: "reasoning_summary",
      content: artifacts.reasoningSummary
    });
  }

  if (artifacts.reasoningText && typeof firstSeen.reasoningText === "number") {
    items.push({
      id: `${runId}:reasoning-text`,
      ts: firstSeen.reasoningText,
      kind: "reasoning_text",
      content: artifacts.reasoningText
    });
  }

  if (artifacts.commandOutput && typeof firstSeen.commandOutput === "number") {
    items.push({
      id: `${runId}:command-output`,
      ts: firstSeen.commandOutput,
      kind: "command_output",
      content: artifacts.commandOutput
    });
  }

  if (artifacts.errorMessage && typeof firstSeen.runtimeError === "number") {
    items.push({
      id: `${runId}:runtime-error`,
      ts: firstSeen.runtimeError,
      kind: "runtime_error",
      message: artifacts.errorMessage
    });
  }

  items.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    return left.id.localeCompare(right.id);
  });
  return items;
}

function buildToolTimelineItems(
  runId: string,
  events: BridgeRunStreamEvent[]
): ProcessTimelineItem[] {
  const items: ProcessTimelineItem[] = [];

  for (const event of events) {
    if (event.type === "tool.started") {
      items.push({
        id: `${runId}:tool-start:${event.data.toolCallId}`,
        ts: event.ts,
        kind: "tool_call",
        toolCallId: event.data.toolCallId,
        toolId: event.data.toolId,
        ...(event.data.input ? { input: event.data.input } : {})
      });
      continue;
    }

    if (event.type === "tool.output") {
      items.push({
        id: `${runId}:tool-output:${event.data.toolCallId}`,
        ts: event.ts,
        kind: "tool_result",
        toolCallId: event.data.toolCallId,
        toolId: event.data.toolId,
        outputKind: event.data.outputKind,
        content: formatUnknownContent(event.data.content),
        ...(event.data.metadata ? { metadata: event.data.metadata } : {})
      });
      continue;
    }

    if (event.type === "tool.failed") {
      items.push({
        id: `${runId}:tool-failed:${event.data.toolCallId}`,
        ts: event.ts,
        kind: "tool_failed",
        toolCallId: event.data.toolCallId,
        toolId: event.data.toolId,
        code: event.data.code,
        message: event.data.message
      });
    }
  }

  return items;
}

function formatUnknownContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function extractCommentarySegments(events: BridgeRunStreamEvent[]): string[] {
  const segments: string[] = [];
  for (const event of events) {
    if (event.type !== "assistant.completed") {
      continue;
    }
    const phase = normalizeAssistantStreamPhase(event.data.phase);
    if (phase !== "commentary") {
      continue;
    }
    if (typeof event.data.content !== "string") {
      continue;
    }
    const text = event.data.content.trim();
    if (!text) {
      continue;
    }
    const prev = segments[segments.length - 1];
    if (prev === text) {
      continue;
    }
    segments.push(text);
  }
  return segments;
}

function mergeApprovalsFromEvents(
  events: BridgeRunStreamEvent[],
  approvals: BridgeRunApproval[]
): BridgeRunApproval[] {
  const merged = new Map<string, BridgeRunApproval>();

  for (const approval of approvals) {
    merged.set(approval.id, approval);
  }

  for (const event of events) {
    if (event.type !== "approval.requested" && event.type !== "approval.updated") {
      continue;
    }
    const approval = event.data.approval;
    if (!approval?.id) {
      continue;
    }
    merged.set(approval.id, approval);
  }

  return [...merged.values()].sort((left, right) => {
    if (left.requestedAt !== right.requestedAt) {
      return left.requestedAt - right.requestedAt;
    }
    return left.id.localeCompare(right.id);
  });
}

export function buildConversationTimelineItems(
  messages: ChatMessage[],
  processItems: ProcessTimelineItem[]
): ConversationTimelineItem[] {
  const timeline: ConversationTimelineItem[] = [
    ...messages.map((message) => ({
      id: `message-${message.id}`,
      ts: message.createdAt,
      kind: "message" as const,
      message
    })),
    ...processItems.map((process) => ({
      id: `process-${process.id}`,
      ts: process.ts,
      kind: "process" as const,
      process
    }))
  ];

  timeline.sort((left, right) => {
    if (left.ts !== right.ts) {
      return left.ts - right.ts;
    }
    if (left.kind !== right.kind) {
      return left.kind === "process" ? -1 : 1;
    }
    return left.id.localeCompare(right.id);
  });

  return timeline;
}

function extractProcessFirstSeenTs(events: BridgeRunStreamEvent[]): {
  commentary?: number;
  reasoningSummary?: number;
  reasoningText?: number;
  commandOutput?: number;
  runtimeError?: number;
} {
  let commentary: number | undefined;
  let reasoningSummary: number | undefined;
  let reasoningText: number | undefined;
  let commandOutput: number | undefined;
  let runtimeError: number | undefined;

  for (const event of events) {
    if (event.type === "assistant.delta") {
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      if (phase === "commentary" && commentary === undefined) {
        commentary = event.ts;
      }
      continue;
    }

    if (event.type === "assistant.completed") {
      const phase = normalizeAssistantStreamPhase(event.data.phase);
      if (phase === "commentary" && commentary === undefined) {
        commentary = event.ts;
      }
      continue;
    }

    if (event.type === "reasoning.summary.delta" && reasoningSummary === undefined) {
      reasoningSummary = event.ts;
      continue;
    }

    if (event.type === "reasoning.text.delta" && reasoningText === undefined) {
      reasoningText = event.ts;
      continue;
    }

    if (event.type === "command.output.delta" && commandOutput === undefined) {
      commandOutput = event.ts;
      continue;
    }

    if (event.type === "error" && runtimeError === undefined) {
      runtimeError = event.ts;
    }
  }

  return {
    ...(typeof commentary === "number" ? { commentary } : {}),
    ...(typeof reasoningSummary === "number" ? { reasoningSummary } : {}),
    ...(typeof reasoningText === "number" ? { reasoningText } : {}),
    ...(typeof commandOutput === "number" ? { commandOutput } : {}),
    ...(typeof runtimeError === "number" ? { runtimeError } : {})
  };
}

export function pickDisplayAssistantText(streamByPhase: StreamAssistantByPhase): string {
  if (streamByPhase.final_answer.length > 0) {
    return streamByPhase.final_answer;
  }
  if (streamByPhase.unknown.length > 0) {
    return streamByPhase.unknown;
  }
  return "";
}

export function isRunInFlight(status: BridgeSessionRun["status"]): boolean {
  return status === "QUEUED" || status === "RUNNING" || status === "CANCELLING";
}

export function formatRunStatus(locale: Locale, status: BridgeSessionRun["status"]): string {
  if (status === "QUEUED") return t(locale, "runStatusQueued");
  if (status === "RUNNING") return t(locale, "runStatusRunning");
  if (status === "CANCELLING") return t(locale, "runStatusCancelling");
  if (status === "SUCCEEDED") return t(locale, "runStatusSucceeded");
  if (status === "FAILED") return t(locale, "runStatusFailed");
  return t(locale, "runStatusCancelled");
}

export function areMessageListsEqual(left: ChatMessage[], right: ChatMessage[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }

    if (
      a.id !== b.id ||
      a.sessionId !== b.sessionId ||
      a.seq !== b.seq ||
      a.role !== b.role ||
      a.adapter !== b.adapter ||
      a.model !== b.model ||
      a.content !== b.content ||
      !areMessagePartsEqual(a.parts, b.parts) ||
      a.createdAt !== b.createdAt
    ) {
      return false;
    }
  }

  return true;
}

function areMessagePartsEqual(
  left: ChatMessagePart[] | undefined,
  right: ChatMessagePart[] | undefined
): boolean {
  if (!left || left.length === 0) {
    return !right || right.length === 0;
  }
  if (!right || right.length === 0 || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || a.type !== b.type) {
      return false;
    }
    if (a.type === "text" && b.type === "text") {
      if (a.text !== b.text) {
        return false;
      }
      continue;
    }
    if (a.type === "image" && b.type === "image") {
      if (
        a.attachment.id !== b.attachment.id ||
        a.attachment.mimeType !== b.attachment.mimeType ||
        a.attachment.sizeBytes !== b.attachment.sizeBytes ||
        a.attachment.fileName !== b.attachment.fileName ||
        a.attachment.url !== b.attachment.url ||
        a.attachment.createdAt !== b.attachment.createdAt
      ) {
        return false;
      }
      continue;
    }
    return false;
  }

  return true;
}

export function upsertApproval(list: BridgeRunApproval[], approval: BridgeRunApproval): BridgeRunApproval[] {
  const index = list.findIndex((item) => item.id === approval.id);
  if (index < 0) {
    return [...list, approval];
  }
  const next = [...list];
  next[index] = approval;
  return next;
}

export function stableDecisionKey(decision: unknown): string {
  try {
    return JSON.stringify(decision, (_key, value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort((a, b) => a.localeCompare(b))
          .map((key) => [key, (value as Record<string, unknown>)[key]])
      );
    });
  } catch {
    return String(decision);
  }
}

export function buildBridgeHeaders(
  connection: BridgeConnection,
  includeJsonContentType = false
): Record<string, string> {
  const headers: Record<string, string> = {
    ...(connection.userId ? { "x-surf-user-id": connection.userId } : {})
  };
  if (includeJsonContentType) {
    headers["content-type"] = "application/json";
  }
  if (connection.token) {
    headers["x-surf-token"] = connection.token;
  }
  return headers;
}

export function buildChatContext(
  selectionContext: SelectionPayload | undefined,
  pageContent: PageContentPayload | undefined,
  includePageContext: boolean
): NonNullable<BridgeChatRequest["context"]> {
  const context: NonNullable<BridgeChatRequest["context"]> = {};
  const pageTitle = pageContent?.pageTitle || selectionContext?.pageTitle;
  if (pageTitle) context.pageTitle = pageTitle;
  const pageUrl = pageContent?.pageUrl || selectionContext?.pageUrl;
  if (pageUrl) context.pageUrl = pageUrl;
  if (selectionContext?.text) {
    context.selectedText = selectionContext.text;
  }
  if (includePageContext && pageContent?.text) {
    context.pageText = pageContent.text;
    context.pageTextSource = pageContent.source;
  }
  return context;
}
