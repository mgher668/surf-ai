import type { BridgeChatRequest } from "@surf-ai/shared";
import type { OpenAICompatibleConfig } from "../core/config";
import { OpenAICompatibleClient } from "../core/openai-compatible-client";
import type { AgentAdapter } from "./types";

export class OpenAICompatibleAdapter implements AgentAdapter {
  public readonly name = "openai-compatible" as const;
  private readonly client: OpenAICompatibleClient;

  public constructor(config: OpenAICompatibleConfig) {
    this.client = new OpenAICompatibleClient(config);
  }

  public async generate(request: BridgeChatRequest, signal?: AbortSignal): Promise<string> {
    const result = await this.client.generate({
      messages: request.messages.map((message) => ({
        role: message.role === "system" || message.role === "assistant" ? message.role : "user",
        content: message.content
      })),
      ...(request.model ? { model: request.model } : {}),
      ...(request.context ? { context: request.context } : {}),
      ...(signal ? { signal } : {})
    });
    return result.output;
  }
}
