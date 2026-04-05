import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BridgeChatRequest } from "@surf-ai/shared";
import { buildPrompt } from "./prompt";
import type { AgentAdapter } from "./types";
import { runProcess } from "../core/process";

const CODEX_TIMEOUT_MS = 120_000;
const DEFAULT_SESSION_INDEX_PATH = join(homedir(), ".codex", "session_index.jsonl");

interface CodexResult {
  output: string;
  providerSessionId: string;
}

interface SessionIndexEntry {
  id: string;
  updatedAtMs: number;
}

export class CodexAdapter implements AgentAdapter {
  public readonly name = "codex" as const;
  private readonly sessionIndexPath: string;
  private queue: Promise<void> = Promise.resolve();

  public constructor(sessionIndexPath = DEFAULT_SESSION_INDEX_PATH) {
    this.sessionIndexPath = sessionIndexPath;
  }

  public async generate(request: BridgeChatRequest): Promise<string> {
    const result = await this.generateWithSession(request);
    return result.output;
  }

  public async generateWithSession(request: BridgeChatRequest): Promise<CodexResult> {
    return await this.withLock(async () => {
      const before = await this.readSessionIndexMap();
      const prompt = buildPrompt(request);
      const output = await this.execOnce(prompt);
      const after = await this.readSessionIndexMap();
      const providerSessionId = pickLatestUpdatedSessionId(before, after);

      if (!providerSessionId) {
        throw new Error(
          "codex_session_id_not_found: failed to infer session id from ~/.codex/session_index.jsonl"
        );
      }

      return {
        output,
        providerSessionId
      };
    });
  }

  public async resumeWithSession(
    providerSessionId: string,
    prompt: string
  ): Promise<string> {
    return await this.withLock(async () => {
      const result = await runProcess(
        "codex",
        ["exec", "resume", "--skip-git-repo-check", providerSessionId, prompt],
        CODEX_TIMEOUT_MS
      );
      return extractOutput(result.code, result.stdout, result.stderr, "codex resume");
    });
  }

  private async execOnce(prompt: string): Promise<string> {
    const result = await runProcess(
      "codex",
      ["exec", "--skip-git-repo-check", prompt],
      CODEX_TIMEOUT_MS
    );
    return extractOutput(result.code, result.stdout, result.stderr, "codex");
  }

  private async readSessionIndexMap(): Promise<Map<string, SessionIndexEntry>> {
    try {
      const raw = await readFile(this.sessionIndexPath, "utf8");
      const map = new Map<string, SessionIndexEntry>();
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        try {
          const parsed = JSON.parse(trimmed) as {
            id?: unknown;
            updated_at?: unknown;
          };
          if (typeof parsed.id !== "string" || parsed.id.trim().length === 0) {
            continue;
          }
          const updatedAtMs =
            typeof parsed.updated_at === "string"
              ? Date.parse(parsed.updated_at)
              : Number.NaN;
          map.set(parsed.id, {
            id: parsed.id,
            updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : 0
          });
        } catch {
          // Skip malformed lines.
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

function pickLatestUpdatedSessionId(
  before: Map<string, SessionIndexEntry>,
  after: Map<string, SessionIndexEntry>
): string | null {
  let picked: SessionIndexEntry | null = null;
  for (const [id, item] of after.entries()) {
    const previous = before.get(id);
    if (previous && item.updatedAtMs <= previous.updatedAtMs) {
      continue;
    }
    if (!picked || item.updatedAtMs >= picked.updatedAtMs) {
      picked = item;
    }
  }
  return picked?.id ?? null;
}

function extractOutput(
  code: number | null,
  stdout: string,
  stderr: string,
  commandLabel: string
): string {
  if (code !== 0) {
    throw new Error(stderr || `${commandLabel} exited with code ${code ?? "unknown"}`);
  }

  const output = stdout.trim();
  if (!output) {
    throw new Error(`${commandLabel} returned empty output`);
  }
  return output;
}
