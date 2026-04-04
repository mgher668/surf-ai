import type { BridgeChatRequest } from "@surf-ai/shared";
import { buildPrompt } from "./prompt";
import type { AgentAdapter } from "./types";
import { runProcess } from "../core/process";

export class ClaudeAdapter implements AgentAdapter {
  public readonly name = "claude" as const;

  public async generate(request: BridgeChatRequest): Promise<string> {
    const prompt = buildPrompt(request);

    const result = await runProcess(
      "claude",
      ["-p", prompt],
      120_000
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
}
