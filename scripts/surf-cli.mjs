#!/usr/bin/env node
import { argv, env, exit } from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:43127";

async function main() {
  const args = parseArgs(argv.slice(2));
  const command = args._[0] ?? "help";
  const baseUrl = String(args["base-url"] ?? env.SURF_AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const userId = String(args.user ?? env.SURF_AI_USER_ID ?? "local");
  const token = args.token ?? env.SURF_AI_TOKEN;
  const client = new SurfCliClient({ baseUrl, userId, token: typeof token === "string" ? token : undefined });

  if (command === "help" || args.help) {
    printHelp();
    return;
  }

  if (command === "sessions") {
    const sessions = await client.listSessions();
    for (const session of sessions) {
      console.log(`${session.id}\t${session.status}\t${session.updatedAt}\t${session.title}`);
    }
    return;
  }

  if (command === "send") {
    const message = readStringArg(args.message);
    if (!message) {
      throw new Error("send requires --message");
    }
    const adapter = String(args.adapter ?? env.SURF_AI_ADAPTER ?? "mock");
    const model = typeof args.model === "string" ? args.model : undefined;
    const sessionId = typeof args.session === "string"
      ? args.session
      : (await client.createSession(String(args.title ?? "CLI chat"))).id;
    const autoApprove = typeof args["auto-approve"] === "string" ? args["auto-approve"] : undefined;

    console.log(`session\t${sessionId}`);
    const run = await client.createRun({
      sessionId,
      adapter,
      message,
      ...(model ? { model } : {})
    });
    console.log(`run\t${run.id}\t${run.status}`);

    await client.streamRun({
      sessionId,
      runId: run.id,
      autoApprove
    });
    return;
  }

  if (command === "approve") {
    const sessionId = readStringArg(args.session);
    const runId = readStringArg(args.run);
    const approvalRequestId = readStringArg(args.approval);
    const decision = args.decision ?? "accept";
    if (!sessionId || !runId || !approvalRequestId) {
      throw new Error("approve requires --session, --run, and --approval");
    }
    const approval = await client.submitApproval({
      sessionId,
      runId,
      approvalRequestId,
      decision
    });
    console.log(`approval\t${approval.approvalRequestId}\t${approval.status}`);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

class SurfCliClient {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.userId = options.userId;
    this.token = options.token;
  }

  async listSessions() {
    const payload = await this.fetchJson("/sessions");
    return payload.sessions ?? [];
  }

  async createSession(title) {
    const payload = await this.fetchJson("/sessions", {
      method: "POST",
      body: { title }
    });
    return payload.session;
  }

  async createRun(input) {
    const payload = await this.fetchJson(`/sessions/${encodeURIComponent(input.sessionId)}/runs`, {
      method: "POST",
      body: {
        adapter: input.adapter,
        content: input.message,
        ...(input.model ? { model: input.model } : {})
      }
    });
    return payload.run;
  }

  async streamRun(input) {
    const response = await fetch(`${this.baseUrl}/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/stream`, {
      headers: this.headers()
    });
    if (!response.ok || !response.body) {
      throw new Error(`stream failed: ${response.status} ${await response.text()}`);
    }

    for await (const event of readSseEvents(response.body)) {
      await this.handleRunEvent(input.sessionId, input.runId, event, input.autoApprove);
    }
  }

  async handleRunEvent(sessionId, runId, event, autoApprove) {
    if (event.type === "assistant.delta") {
      process.stdout.write(event.data.delta);
      return;
    }
    if (event.type === "assistant.completed") {
      if (event.data.content && event.data.phase !== "final_answer") {
        console.log(`\nassistant.${event.data.phase ?? "unknown"}\t${event.data.content}`);
      }
      return;
    }
    if (event.type === "approval.requested") {
      const approval = event.data.approval;
      console.log(`\napproval.requested\t${approval.approvalRequestId}\t${approval.title ?? approval.kind}`);
      if (autoApprove) {
        const decision = normalizeAutoDecision(autoApprove, approval.availableDecisions);
        const updated = await this.submitApproval({
          sessionId,
          runId,
          approvalRequestId: approval.approvalRequestId,
          decision
        });
        console.log(`approval.submitted\t${updated.approvalRequestId}\t${updated.status}`);
      }
      return;
    }
    if (event.type === "approval.updated") {
      console.log(`approval.updated\t${event.data.approval.approvalRequestId}\t${event.data.approval.status}`);
      return;
    }
    if (event.type === "run.status") {
      console.log(`\nrun.status\t${event.data.run.id}\t${event.data.run.status}`);
      return;
    }
    if (event.type === "error") {
      console.log(`\nerror\t${event.data.code ?? "-"}\t${event.data.message}`);
      return;
    }
    if (event.type !== "heartbeat") {
      console.log(`event\t${event.type}`);
    }
  }

  async submitApproval(input) {
    const payload = await this.fetchJson(
      `/sessions/${encodeURIComponent(input.sessionId)}/runs/${encodeURIComponent(input.runId)}/approvals/${encodeURIComponent(input.approvalRequestId)}/decision`,
      {
        method: "POST",
        body: { decision: input.decision }
      }
    );
    return payload.approval;
  }

  async fetchJson(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers: this.headers(Boolean(options.body)),
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
    }
    return text ? JSON.parse(text) : {};
  }

  headers(includeJson = false) {
    return {
      "x-surf-user-id": this.userId,
      ...(this.token ? { "x-surf-token": this.token } : {}),
      ...(includeJson ? { "content-type": "application/json" } : {})
    };
  }
}

async function* readSseEvents(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf("\n\n")) >= 0) {
      const raw = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      yield JSON.parse(data);
    }
  }
}

function normalizeAutoDecision(autoApprove, availableDecisions) {
  if (availableDecisions.includes(autoApprove)) {
    return autoApprove;
  }
  if (autoApprove === "yes" && availableDecisions.includes("accept")) {
    return "accept";
  }
  if (autoApprove === "session" && availableDecisions.includes("acceptForSession")) {
    return "acceptForSession";
  }
  return availableDecisions[0] ?? autoApprove;
}

function parseArgs(rawArgs) {
  const parsed = { _: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const item = rawArgs[index];
    if (!item.startsWith("--")) {
      parsed._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = rawArgs[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

function readStringArg(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function printHelp() {
  console.log(`Usage:
  node scripts/surf-cli.mjs sessions [--base-url URL] [--user local]
  node scripts/surf-cli.mjs send --message "hello" [--session ID] [--adapter mock] [--auto-approve accept]
  node scripts/surf-cli.mjs approve --session ID --run ID --approval ID [--decision accept]

Environment:
  SURF_AI_BASE_URL=http://127.0.0.1:43127
  SURF_AI_USER_ID=local
  SURF_AI_TOKEN=optional-token
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  exit(1);
});
