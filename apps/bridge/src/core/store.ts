import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  BridgeApprovalKind,
  BridgeApprovalStatus,
  BridgeAdapter,
  ChatAttachment,
  BridgeModel,
  BridgeRunApproval,
  BridgeRunStreamEvent,
  BridgeSessionRun,
  ChatMessage,
  ChatMessagePart,
  ChatSession,
  CodexReasoningEffort,
  MessageRole,
  SessionRunStatus,
  SessionStatus
} from "@surf-ai/shared";
import type { BridgeUserAccount } from "./config";

interface SessionRow {
  id: string;
  title: string;
  starred: number;
  last_adapter: BridgeAdapter | null;
  status: SessionStatus;
  created_at: number;
  updated_at: number;
  last_active_at: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  seq: number;
  role: MessageRole;
  adapter: BridgeAdapter | null;
  model: string | null;
  content: string;
  parts_json: string | null;
  created_at: number;
}

export interface StoredAttachment extends ChatAttachment {
  userId: string;
  sessionId: string;
  storagePath: string;
  sha256?: string;
}

interface AttachmentRow {
  id: string;
  user_id: string;
  session_id: string;
  storage_path: string;
  mime_type: string;
  file_name: string | null;
  byte_size: number;
  sha256: string | null;
  created_at: number;
  updated_at: number;
}

interface SessionRunRow {
  id: string;
  session_id: string;
  user_id: string;
  adapter: BridgeAdapter;
  model: string | null;
  status: SessionRunStatus;
  user_message_id: string;
  assistant_message_id: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  updated_at: number;
}

export interface AgentSessionLink {
  sessionId: string;
  provider: "codex" | "claude";
  providerSessionId: string;
  syncedSeq: number;
  state: "READY" | "BROKEN";
  lastError?: string;
  updatedAt: number;
}

interface AgentSessionLinkRow {
  session_id: string;
  provider: AgentSessionLink["provider"];
  provider_session_id: string;
  synced_seq: number;
  state: AgentSessionLink["state"];
  last_error: string | null;
  updated_at: number;
}

export type SessionMemoryKind = "summary" | "facts" | "todos";

export interface SessionMemory {
  sessionId: string;
  kind: SessionMemoryKind;
  content: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  updatedAt: number;
}

interface SessionMemoryRow {
  session_id: string;
  kind: SessionMemoryKind;
  content: string;
  source_seq_start: number;
  source_seq_end: number;
  updated_at: number;
}

interface ModelRow {
  id: string;
  user_id: string;
  adapter: BridgeAdapter;
  label: string;
  enabled: number;
  is_default: number;
  reasoning_effort: CodexReasoningEffort | null;
  created_at: number;
  updated_at: number;
}

const NATIVE_MODEL_ADAPTERS: Array<Extract<BridgeAdapter, "mock" | "codex" | "claude">> = [
  "codex",
  "claude",
  "mock"
];

export type AuditLevel = "INFO" | "WARN" | "ERROR";

export interface AuditEvent {
  id: string;
  userId?: string;
  eventType: string;
  level: AuditLevel;
  route?: string;
  method?: string;
  statusCode?: number;
  ip?: string;
  details?: Record<string, unknown>;
  createdAt: number;
}

interface AuditEventRow {
  id: string;
  user_id: string | null;
  event_type: string;
  level: AuditLevel;
  route: string | null;
  method: string | null;
  status_code: number | null;
  ip: string | null;
  details_json: string | null;
  created_at: number;
}

interface ApprovalEventRow {
  id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  adapter: BridgeAdapter;
  thread_id: string | null;
  turn_id: string | null;
  approval_request_id: string;
  kind: BridgeApprovalKind;
  title: string | null;
  payload_json: string;
  available_decisions_json: string;
  status: BridgeApprovalStatus;
  decision_json: string | null;
  decided_by: string | null;
  decision_reason: string | null;
  requested_at: number;
  decided_at: number | null;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

interface RunEventRow {
  seq: number;
  event_id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  type: string;
  ts: number;
  data_json: string;
  created_at: number;
}

export interface PurgeExpiredDataInput {
  sessionCutoffMs: number;
  auditCutoffMs: number;
  dryRun: boolean;
  includeSessions: boolean;
  includeAudit: boolean;
}

export interface PurgeExpiredDataResult {
  dryRun: boolean;
  includeSessions: boolean;
  includeAudit: boolean;
  sessionCutoffMs: number;
  auditCutoffMs: number;
  counts: {
    sessions: number;
    messages: number;
    agentSessionLinks: number;
    sessionMemories: number;
    auditEvents: number;
  };
  executedAt: number;
}

export class BridgeStore {
  private readonly db: DatabaseSync;
  private readonly defaultUserId: string;

