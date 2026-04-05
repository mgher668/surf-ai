import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ChatMessage, ChatSession, MessageRole, SessionStatus } from "@surf-ai/shared";
import type { BridgeUserAccount } from "./config";

interface SessionRow {
  id: string;
  title: string;
  starred: number;
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
      `SELECT id, title, starred, status, created_at, updated_at, last_active_at
       FROM sessions
       WHERE user_id = ?
       ORDER BY updated_at DESC`
    ).all(userId) as unknown as SessionRow[];
    return rows.map(mapSessionRow);
  }

  public getSession(userId: string, sessionId: string): ChatSession | null {
    const row = this.db.prepare(
      `SELECT id, title, starred, status, created_at, updated_at, last_active_at
       FROM sessions
       WHERE id = ? AND user_id = ?`
    ).get(sessionId, userId) as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  public updateSessionStar(userId: string, sessionId: string, starred: boolean): ChatSession | null {
    const now = Date.now();
    this.db.prepare(
      "UPDATE sessions SET starred = ?, updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(starred ? 1 : 0, now, sessionId, userId);
    return this.getSession(userId, sessionId);
  }

  public closeSession(userId: string, sessionId: string): ChatSession | null {
    const now = Date.now();
    this.db.prepare(
      "UPDATE sessions SET status = 'CLOSED', updated_at = ? WHERE id = ? AND user_id = ?"
    ).run(now, sessionId, userId);
    return this.getSession(userId, sessionId);
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

  private getNextSeq(userId: string, sessionId: string): number {
    const row = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS seq FROM messages WHERE user_id = ? AND session_id = ?"
    ).get(userId, sessionId) as { seq: number };
    return row.seq + 1;
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
    `);
  }

  private seedUsers(users: BridgeUserAccount[]): void {
    const insert = this.db.prepare(
      "INSERT OR REPLACE INTO users (id, name, token_hash) VALUES (?, ?, ?)"
    );
    for (const user of users) {
      insert.run(user.id, user.name, user.token ? hashToken(user.token) : null);
    }
  }
}

function mapSessionRow(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    starred: row.starred === 1,
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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
