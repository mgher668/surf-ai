import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeChatRequest } from "@surf-ai/shared";
import { buildPrompt } from "./prompt";
import type { AgentAdapter } from "./types";
import { runProcess } from "../core/process";

const CODEX_TIMEOUT_MS = 0;
const DEFAULT_SESSION_INDEX_PATH = join(homedir(), ".codex", "session_index.jsonl");

interface CodexResult {
  output: string;
  providerSessionId: string;
}

interface SessionIndexEntry {
  id: string;
  updatedAtMs: number;
}

interface ExecOnceResult {
  output: string;
  providerSessionId?: string;
}

interface CodexJsonEvent {
  type?: unknown;
  message?: unknown;
  thread_id?: unknown;
}

export class CodexAdapter implements AgentAdapter {
  public readonly name = "codex" as const;
  private readonly sessionIndexPath: string;
  private queue: Promise<void> = Promise.resolve();

  public constructor(sessionIndexPath = DEFAULT_SESSION_INDEX_PATH) {
    this.sessionIndexPath = sessionIndexPath;
  }

  public async generate(request: BridgeChatRequest, signal?: AbortSignal): Promise<string> {
    const result = await this.generateWithSession(request, signal);
    return result.output;
  }

  public async generateWithSession(request: BridgeChatRequest, signal?: AbortSignal): Promise<CodexResult> {
    return await this.withLock(async () => {
      const before = await this.readSessionIndexMap();
      const prompt = buildPrompt(request);
      const execResult = await this.execOnce(prompt, signal);
      const providerSessionId =
        execResult.providerSessionId ??
        pickLatestUpdatedSessionId(before, await this.readSessionIndexMap());

      if (!providerSessionId) {
        throw new Error(
          "codex_session_id_not_found: failed to infer session id from codex json events and ~/.codex/session_index.jsonl"
        );
      }

      return {
        output: execResult.output,
        providerSessionId
      };
    });
  }

  public async resumeWithSession(
    providerSessionId: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<string> {
    return await this.withLock(async () => {
      const result = await runProcess(
        "codex",
        ["exec", "resume", "--skip-git-repo-check", providerSessionId, prompt],
        CODEX_TIMEOUT_MS,
        signal
      );
      return extractOutput(result.code, result.stdout, result.stderr, "codex resume");
    });
  }

  private async execOnce(prompt: string, signal?: AbortSignal): Promise<ExecOnceResult> {
    const tmpDir = await mkdtemp(join(tmpdir(), "surf-ai-codex-"));
    const outputPath = join(tmpDir, "last-message.txt");
    try {
      const result = await runProcess(
        "codex",
        ["exec", "--skip-git-repo-check", "--json", "--output-last-message", outputPath, prompt],
        CODEX_TIMEOUT_MS,
        signal
      );
      const output = await extractCodexOutput(result.code, result.stdout, result.stderr, outputPath, "codex exec");
      const providerSessionId = extractThreadIdFromJsonl(result.stdout);
      return {
        output,
        ...(providerSessionId ? { providerSessionId } : {})
      };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
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

async function extractCodexOutput(
  code: number | null,
  stdout: string,
  stderr: string,
  outputPath: string,
  label: string
): Promise<string> {
  if (code !== 0) {
    const message = extractLastCodexErrorMessage(stdout);
    throw new Error(message || stderr || `${label} exited with code ${code ?? "unknown"}`);
  }

  try {
    const output = (await readFile(outputPath, "utf8")).trim();
    if (output) {
      return output;
    }
  } catch {
    // Fallback to stdout parsing.
  }

  const outputFromJson = extractLastCodexOutputFromJsonl(stdout);
  if (outputFromJson) {
    return outputFromJson;
  }

  throw new Error(`${label} returned empty output`);
}

function extractThreadIdFromJsonl(stdout: string): string | undefined {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as CodexJsonEvent;
      if (parsed.type === "thread.started" && typeof parsed.thread_id === "string" && parsed.thread_id.trim()) {
        return parsed.thread_id;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return undefined;
}

function extractLastCodexErrorMessage(stdout: string): string | undefined {
  const events = parseCodexJsonLines(stdout);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) {
      continue;
    }
    if (event.type === "error" && typeof event.message === "string" && event.message.trim()) {
      return event.message;
    }
  }
  return undefined;
}

function extractLastCodexOutputFromJsonl(stdout: string): string | undefined {
  const events = parseCodexJsonLines(stdout);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) {
      continue;
    }
    const record = event as Record<string, unknown>;
    const content = record["content"] ?? record["text"] ?? record["result"];
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
  }
  return undefined;
}

function parseCodexJsonLines(stdout: string): CodexJsonEvent[] {
  const events: CodexJsonEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as CodexJsonEvent;
      events.push(parsed);
    } catch {
      // Ignore parse errors.
    }
  }
  return events;
}
