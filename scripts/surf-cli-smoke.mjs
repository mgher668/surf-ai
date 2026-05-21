#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const cliPath = resolve(repoRoot, "scripts/surf-cli.mjs");

const fixture = await startFixtureBridge();
try {
  const sessions = await runCli(["sessions", "--base-url", fixture.baseUrl]);
  assertIncludes(sessions.stdout, "No sessions", "sessions output should include fixture session");

  const send = await runCli([
    "send",
    "--base-url",
    fixture.baseUrl,
    "--message",
    "please request approval",
    "--auto-approve",
    "accept"
  ]);

  assertIncludes(send.stdout, "approval.requested", "send output should show approval request");
  assertIncludes(send.stdout, "approval.submitted", "send output should show approval submission");
  assertIncludes(send.stdout, "Fixture CLI answer", "send output should stream assistant answer");
  assertIncludes(send.stdout, "run.status", "send output should show terminal run status");

  const summary = fixture.summary();
  assertEqual(summary.sessions, 2, "fixture should include initial plus CLI-created session");
  assertEqual(summary.runs, 1, "fixture should create one run");
  assertEqual(summary.decisions, 1, "fixture should receive one approval decision");

  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
} finally {
  await fixture.stop();
}

async function startFixtureBridge() {
  const state = {
    sessions: [
      {
        id: "fixture-session-existing",
        title: "No sessions? fixture baseline",
        starred: false,
        status: "ACTIVE",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActiveAt: Date.now()
      }
    ],
    runs: [],
    approvals: [],
    decisions: []
  };

  const server = createServer(async (req, res) => {
    try {
      setCors(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const method = req.method ?? "GET";
      const now = Date.now();

      if (method === "GET" && url.pathname === "/sessions") {
        return sendJson(res, 200, { sessions: state.sessions });
      }

      if (method === "POST" && url.pathname === "/sessions") {
        const body = await readJson(req);
        const session = {
          id: `session-${state.sessions.length + 1}`,
          title: body.title || `CLI ${state.sessions.length + 1}`,
          starred: false,
          status: "ACTIVE",
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now
        };
        state.sessions.unshift(session);
        return sendJson(res, 200, { session });
      }

      const runsMatch = url.pathname.match(/^\/sessions\/([^/]+)\/runs$/);
      if (method === "POST" && runsMatch) {
        const body = await readJson(req);
        const run = {
          id: `run-${state.runs.length + 1}`,
          sessionId: runsMatch[1],
          adapter: body.adapter || "mock",
          status: "RUNNING",
          userMessageId: `msg-user-${state.runs.length + 1}`,
          createdAt: now,
          startedAt: now,
          updatedAt: now
        };
        state.runs.push(run);
        return sendJson(res, 202, {
          session: state.sessions.find((item) => item.id === runsMatch[1]),
          run,
          userMessage: {
            id: run.userMessageId,
            sessionId: run.sessionId,
            role: "user",
            content: body.content,
            createdAt: now
          }
        });
      }

      const streamMatch = url.pathname.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/stream$/);
      if (method === "GET" && streamMatch) {
        const run = state.runs.find((item) => item.id === streamMatch[2]);
        if (!run) return sendJson(res, 404, { error: "run_not_found" });
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
          ...corsHeaders()
        });
        const approval = {
          id: `approval-${run.id}`,
          userId: "local",
          sessionId: run.sessionId,
          runId: run.id,
          adapter: "mock",
          approvalRequestId: `approval-request-${run.id}`,
          kind: "toolUserInput",
          title: "Fixture CLI approval",
          payload: { prompt: "Fixture CLI approval" },
          availableDecisions: ["accept", "decline"],
          status: "PENDING",
          requestedAt: Date.now(),
          expiresAt: Date.now() + 600000,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        state.approvals.push({ approval, res });
        writeSse(res, event(run, "approval.requested", { approval }));
        return;
      }

      const decisionMatch = url.pathname.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/approvals\/([^/]+)\/decision$/);
      if (method === "POST" && decisionMatch) {
        const body = await readJson(req);
        const pending = state.approvals.find((item) => item.approval.approvalRequestId === decisionMatch[3]);
        if (!pending) return sendJson(res, 404, { error: "approval_not_found" });
        const run = state.runs.find((item) => item.id === decisionMatch[2]);
        if (!run) return sendJson(res, 404, { error: "run_not_found" });

        pending.approval.status = "APPROVED";
        pending.approval.decision = body.decision;
        pending.approval.decidedAt = Date.now();
        pending.approval.updatedAt = pending.approval.decidedAt;
        state.decisions.push(body.decision);
        sendJson(res, 200, { approval: pending.approval });

        writeSse(pending.res, event(run, "approval.updated", { approval: pending.approval }));
        writeSse(pending.res, event(run, "assistant.delta", { delta: "Fixture CLI ", phase: "final_answer" }));
        writeSse(pending.res, event(run, "assistant.delta", { delta: "answer", phase: "final_answer" }));
        run.status = "SUCCEEDED";
        run.finishedAt = Date.now();
        run.updatedAt = run.finishedAt;
        writeSse(pending.res, event(run, "run.status", { run }));
        pending.res.end();
        return;
      }

      sendJson(res, 404, { error: "not_found", path: url.pathname, method });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "fixture_error" });
    }
  });

  const port = await listen(server, 0);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    summary: () => ({
      sessions: state.sessions.length,
      runs: state.runs.length,
      decisions: state.decisions.length
    }),
    stop: () => new Promise((resolveStop) => server.close(resolveStop))
  };
}

function runCli(args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(`CLI exited ${code}\nstdout=${stdout}\nstderr=${stderr}`));
    });
  });
}

function event(run, type, data) {
  return {
    eventId: `event-${Math.random().toString(36).slice(2)}`,
    sessionId: run.sessionId,
    runId: run.id,
    type,
    ts: Date.now(),
    data
  };
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "content-type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify(data));
}

function setCors(res) {
  for (const [key, value] of Object.entries(corsHeaders())) res.setHeader(key, value);
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-surf-user-id,x-surf-token"
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function listen(server, port) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen(server.address().port);
    });
  });
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)} in ${JSON.stringify(value)}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}
