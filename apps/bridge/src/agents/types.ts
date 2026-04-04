import type { BridgeChatRequest } from "@surf-ai/shared";

export interface AgentAdapter {
  readonly name: BridgeChatRequest["adapter"];
  generate(request: BridgeChatRequest): Promise<string>;
}
