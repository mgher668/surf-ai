import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  BridgeAdapter,
  BridgeSessionRun,
  ChatMessage,
  ChatSession,
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
  content: string;
  created_at: number;
}

interface SessionRunRow {
  id: string;
  session_id: string;
  user_id: string;
  adapter: BridgeAdapter;
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

  public listMessages(userId: string, sessionId: string, afterSeq: number, limit: number): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, seq, role, content, created_at
       FROM messages
       WHERE user_id = ? AND session_id = ? AND seq > ?
       ORDER BY seq ASC
       LIMIT ?`
    ).all(userId, sessionId, afterSeq, limit) as unknown as MessageRow[];
    return rows.map(mapMessageRow);
  }

  public listAllMessagesBySession(userId: string, sessionId: string): ChatMessage[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, seq, role, content, created_at
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
    content: string
  ): ChatMessage {
    const now = Date.now();
    const id = randomUUID();

    const nextSeq = this.getNextSeq(userId, sessionId);
    this.db.prepare(
      `INSERT INTO messages (
        id, session_id, user_id, seq, role, content, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, userId, nextSeq, role, content, now);

    this.db.prepare(
      "UPDATE sessions SET updated_at = ?, last_active_at = ?, status = 'ACTIVE' WHERE id = ? AND user_id = ?"
    ).run(now, now, sessionId, userId);

    return {
      id,
      sessionId,
      seq: nextSeq,
      role,
      content,
      createdAt: now
    };
  }

  public createSessionRun(input: {
    userId: string;
    sessionId: string;
    adapter: BridgeAdapter;
    status: SessionRunStatus;
    userMessageId: string;
  }): BridgeSessionRun {
    this.assertSessionOwnership(input.userId, input.sessionId);

    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO session_runs (
        id, session_id, user_id, adapter, status, user_message_id,
        assistant_message_id, error_message, created_at, started_at, finished_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?)`
    ).run(
      id,
      input.sessionId,
      input.userId,
      input.adapter,
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
         r.id, r.session_id, r.user_id, r.adapter, r.status, r.user_message_id,
         r.assistant_message_id, r.error_message, r.created_at, r.started_at, r.finished_at, r.updated_at
       FROM session_runs r
       WHERE r.id = ? AND r.user_id = ?`
    ).get(runId, userId) as SessionRunRow | undefined;

    return row ? mapSessionRunRow(row) : null;
  }

  public listSessionRuns(userId: string, sessionId: string, limit = 20): BridgeSessionRun[] {
    const rows = this.db.prepare(
      `SELECT
         r.id, r.session_id, r.user_id, r.adapter, r.status, r.user_message_id,
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
         r.id, r.session_id, r.user_id, r.adapter, r.status, r.user_message_id,
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
        content TEXT NOT NULL,
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
    `);

    this.ensureColumnExists("sessions", "last_adapter", "TEXT");
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
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    createdAt: row.created_at
  };
}

function mapSessionRunRow(row: SessionRunRow): BridgeSessionRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    adapter: row.adapter,
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
