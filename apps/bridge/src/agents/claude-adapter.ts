import type { BridgeChatRequest } from "@surf-ai/shared";
import { buildPrompt } from "./prompt";
import type { AgentAdapter } from "./types";
import { runProcess } from "../core/process";

const CLAUDE_TIMEOUT_MS = 180_000;

interface ClaudeSessionResult {
  output: string;
  providerSessionId: string;
}

interface ClaudeJsonResultEvent {
  type?: unknown;
  is_error?: unknown;
  result?: unknown;
  session_id?: unknown;
}

export class ClaudeAdapter implements AgentAdapter {
  public readonly name = "claude" as const;

  public async generate(request: BridgeChatRequest, signal?: AbortSignal): Promise<string> {
    const prompt = buildPrompt(request);
    const modelArg = normalizeModel(request.model);
    const result = await runProcess(
      "claude",
      ["-p", ...(modelArg ? ["--model", modelArg] : []), prompt],
      CLAUDE_TIMEOUT_MS,
      signal
    );

    if (result.code !== 0) {
      throw new Error(result.stderr || `claude exited with code ${result.code ?? "unknown"}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      throw new Error("claude returned empty output");
    }
    return output;
  }

  public async generateWithSession(
    request: BridgeChatRequest,
    providerSessionId: string,
    signal?: AbortSignal
  ): Promise<ClaudeSessionResult> {
    const prompt = buildPrompt(request);
    const modelArg = normalizeModel(request.model);
    const result = await runProcess(
      "claude",
      [
        "-p",
        "--output-format",
        "json",
        ...(modelArg ? ["--model", modelArg] : []),
        "--session-id",
        providerSessionId,
        prompt
      ],
      CLAUDE_TIMEOUT_MS,
      signal
    );

    const parsed = parseClaudeJsonResult(result.code, result.stdout, result.stderr, "claude --session-id");
    return {
      output: parsed.output,
      providerSessionId: parsed.providerSessionId ?? providerSessionId
    };
  }

  public async resumeWithSession(
    providerSessionId: string,
    prompt: string,
    model: string | undefined,
    signal?: AbortSignal
  ): Promise<string> {
    const modelArg = normalizeModel(model);
    const result = await runProcess(
      "claude",
      [
        "-p",
        "--output-format",
        "json",
        ...(modelArg ? ["--model", modelArg] : []),
        "--resume",
        providerSessionId,
        prompt
      ],
      CLAUDE_TIMEOUT_MS,
      signal
    );

    const parsed = parseClaudeJsonResult(result.code, result.stdout, result.stderr, "claude --resume");
    return parsed.output;
  }
}

function parseClaudeJsonResult(
  code: number | null,
  stdout: string,
  stderr: string,
  label: string
): { output: string; providerSessionId?: string } {
  if (code !== 0) {
    throw new Error(stderr || `${label} exited with code ${code ?? "unknown"}`);
  }

  const parsedEvent = findLastClaudeResultEvent(stdout);
  if (!parsedEvent) {
    throw new Error(`${label} returned no parsable JSON result`);
  }

  if (parsedEvent.is_error === true) {
    const message =
      typeof parsedEvent.result === "string"
        ? parsedEvent.result
        : `${label} returned is_error=true`;
    throw new Error(message);
  }

  const output = typeof parsedEvent.result === "string" ? parsedEvent.result.trim() : "";
  if (!output) {
    throw new Error(`${label} returned empty result`);
  }

  const providerSessionId =
    typeof parsedEvent.session_id === "string" ? parsedEvent.session_id : undefined;

  return { output, ...(providerSessionId ? { providerSessionId } : {}) };
}

function findLastClaudeResultEvent(stdout: string): ClaudeJsonResultEvent | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as ClaudeJsonResultEvent;
      if (parsed && parsed.type === "result") {
        return parsed;
      }
    } catch {
      // Ignore non-json lines.
    }
  }

  try {
    const parsed = JSON.parse(stdout) as ClaudeJsonResultEvent;
    if (parsed && parsed.type === "result") {
      return parsed;
    }
  } catch {
    // Ignore parse error.
  }

  return null;
}

function normalizeModel(model: string | undefined): string | undefined {
  if (!model) {
    return undefined;
  }
  const normalized = model.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.toLowerCase() === "auto") {
    return undefined;
  }
  return normalized;
}
