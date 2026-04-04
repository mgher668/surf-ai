import type { BridgeChatRequest } from "@surf-ai/shared";
import type { AgentAdapter } from "./types";

export class MockAdapter implements AgentAdapter {
  public readonly name = "mock" as const;

  public async generate(request: BridgeChatRequest): Promise<string> {
    const lastUser = [...request.messages].reverse().find((item) => item.role === "user")?.content ?? "";
    return `This is a mock response. Received: ${lastUser.slice(0, 240)}`;
  }
}