  public constructor(dbPath: string, users: BridgeUserAccount[]) {
    const fullPath = resolve(dbPath);
    mkdirSync(dirname(fullPath), { recursive: true });

    this.db = new DatabaseSync(fullPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
    this.seedUsers(users);
    this.defaultUserId = users[0]?.id ?? "local";
  }

  public authenticateUser(userId: string | undefined, token: string | undefined): string | null {
    const normalizedUserId = userId?.trim() || this.defaultUserId;
    const row = this.db.prepare(
      "SELECT id, token_hash FROM users WHERE id = ?"
    ).get(normalizedUserId) as { id: string; token_hash: string | null } | undefined;

    if (!row) {
      return null;
    }

    if (!row.token_hash) {
      return row.id;
    }

    const provided = token?.trim();
    if (!provided) {
      return null;
    }

    return hashToken(provided) === row.token_hash ? row.id : null;
  }

  public listModels(userId: string): BridgeModel[] {
    this.ensureDefaultModels(userId);
    const rows = this.db.prepare(
      `SELECT id, user_id, adapter, label, enabled, is_default, reasoning_effort, created_at, updated_at
       FROM models
       WHERE user_id = ?
       ORDER BY adapter ASC, is_default DESC, label ASC, id ASC`
    ).all(userId) as unknown as ModelRow[];
    return rows.map(mapModelRow);
  }

  public replaceModels(userId: string, models: BridgeModel[]): BridgeModel[] {
    const normalized = normalizeModelsInput(models);
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT INTO models (
        id, user_id, adapter, label, enabled, is_default, reasoning_effort, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM models WHERE user_id = ?").run(userId);
      for (const model of normalized) {
        insert.run(
          model.id,
          userId,
          model.adapter,
          model.label,
          model.enabled ? 1 : 0,
          model.isDefault ? 1 : 0,
          model.adapter === "codex" ? model.modelReasoningEffort ?? null : null,
          now,
          now
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    this.ensureDefaultModels(userId);
    return this.listModels(userId);
  }

  public createSession(userId: string, title: string): ChatSession {
    const now = Date.now();
    const id = randomUUID();

    this.db.prepare(
      `INSERT INTO sessions (
        id, user_id, title, starred, status, created_at, updated_at, last_active_at
      ) VALUES (?, ?, ?, 0, 'ACTIVE', ?, ?, ?)`
    ).run(id, userId, title, now, now, now);

    return {
      id,
      title,
      starred: false,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now
    };
  }

  public listSessions(userId: string): ChatSession[] {
    const rows = this.db.prepare(
      `SELECT
         s.id,
         s.title,
         s.starred,
         COALESCE(
           s.last_adapter,
           (
             SELECT l.provider
             FROM agent_session_links l
             WHERE l.session_id = s.id
             ORDER BY l.updated_at DESC
             LIMIT 1
           )
         ) AS last_adapter,
         s.status,
         s.created_at,
         s.updated_at,
         s.last_active_at
       FROM sessions s
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC`
    ).all(userId) as unknown as SessionRow[];
    return rows.map(mapSessionRow);
  }

  public getSession(userId: string, sessionId: string): ChatSession | null {
    const row = this.db.prepare(
      `SELECT
         s.id,
         s.title,
         s.starred,
         COALESCE(
           s.last_adapter,
           (
             SELECT l.provider
             FROM agent_session_links l
             WHERE l.session_id = s.id
             ORDER BY l.updated_at DESC
             LIMIT 1
           )
         ) AS last_adapter,
         s.status,
         s.created_at,
         s.updated_at,
         s.last_active_at
       FROM sessions s
       WHERE s.id = ? AND s.user_id = ?`
    ).get(sessionId, userId) as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  public updateSessionTitle(userId: string, sessionId: string, title: string): ChatSession | null {
    const now = Date.now();
    this.db.prepare(
      "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(title, now, sessionId, userId);
    return this.getSession(userId, sessionId);
  }

  public updateSessionStar(userId: string, sessionId: string, starred: boolean): ChatSession | null {
    const now = Date.now();
    this.db.prepare(
      "UPDATE sessions SET starred = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(starred ? 1 : 0, now, sessionId, userId);
    return this.getSession(userId, sessionId);
  }

  public updateSessionLastAdapter(
    userId: string,
    sessionId: string,
    lastAdapter: BridgeAdapter
  ): ChatSession | null {
    const now = Date.now();
    this.db.prepare(
      "UPDATE sessions SET last_adapter = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(lastAdapter, now, sessionId, userId);
    return this.getSession(userId, sessionId);
  }

  public updateSessionStatus(
    userId: string,
    sessionId: string,
    status: SessionStatus
  ): ChatSession | null {
    const now = Date.now();
    this.db.prepare(
      "UPDATE sessions SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(status, now, sessionId, userId);
    return this.getSession(userId, sessionId);
  }

  public deleteSession(userId: string, sessionId: string): boolean {
    const result = this.db.prepare(
      "DELETE FROM sessions WHERE id = ? AND user_id = ?"
    ).run(sessionId, userId) as { changes: number };
    return result.changes > 0;
  }

  public createAttachment(input: {
    userId: string;
    sessionId: string;
    storagePath: string;
    mimeType: string;
    byteSize: number;
    fileName?: string;
    sha256?: string;
  }): StoredAttachment {
    this.assertSessionOwnership(input.userId, input.sessionId);
    const now = Date.now();
    const id = randomUUID();

    this.db.prepare(
      `INSERT INTO attachments (
        id, user_id, session_id, storage_path, mime_type, file_name, byte_size, sha256, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.userId,
      input.sessionId,
      input.storagePath,
      input.mimeType,
      input.fileName?.slice(0, 240) ?? null,
      input.byteSize,
      input.sha256 ?? null,
      now,
      now
    );

    const row = this.getAttachmentRow(input.userId, id);
    if (!row) {
      throw new Error("attachment_insert_failed");
    }
    return mapAttachmentRow(row);
  }

  public getAttachment(userId: string, attachmentId: string): StoredAttachment | null {
    const row = this.getAttachmentRow(userId, attachmentId);
    return row ? mapAttachmentRow(row) : null;
  }

  public listAttachmentsByIds(
    userId: string,
    sessionId: string,
    attachmentIds: string[]
  ): StoredAttachment[] {
    if (attachmentIds.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(attachmentIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return [];
    }

    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT
         id, user_id, session_id, storage_path, mime_type, file_name, byte_size, sha256, created_at, updated_at
       FROM attachments
       WHERE user_id = ?
         AND session_id = ?
         AND id IN (${placeholders})`
    ).all(userId, sessionId, ...uniqueIds) as unknown as AttachmentRow[];
    const byId = new Map(rows.map((row) => [row.id, mapAttachmentRow(row)]));
    return uniqueIds.map((id) => byId.get(id)).filter((item): item is StoredAttachment => Boolean(item));
  }

  public listAttachmentsBySession(userId: string, sessionId: string): StoredAttachment[] {
    this.assertSessionOwnership(userId, sessionId);
    const rows = this.db.prepare(
      `SELECT
         id, user_id, session_id, storage_path, mime_type, file_name, byte_size, sha256, created_at, updated_at
       FROM attachments
       WHERE user_id = ? AND session_id = ?
       ORDER BY created_at ASC`
    ).all(userId, sessionId) as unknown as AttachmentRow[];
    return rows.map(mapAttachmentRow);
  }

  public listMessages(userId: string, sessionId: string, afterSeq: number, limit: number): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, seq, role, adapter, model, content, parts_json, created_at
       FROM messages
       WHERE user_id = ? AND session_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`
    ).all(userId, sessionId, afterSeq, limit) as unknown as MessageRow[];
    return rows.map(mapMessageRow);
  }

  public listAllMessagesBySession(userId: string, sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, seq, role, adapter, model, content, parts_json, created_at
       FROM messages
       WHERE user_id = ? AND session_id = ?
       ORDER BY seq ASC`
    ).all(userId, sessionId) as unknown as MessageRow[];
    return rows.map(mapMessageRow);
  }

  public appendMessage(
    userId: string,
    sessionId: string,
    role: MessageRole,
    content: string,
    adapter?: BridgeAdapter,
    model?: string,
    parts?: ChatMessagePart[]
  ): ChatMessage {
    const now = Date.now();
    const id = randomUUID();
    const normalizedParts = normalizeMessageParts(parts);

    const nextSeq = this.getNextSeq(userId, sessionId);
    this.db.exec("BEGIN");
    try {
      this.db.prepare(
        `INSERT INTO messages (
          id, session_id, user_id, seq, role, adapter, model, content, parts_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        sessionId,
        userId,
        nextSeq,
        role,
        adapter ?? null,
        model ?? null,
        content,
        normalizedParts ? stringifyJsonSafe(normalizedParts) : null,
        now
      );

      const attachmentIds = collectAttachmentIdsFromParts(normalizedParts);
      if (attachmentIds.length > 0) {
        this.linkMessageAttachments(userId, sessionId, id, attachmentIds, now);
      }

      this.db.prepare(
        "UPDATE sessions SET updated_at = ?, last_active_at = ?, status = 'ACTIVE' WHERE id = ? AND user_id = ?"
      ).run(now, now, sessionId, userId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    return {
      id,
      sessionId,
      seq: nextSeq,
      role,
      ...(adapter ? { adapter } : {}),
      ...(model ? { model } : {}),
      content,
      ...(normalizedParts ? { parts: normalizedParts } : {}),
      createdAt: now
    };
  }

  public createSessionRun(input: {
    userId: string;
    sessionId: string;
    adapter: BridgeAdapter;
    model?: string;
    status: SessionRunStatus;
    userMessageId: string;
  }): BridgeSessionRun {
    this.assertSessionOwnership(input.userId, input.sessionId);

    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO session_runs (
        id, session_id, user_id, adapter, model, status, user_message_id,
        assistant_message_id, error_message, created_at, started_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?)`
    ).run(
      id,
      input.sessionId,
      input.userId,
      input.adapter,
      input.model ?? null,
      input.status,
      input.userMessageId,
      now,
      now
    );

    const run = this.getSessionRun(input.userId, id);
    if (!run) {
      throw new Error("failed_to_create_session_run");
    }
    return run;
  }

  public getSessionRun(userId: string, runId: string): BridgeSessionRun | null {
    const row = this.db.prepare(
      `SELECT
         r.id, r.session_id, r.user_id, r.adapter, r.model, r.status, r.user_message_id,
         r.assistant_message_id, r.error_message, r.created_at, r.started_at, r.finished_at, r.updated_at
       FROM session_runs r
       WHERE r.id = ? AND r.user_id = ?`
    ).get(runId, userId) as SessionRunRow | undefined;

    return row ? mapSessionRunRow(row) : null;
  }

  public listSessionRuns(userId: string, sessionId: string, limit = 20): BridgeSessionRun[] {
    const rows = this.db.prepare(
      `SELECT
         r.id, r.session_id, r.user_id, r.adapter, r.model, r.status, r.user_message_id,
         r.assistant_message_id, r.error_message, r.created_at, r.started_at, r.finished_at, r.updated_at
       FROM session_runs r
       WHERE r.user_id = ? AND r.session_id = ?
       ORDER BY r.created_at DESC
       LIMIT ?`
    ).all(userId, sessionId, limit) as unknown as SessionRunRow[];

    return rows.map(mapSessionRunRow);
  }

  public getLatestActiveSessionRun(userId: string, sessionId: string): BridgeSessionRun | null {
    const row = this.db.prepare(
      `SELECT
         r.id, r.session_id, r.user_id, r.adapter, r.model, r.status, r.user_message_id,
         r.assistant_message_id, r.error_message, r.created_at, r.started_at, r.finished_at, r.updated_at
       FROM session_runs r
       WHERE r.user_id = ?
         AND r.session_id = ?
         AND r.status IN ('QUEUED', 'RUNNING', 'CANCELLING')
       ORDER BY r.created_at DESC
       LIMIT 1`
    ).get(userId, sessionId) as SessionRunRow | undefined;

    return row ? mapSessionRunRow(row) : null;
  }

  public updateSessionRunStatus(
    userId: string,
    runId: string,
    input: {
      status: SessionRunStatus;
      assistantMessageId?: string;
      errorMessage?: string;
      startedAt?: number;
      finishedAt?: number;
    }
  ): BridgeSessionRun | null {
    const now = Date.now();
    this.db.prepare(
      `UPDATE session_runs
       SET status = ?,
           assistant_message_id = COALESCE(?, assistant_message_id),
           error_message = ?,
           started_at = COALESCE(?, started_at),
           finished_at = COALESCE(?, finished_at),
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      input.status,
      input.assistantMessageId ?? null,
      input.errorMessage ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      now,
      runId,
      userId
    );

    return this.getSessionRun(userId, runId);
  }

  public recoverInterruptedRuns(errorMessage: string): number {
    const staleRuns = this.db.prepare(
      `SELECT DISTINCT user_id, session_id
       FROM session_runs
       WHERE status IN ('QUEUED', 'RUNNING', 'CANCELLING')`
    ).all() as Array<{ user_id: string; session_id: string }>;

    if (staleRuns.length === 0) {
      return 0;
    }

    const now = Date.now();
    this.db.prepare(
      `UPDATE session_runs
       SET status = 'FAILED',
           error_message = ?,
           finished_at = ?,
           updated_at = ?
       WHERE status IN ('QUEUED', 'RUNNING', 'CANCELLING')`
    ).run(errorMessage, now, now);

    const updateSession = this.db.prepare(
      `UPDATE sessions
       SET status = 'ERROR',
           updated_at = ?
       WHERE id = ? AND user_id = ?`
    );

    for (const run of staleRuns) {
      updateSession.run(now, run.session_id, run.user_id);
    }

    return staleRuns.length;
  }

  public countActiveRuns(userId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS count
       FROM session_runs
       WHERE user_id = ?
         AND status IN ('QUEUED', 'RUNNING', 'CANCELLING')`
    ).get(userId) as { count: number };
    return readCount(row);
  }

  public createApprovalEvent(input: {
    userId: string;
    sessionId: string;
    runId: string;
    adapter: BridgeAdapter;
    threadId?: string;
    turnId?: string;
    approvalRequestId: string;
    kind: BridgeApprovalKind;
    title?: string;
    payload: Record<string, unknown>;
    availableDecisions: unknown[];
    requestedAt: number;
    expiresAt: number;
  }): BridgeRunApproval {
    this.assertSessionOwnership(input.userId, input.sessionId);
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO approval_events (
        id, user_id, session_id, run_id, adapter, thread_id, turn_id,
        approval_request_id, kind, title, payload_json, available_decisions_json,
        status, decision_json, decided_by, decision_reason, requested_at,
        decided_at, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?, NULL, ?, ?, ?)`
    ).run(
      id,
      input.userId,
      input.sessionId,
      input.runId,
      input.adapter,
      input.threadId ?? null,
      input.turnId ?? null,
      input.approvalRequestId,
      input.kind,
      input.title?.slice(0, 240) ?? null,
      stringifyJsonSafe(input.payload),
      stringifyJsonSafe(input.availableDecisions),
      input.requestedAt,
      input.expiresAt,
      now,
      now
    );
    const row = this.getApprovalEventRowById(id);
    if (!row) {
      throw new Error("approval_event_insert_failed");
    }
    return mapApprovalEventRow(row);
  }

  public getApprovalEvent(
    userId: string,
    runId: string,
    approvalRequestId: string
  ): BridgeRunApproval | null {
    const row = this.db.prepare(
      `SELECT
         id, user_id, session_id, run_id, adapter, thread_id, turn_id,
         approval_request_id, kind, title, payload_json, available_decisions_json,
         status, decision_json, decided_by, decision_reason, requested_at,
         decided_at, expires_at, created_at, updated_at
       FROM approval_events
       WHERE user_id = ? AND run_id = ? AND approval_request_id = ?`
    ).get(userId, runId, approvalRequestId) as ApprovalEventRow | undefined;
    return row ? mapApprovalEventRow(row) : null;
  }

  public listRunApprovals(
    userId: string,
    sessionId: string,
    runId: string,
    statusFilter: "pending" | "all" = "all"
  ): BridgeRunApproval[] {
    this.assertSessionOwnership(userId, sessionId);
    const where =
      statusFilter === "pending"
        ? "user_id = ? AND session_id = ? AND run_id = ? AND status = 'PENDING'"
        : "user_id = ? AND session_id = ? AND run_id = ?";
    const rows = this.db.prepare(
      `SELECT
         id, user_id, session_id, run_id, adapter, thread_id, turn_id,
         approval_request_id, kind, title, payload_json, available_decisions_json,
         status, decision_json, decided_by, decision_reason, requested_at,
         decided_at, expires_at, created_at, updated_at
       FROM approval_events
       WHERE ${where}
       ORDER BY requested_at ASC`
    ).all(userId, sessionId, runId) as unknown as ApprovalEventRow[];
    return rows.map(mapApprovalEventRow);
  }

  public appendRunEvent(userId: string, event: BridgeRunStreamEvent): void {
    if (event.type === "heartbeat") {
      return;
    }

    const now = Date.now();
    this.db.prepare(
      `INSERT OR IGNORE INTO run_events (
        event_id, user_id, session_id, run_id, type, ts, data_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      event.eventId,
      userId,
      event.sessionId,
      event.runId,
      event.type,
      event.ts,
      stringifyJsonSafe(event.data),
      now
    );
  }

  public listRunEvents(
    userId: string,
    sessionId: string,
    runId: string,
    limit = 2000
  ): BridgeRunStreamEvent[] {
    this.assertSessionOwnership(userId, sessionId);
    const rows = this.db.prepare(
      `SELECT
         seq, event_id, user_id, session_id, run_id, type, ts, data_json, created_at
       FROM run_events
       WHERE user_id = ? AND session_id = ? AND run_id = ?
       ORDER BY seq DESC
       LIMIT ?`
    ).all(userId, sessionId, runId, limit) as unknown as RunEventRow[];

    return rows.reverse().map(mapRunEventRow);
  }

  public updateApprovalEvent(input: {
    userId: string;
    runId: string;
    approvalRequestId: string;
    status: Exclude<BridgeApprovalStatus, "PENDING">;
    decision?: unknown;
    decidedBy?: string;
    decisionReason?: string;
    decidedAt?: number;
  }): BridgeRunApproval | null {
    const now = Date.now();
    const decidedAt = input.decidedAt ?? now;
    this.db.prepare(
      `UPDATE approval_events
       SET status = ?,
           decision_json = ?,
           decided_by = ?,
           decision_reason = ?,
           decided_at = ?,
           updated_at = ?
       WHERE user_id = ? AND run_id = ? AND approval_request_id = ?`
    ).run(
      input.status,
      input.decision === undefined ? null : stringifyJsonSafe(input.decision),
      input.decidedBy ?? null,
      input.decisionReason?.slice(0, 500) ?? null,
      decidedAt,
      now,
      input.userId,
      input.runId,
      input.approvalRequestId
    );

    return this.getApprovalEvent(input.userId, input.runId, input.approvalRequestId);
  }

  public recoverPendingApprovals(reason: string): number {
    const now = Date.now();
    const result = this.db.prepare(
      `UPDATE approval_events
       SET status = 'FAILED',
           decision_json = ?,
           decision_reason = ?,
           decided_at = ?,
           updated_at = ?
       WHERE status = 'PENDING'`
    ).run(
      stringifyJsonSafe("bridge_restart_failed"),
      reason.slice(0, 500),
      now,
      now
    ) as { changes: number };
    return result.changes;
  }

  public listExpiredPendingApprovals(nowMs: number, limit = 100): BridgeRunApproval[] {
    const rows = this.db.prepare(
      `SELECT
         id, user_id, session_id, run_id, adapter, thread_id, turn_id,
         approval_request_id, kind, title, payload_json, available_decisions_json,
         status, decision_json, decided_by, decision_reason, requested_at,
         decided_at, expires_at, created_at, updated_at
       FROM approval_events
       WHERE status = 'PENDING' AND expires_at <= ?
       ORDER BY expires_at ASC
       LIMIT ?`
    ).all(nowMs, limit) as unknown as ApprovalEventRow[];
    return rows.map(mapApprovalEventRow);
  }

  public getAgentSessionLink(
    userId: string,
    sessionId: string,
    provider: AgentSessionLink["provider"]
  ): AgentSessionLink | null {
    const row = this.db.prepare(
      `SELECT l.session_id, l.provider, l.provider_session_id, l.synced_seq, l.state, l.last_error, l.updated_at
       FROM agent_session_links l
       JOIN sessions s ON s.id = l.session_id
       WHERE l.session_id = ? AND l.provider = ? AND s.user_id = ?`
    ).get(sessionId, provider, userId) as AgentSessionLinkRow | undefined;

    return row ? mapAgentSessionLinkRow(row) : null;
  }

  public upsertAgentSessionLink(
    userId: string,
    link: Omit<AgentSessionLink, "updatedAt">
  ): AgentSessionLink {
    this.assertSessionOwnership(userId, link.sessionId);
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO agent_session_links (
        session_id, provider, provider_session_id, synced_seq, state, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, provider) DO UPDATE SET
        provider_session_id = excluded.provider_session_id,
        synced_seq = excluded.synced_seq,
        state = excluded.state,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at`
    ).run(
      link.sessionId,
      link.provider,
      link.providerSessionId,
      link.syncedSeq,
      link.state,
      link.lastError ?? null,
      now
    );

    const row = this.getAgentSessionLink(userId, link.sessionId, link.provider);
    if (!row) {
      throw new Error("agent_session_link_upsert_failed");
    }
    return row;
  }

  public markAgentSessionLinkBroken(
    userId: string,
    sessionId: string,
    provider: AgentSessionLink["provider"],
    errorMessage: string
  ): AgentSessionLink | null {
    this.assertSessionOwnership(userId, sessionId);
    const now = Date.now();
    this.db.prepare(
      `UPDATE agent_session_links
       SET state = 'BROKEN', last_error = ?, updated_at = ?
       WHERE session_id = ? AND provider = ?`
    ).run(errorMessage.slice(0, 1_000), now, sessionId, provider);

    return this.getAgentSessionLink(userId, sessionId, provider);
  }

  public getSessionMemory(
    userId: string,
    sessionId: string,
    kind: SessionMemoryKind
  ): SessionMemory | null {
    const row = this.db.prepare(
      `SELECT m.session_id, m.kind, m.content, m.source_seq_start, m.source_seq_end, m.updated_at
       FROM session_memories m
       JOIN sessions s ON s.id = m.session_id
       WHERE m.session_id = ? AND m.kind = ? AND s.user_id = ?`
    ).get(sessionId, kind, userId) as SessionMemoryRow | undefined;

    return row ? mapSessionMemoryRow(row) : null;
  }

  public upsertSessionMemory(
    userId: string,
    input: Omit<SessionMemory, "updatedAt">
  ): SessionMemory {
    this.assertSessionOwnership(userId, input.sessionId);
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO session_memories (
        session_id, kind, content, source_seq_start, source_seq_end, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, kind) DO UPDATE SET
        content = excluded.content,
        source_seq_start = excluded.source_seq_start,
        source_seq_end = excluded.source_seq_end,
        updated_at = excluded.updated_at`
    ).run(
      input.sessionId,
      input.kind,
      input.content,
      input.sourceSeqStart,
      input.sourceSeqEnd,
      now
    );

    const row = this.getSessionMemory(userId, input.sessionId, input.kind);
    if (!row) {
      throw new Error("session_memory_upsert_failed");
    }
    return row;
  }

  public appendAuditEvent(input: {
    userId?: string | undefined;
    eventType: string;
    level: AuditLevel;
    route?: string | undefined;
    method?: string | undefined;
    statusCode?: number | undefined;
    ip?: string | undefined;
    details?: Record<string, unknown> | undefined;
  }): AuditEvent {
    const id = randomUUID();
    const now = Date.now();
    const detailsJson = input.details ? JSON.stringify(input.details).slice(0, 8_000) : null;

    this.db.prepare(
      `INSERT INTO audit_events (
        id, user_id, event_type, level, route, method, status_code, ip, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.userId ?? null,
      input.eventType.slice(0, 120),
      input.level,
      input.route?.slice(0, 240) ?? null,
      input.method?.slice(0, 20) ?? null,
      input.statusCode ?? null,
      input.ip?.slice(0, 120) ?? null,
      detailsJson,
      now
    );

    const row = this.db.prepare(
      `SELECT id, user_id, event_type, level, route, method, status_code, ip, details_json, created_at
       FROM audit_events
       WHERE id = ?`
    ).get(id) as AuditEventRow | undefined;

    if (!row) {
      throw new Error("audit_event_insert_failed");
    }
    return mapAuditEventRow(row);
  }

  public listAuditEvents(userId: string, limit: number, eventType?: string): AuditEvent[] {
    if (eventType) {
      const rows = this.db.prepare(
        `SELECT id, user_id, event_type, level, route, method, status_code, ip, details_json, created_at
         FROM audit_events
         WHERE user_id = ? AND event_type = ?
         ORDER BY created_at DESC
         LIMIT ?`
      ).all(userId, eventType, limit) as unknown as AuditEventRow[];
      return rows.map(mapAuditEventRow);
    }

    const rows = this.db.prepare(
      `SELECT id, user_id, event_type, level, route, method, status_code, ip, details_json, created_at
       FROM audit_events
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    ).all(userId, limit) as unknown as AuditEventRow[];
    return rows.map(mapAuditEventRow);
  }

  public purgeExpiredData(userId: string, input: PurgeExpiredDataInput): PurgeExpiredDataResult {
    const sessionsCount = input.includeSessions
      ? readCount(
          this.db.prepare(
            "SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND updated_at < ?"
          ).get(userId, input.sessionCutoffMs) as { count: number }
        )
      : 0;

    const messagesCount = input.includeSessions
      ? readCount(
          this.db.prepare(
            `SELECT COUNT(*) AS count
             FROM messages
             WHERE user_id = ?
               AND session_id IN (
                 SELECT id FROM sessions WHERE user_id = ? AND updated_at < ?
               )`
          ).get(userId, userId, input.sessionCutoffMs) as { count: number }
        )
      : 0;

    const linksCount = input.includeSessions
      ? readCount(
          this.db.prepare(
            `SELECT COUNT(*) AS count
             FROM agent_session_links
             WHERE session_id IN (
               SELECT id FROM sessions WHERE user_id = ? AND updated_at < ?
             )`
          ).get(userId, input.sessionCutoffMs) as { count: number }
        )
      : 0;

    const memoriesCount = input.includeSessions
      ? readCount(
          this.db.prepare(
            `SELECT COUNT(*) AS count
             FROM session_memories
             WHERE session_id IN (
               SELECT id FROM sessions WHERE user_id = ? AND updated_at < ?
             )`
          ).get(userId, input.sessionCutoffMs) as { count: number }
        )
      : 0;

    const auditCount = input.includeAudit
      ? readCount(
          this.db.prepare(
            "SELECT COUNT(*) AS count FROM audit_events WHERE user_id = ? AND created_at < ?"
          ).get(userId, input.auditCutoffMs) as { count: number }
        )
      : 0;

    if (!input.dryRun) {
      this.db.exec("BEGIN");
      try {
        if (input.includeAudit) {
          this.db.prepare(
            "DELETE FROM audit_events WHERE user_id = ? AND created_at < ?"
          ).run(userId, input.auditCutoffMs);
        }
        if (input.includeSessions) {
          this.db.prepare(
            "DELETE FROM sessions WHERE user_id = ? AND updated_at < ?"
          ).run(userId, input.sessionCutoffMs);
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }

    return {
      dryRun: input.dryRun,
      includeSessions: input.includeSessions,
      includeAudit: input.includeAudit,
      sessionCutoffMs: input.sessionCutoffMs,
      auditCutoffMs: input.auditCutoffMs,
      counts: {
        sessions: sessionsCount,
        messages: messagesCount,
        agentSessionLinks: linksCount,
        sessionMemories: memoriesCount,
        auditEvents: auditCount
      },
      executedAt: Date.now()
    };
  }

  private ensureDefaultModels(userId: string): void {
    const now = Date.now();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO models (
        id, user_id, adapter, label, enabled, is_default, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 0, ?, ?)`
    );

    for (const adapter of NATIVE_MODEL_ADAPTERS) {
      insert.run("auto", userId, adapter, "Auto (CLI default)", now, now);
    }

    for (const adapter of NATIVE_MODEL_ADAPTERS) {
      const rows = this.db.prepare(
        `SELECT id, enabled, is_default
         FROM models
         WHERE user_id = ? AND adapter = ?
         ORDER BY updated_at DESC, id ASC`
      ).all(userId, adapter) as Array<{
        id: string;
        enabled: number;
        is_default: number;
      }>;

      if (rows.length === 0) {
        continue;
      }

      let enabledRows = rows.filter((row) => row.enabled === 1);
      if (enabledRows.length === 0) {
        const firstId = rows[0]?.id;
        if (firstId) {
          this.db
            .prepare("UPDATE models SET enabled = 1, updated_at = ? WHERE user_id = ? AND adapter = ? AND id = ?")
            .run(now, userId, adapter, firstId);
          enabledRows = rows.map((row) =>
            row.id === firstId
              ? {
                  ...row,
                  enabled: 1
                }
              : row
          );
        }
      }

      const defaultEnabledRows = enabledRows.filter((row) => row.is_default === 1);
      const fallbackId = (defaultEnabledRows[0] ?? enabledRows[0] ?? rows[0])?.id;
      if (!fallbackId) {
        continue;
      }

      const needsNormalization =
        defaultEnabledRows.length !== 1 || defaultEnabledRows[0]?.id !== fallbackId;
      if (needsNormalization) {
        this.db
          .prepare("UPDATE models SET is_default = 0, updated_at = ? WHERE user_id = ? AND adapter = ?")
          .run(now, userId, adapter);
        this.db
          .prepare(
            "UPDATE models SET is_default = 1, enabled = 1, updated_at = ? WHERE user_id = ? AND adapter = ? AND id = ?"
          )
          .run(now, userId, adapter, fallbackId);
      }
    }
  }

  private getNextSeq(userId: string, sessionId: string): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE user_id = ? AND session_id = ?"
    ).get(userId, sessionId) as { seq: number };
    return row.seq + 1;
  }

  private assertSessionOwnership(userId: string, sessionId: string): void {
    const row = this.db.prepare(
      "SELECT id FROM sessions WHERE id = ? AND user_id = ?"
    ).get(sessionId, userId) as { id: string } | undefined;

    if (!row) {
      throw new Error("session_not_found");
    }
  }

  private linkMessageAttachments(
    userId: string,
    sessionId: string,
    messageId: string,
    attachmentIds: string[],
    now: number
  ): void {
    if (attachmentIds.length === 0) {
      return;
    }

    const available = this.listAttachmentsByIds(userId, sessionId, attachmentIds);
    if (available.length !== attachmentIds.length) {
      throw new Error("attachment_not_found_or_not_owned");
    }

    const link = this.db.prepare(
      `INSERT INTO message_attachments (
        message_id, attachment_id, ord, created_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(message_id, attachment_id) DO NOTHING`
    );

    attachmentIds.forEach((attachmentId, ord) => {
      link.run(messageId, attachmentId, ord, now);
    });
  }

  private getAttachmentRow(userId: string, attachmentId: string): AttachmentRow | undefined {
    return this.db.prepare(
      `SELECT
         id, user_id, session_id, storage_path, mime_type, file_name, byte_size, sha256, created_at, updated_at
       FROM attachments
       WHERE user_id = ? AND id = ?`
    ).get(userId, attachmentId) as AttachmentRow | undefined;
  }

  private getApprovalEventRowById(id: string): ApprovalEventRow | undefined {
    return this.db.prepare(
      `SELECT
         id, user_id, session_id, run_id, adapter, thread_id, turn_id,
         approval_request_id, kind, title, payload_json, available_decisions_json,
         status, decision_json, decided_by, decision_reason, requested_at,
         decided_at, expires_at, created_at, updated_at
       FROM approval_events
       WHERE id = ?`
    ).get(id) as ApprovalEventRow | undefined;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        starred INTEGER NOT NULL DEFAULT 0,
        last_adapter TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        adapter TEXT,
        model TEXT,
        content TEXT NOT NULL,
        parts_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(session_id, seq)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
      CREATE INDEX IF NOT EXISTS idx_messages_user_session_seq ON messages(user_id, session_id, seq);

      CREATE TABLE IF NOT EXISTS session_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        adapter TEXT NOT NULL,
        model TEXT,
        status TEXT NOT NULL,
        user_message_id TEXT NOT NULL,
        assistant_message_id TEXT,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(user_message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY(assistant_message_id) REFERENCES messages(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_session_runs_user_session_created
        ON session_runs(user_id, session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_runs_user_status
        ON session_runs(user_id, status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS models (
        id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        adapter TEXT NOT NULL,
        label TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        reasoning_effort TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, adapter, id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_models_user_adapter
        ON models(user_id, adapter, is_default DESC, label ASC);

      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_name TEXT,
        byte_size INTEGER NOT NULL,
        sha256 TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_attachments_user_session_created
        ON attachments(user_id, session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_attachments_sha256
        ON attachments(sha256);

      CREATE TABLE IF NOT EXISTS message_attachments (
        message_id TEXT NOT NULL,
        attachment_id TEXT NOT NULL,
        ord INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY(message_id, attachment_id),
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_message_attachments_message_ord
        ON message_attachments(message_id, ord ASC);
      CREATE INDEX IF NOT EXISTS idx_message_attachments_attachment
        ON message_attachments(attachment_id);

      CREATE TABLE IF NOT EXISTS agent_session_links (
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_session_id TEXT NOT NULL,
        synced_seq INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'READY',
        last_error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, provider),
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_memories (
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source_seq_start INTEGER NOT NULL,
        source_seq_end INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(session_id, kind),
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        event_type TEXT NOT NULL,
        level TEXT NOT NULL,
        route TEXT,
        method TEXT,
        status_code INTEGER,
        ip TEXT,
        details_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_events_user_created
        ON audit_events(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_events_type_created
        ON audit_events(event_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS approval_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        adapter TEXT NOT NULL,
        thread_id TEXT,
        turn_id TEXT,
        approval_request_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT,
        payload_json TEXT NOT NULL,
        available_decisions_json TEXT NOT NULL,
        status TEXT NOT NULL,
        decision_json TEXT,
        decided_by TEXT,
        decision_reason TEXT,
        requested_at INTEGER NOT NULL,
        decided_at INTEGER,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(run_id) REFERENCES session_runs(id) ON DELETE CASCADE,
        UNIQUE(run_id, approval_request_id)
      );

      CREATE INDEX IF NOT EXISTS idx_approval_events_user_session_requested
        ON approval_events(user_id, session_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_approval_events_run_requested
        ON approval_events(run_id, requested_at ASC);
      CREATE INDEX IF NOT EXISTS idx_approval_events_user_status_expires
        ON approval_events(user_id, status, expires_at ASC);

      CREATE TABLE IF NOT EXISTS run_events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ts INTEGER NOT NULL,
        data_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY(run_id) REFERENCES session_runs(id) ON DELETE CASCADE,
        UNIQUE(event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_run_events_run_seq
        ON run_events(run_id, seq ASC);
      CREATE INDEX IF NOT EXISTS idx_run_events_user_session_seq
        ON run_events(user_id, session_id, seq ASC);
    `);

    this.ensureColumnExists("sessions", "last_adapter", "TEXT");
    this.ensureColumnExists("messages", "adapter", "TEXT");
    this.ensureColumnExists("messages", "model", "TEXT");
    this.ensureColumnExists("messages", "parts_json", "TEXT");
    this.ensureColumnExists("session_runs", "model", "TEXT");
    this.ensureColumnExists("models", "reasoning_effort", "TEXT");
    this.db
      .prepare(
        "UPDATE messages SET adapter = ? WHERE adapter IS NULL OR LENGTH(TRIM(adapter)) = 0"
      )
      .run("codex");
  }

  private seedUsers(users: BridgeUserAccount[]): void {
    const insert = this.db.prepare(
      `INSERT INTO users (id, name, token_hash)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         token_hash = excluded.token_hash`
    );
    for (const user of users) {
      insert.run(user.id, user.name, user.token ? hashToken(user.token) : null);
      this.ensureDefaultModels(user.id);
    }
  }

  private ensureColumnExists(tableName: string, columnName: string, definition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function mapSessionRow(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    starred: row.starred === 1,
    ...(row.last_adapter ? { lastAdapter: row.last_adapter } : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at
  };
}

function mapMessageRow(row: MessageRow): ChatMessage {
  const parts = parseMessageParts(row.parts_json);
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    role: row.role,
    ...(row.adapter ? { adapter: row.adapter } : {}),
    ...(row.model ? { model: row.model } : {}),
    content: row.content,
    ...(parts ? { parts } : {}),
    createdAt: row.created_at
  };
}

function mapSessionRunRow(row: SessionRunRow): BridgeSessionRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    adapter: row.adapter,
    ...(row.model ? { model: row.model } : {}),
    status: row.status,
    userMessageId: row.user_message_id,
    ...(row.assistant_message_id ? { assistantMessageId: row.assistant_message_id } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    createdAt: row.created_at,
    ...(typeof row.started_at === "number" ? { startedAt: row.started_at } : {}),
    ...(typeof row.finished_at === "number" ? { finishedAt: row.finished_at } : {}),
    updatedAt: row.updated_at
  };
}

function mapModelRow(row: ModelRow): BridgeModel {
  return {
    id: row.id,
    adapter: row.adapter,
    label: row.label,
    enabled: row.enabled === 1,
    isDefault: row.is_default === 1,
    ...(row.adapter === "codex" && row.reasoning_effort
      ? { modelReasoningEffort: row.reasoning_effort }
      : {})
  };
}

function mapAttachmentRow(row: AttachmentRow): StoredAttachment {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    ...(row.file_name ? { fileName: row.file_name } : {}),
    sizeBytes: row.byte_size,
    ...(row.sha256 ? { sha256: row.sha256 } : {}),
    createdAt: row.created_at
  };
}

function parseMessageParts(raw: string | null): ChatMessagePart[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const normalized: ChatMessagePart[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        normalized.push({
          type: "text",
          text: record.text
        });
        continue;
      }

      if (record.type === "image" && record.attachment && typeof record.attachment === "object") {
        const attachmentRecord = record.attachment as Record<string, unknown>;
        if (
          typeof attachmentRecord.id === "string" &&
          typeof attachmentRecord.mimeType === "string" &&
          typeof attachmentRecord.sizeBytes === "number" &&
          typeof attachmentRecord.createdAt === "number"
        ) {
          normalized.push({
            type: "image",
            attachment: {
              id: attachmentRecord.id,
              mimeType: attachmentRecord.mimeType,
              sizeBytes: attachmentRecord.sizeBytes,
              ...(typeof attachmentRecord.fileName === "string"
                ? { fileName: attachmentRecord.fileName }
                : {}),
              ...(typeof attachmentRecord.url === "string"
                ? { url: attachmentRecord.url }
                : {}),
              createdAt: attachmentRecord.createdAt
            }
          });
        }
      }
    }

    return normalized.length > 0 ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMessageParts(parts: ChatMessagePart[] | undefined): ChatMessagePart[] | undefined {
  if (!parts || parts.length === 0) {
    return undefined;
  }
  const normalized: ChatMessagePart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      normalized.push({
        type: "text",
        text: part.text
      });
      continue;
    }
    normalized.push({
      type: "image",
      attachment: {
        id: part.attachment.id,
        mimeType: part.attachment.mimeType,
        sizeBytes: part.attachment.sizeBytes,
        ...(part.attachment.fileName ? { fileName: part.attachment.fileName } : {}),
        ...(part.attachment.url ? { url: part.attachment.url } : {}),
        createdAt: part.attachment.createdAt
      }
    });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function collectAttachmentIdsFromParts(parts: ChatMessagePart[] | undefined): string[] {
  if (!parts || parts.length === 0) {
    return [];
  }
  const ids: string[] = [];
  for (const part of parts) {
    if (part.type !== "image") {
      continue;
    }
    const id = part.attachment.id.trim();
    if (!id) {
      continue;
    }
    ids.push(id);
  }
  return [...new Set(ids)];
}

function normalizeModelsInput(models: BridgeModel[]): BridgeModel[] {
  const dedup = new Map<string, BridgeModel>();

  for (const item of models) {
    const id = item.id.trim();
    const label = item.label.trim();
    if (!id || !label) {
      continue;
    }
    const key = `${item.adapter}::${id}`;
    dedup.set(key, {
      id,
      adapter: item.adapter,
      label,
      enabled: item.enabled,
      isDefault: item.isDefault,
      ...(item.adapter === "codex" && item.modelReasoningEffort
        ? { modelReasoningEffort: item.modelReasoningEffort }
        : {})
    });
  }

  const grouped = new Map<BridgeAdapter, BridgeModel[]>();
  for (const model of dedup.values()) {
    const list = grouped.get(model.adapter) ?? [];
    list.push(model);
    grouped.set(model.adapter, list);
  }

  const normalized: BridgeModel[] = [];
  for (const [adapter, list] of grouped.entries()) {
    if (list.length === 0) {
      continue;
    }

    let enabledList = list.filter((item) => item.enabled);
    if (enabledList.length === 0) {
      const first = list[0];
      if (first) {
        first.enabled = true;
      }
      enabledList = list.filter((item) => item.enabled);
    }

    const preferredDefault = list.find((item) => item.isDefault && item.enabled);
    const resolvedDefault = preferredDefault ?? enabledList[0];
    for (const item of list) {
      normalized.push({
        ...item,
        adapter,
        isDefault: item.id === resolvedDefault?.id,
        enabled: item.enabled || item.id === resolvedDefault?.id
      });
    }
  }

  return normalized.sort((a, b) => {
    const adapterCmp = a.adapter.localeCompare(b.adapter);
    if (adapterCmp !== 0) {
      return adapterCmp;
    }
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return a.id.localeCompare(b.id);
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mapAgentSessionLinkRow(row: AgentSessionLinkRow): AgentSessionLink {
  return {
    sessionId: row.session_id,
    provider: row.provider,
    providerSessionId: row.provider_session_id,
    syncedSeq: row.synced_seq,
    state: row.state,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    updatedAt: row.updated_at
  };
}

function mapSessionMemoryRow(row: SessionMemoryRow): SessionMemory {
  return {
    sessionId: row.session_id,
    kind: row.kind,
    content: row.content,
    sourceSeqStart: row.source_seq_start,
    sourceSeqEnd: row.source_seq_end,
    updatedAt: row.updated_at
  };
}

function mapAuditEventRow(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    ...(row.user_id ? { userId: row.user_id } : {}),
    eventType: row.event_type,
    level: row.level,
    ...(row.route ? { route: row.route } : {}),
    ...(row.method ? { method: row.method } : {}),
    ...(typeof row.status_code === "number" ? { statusCode: row.status_code } : {}),
    ...(row.ip ? { ip: row.ip } : {}),
    ...(row.details_json ? { details: parseAuditDetails(row.details_json) } : {}),
    createdAt: row.created_at
  };
}

function mapApprovalEventRow(row: ApprovalEventRow): BridgeRunApproval {
  const payload = parseJsonRecord(row.payload_json);
  const availableDecisions = parseJsonArray(row.available_decisions_json);
  const decision = row.decision_json ? parseJsonUnknown(row.decision_json) : undefined;

  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    runId: row.run_id,
    adapter: row.adapter,
    ...(row.thread_id ? { threadId: row.thread_id } : {}),
    ...(row.turn_id ? { turnId: row.turn_id } : {}),
    approvalRequestId: row.approval_request_id,
    kind: row.kind,
    ...(row.title ? { title: row.title } : {}),
    payload,
    availableDecisions,
    status: row.status,
    ...(decision !== undefined ? { decision } : {}),
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.decision_reason ? { decisionReason: row.decision_reason } : {}),
    requestedAt: row.requested_at,
    ...(typeof row.decided_at === "number" ? { decidedAt: row.decided_at } : {}),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRunEventRow(row: RunEventRow): BridgeRunStreamEvent {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    runId: row.run_id,
    type: row.type as BridgeRunStreamEvent["type"],
    ts: row.ts,
    data: parseJsonUnknown(row.data_json) as BridgeRunStreamEvent["data"]
  } as BridgeRunStreamEvent;
}

function parseAuditDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // ignore parse errors and return fallback
  }
  return { raw };
}

function readCount(row: { count: number }): number {
  return Number.isFinite(row.count) ? row.count : 0;
}

function stringifyJsonSafe(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "json_stringify_failed" });
  }
}

function parseJsonUnknown(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function parseJsonArray(raw: string): unknown[] {
  const parsed = parseJsonUnknown(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  const parsed = parseJsonUnknown(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { raw };
}
