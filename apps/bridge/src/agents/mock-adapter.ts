import type { BridgeChatRequest } from "@surf-ai/shared";
import type { AgentAdapter } from "./types";
import { buildAgentTaskPayload } from "./task-payload";

export class MockAdapter implements AgentAdapter {
  public readonly name = "mock" as const;

  public async generate(request: BridgeChatRequest): Promise<string> {
    const payload = buildAgentTaskPayload(request);
    const contextTags: string[] = [];
    if (payload.pageContext?.selectedText?.content) {
      contextTags.push("selected");
    }
    if (payload.pageContext?.pageText?.content) {
      contextTags.push("page");
    }

    return [
      "This is a mock response.",
      `Received: ${payload.userRequest.content.slice(0, 240)}`,
      `ctx=${contextTags.join("+") || "none"}`,
      `history=${payload.conversation.messages.length}/${payload.conversation.totalMessages}`
    ].join(" ");
  }
}
