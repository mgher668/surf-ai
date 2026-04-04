import type { BridgeChatRequest } from "@surf-ai/shared";
import { buildPrompt } from "./prompt";
import type { AgentAdapter } from "./types";
import { runProcess } from "../core/process";

export class CodexAdapter implements AgentAdapter {
  public readonly name = "codex" as const;

  public async generate(request: BridgeChatRequest): Promise<string> {
    const prompt = buildPrompt(request);

    const result = await runProcess(
      "codex",
      ["exec", "--skip-git-repo-check", prompt],
      120_000
    );

    if (result.code !== 0) {
      throw new Error(result.stderr || `codex exited with code ${result.code ?? "unknown"}`);
    }

    const output = result.stdout.trim();
    if (!output) {
      throw new Error("codex returned empty output");
    }
    return output;
  }
}
