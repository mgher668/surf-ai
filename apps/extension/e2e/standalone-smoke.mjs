import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const extensionDir = resolve(repoRoot, "apps/extension");
const distDir = resolve(extensionDir, "dist");
const manifestPath = resolve(distDir, "manifest.json");
const defaultArtifactDir = join(tmpdir(), "surf-ai-extension-e2e-artifacts");

async function main() {
  const chromeBinary = process.env.SURF_AI_E2E_CHROME ?? findChromeBinary();
  const cdpPort = Number(process.env.SURF_AI_E2E_CDP_PORT ?? 0) || await getFreePort();
  const headless = process.env.SURF_AI_E2E_HEADLESS !== "0";
  const stepDelayMs = parseNonNegativeInt(process.env.SURF_AI_E2E_STEP_DELAY_MS, 0);
  const artifactDir = resolve(process.env.SURF_AI_E2E_ARTIFACT_DIR ?? defaultArtifactDir);
  const steps = createStepRunner(stepDelayMs);

  if (!existsSync(manifestPath)) {
    throw new Error("Extension dist is missing. Run `pnpm --filter @surf-ai/extension build` first.");
  }
  if (!chromeBinary) {
    throw new Error("No Chromium/Chrome binary found. Set SURF_AI_E2E_CHROME=/path/to/chrome.");
  }

  const fixture = createBridgeFixture();
  const fixtureBaseUrl = await fixture.start();
  const userDataDir = await mkdtemp(join(tmpdir(), "surf-ai-extension-e2e-"));
  let chrome;
  let page;

  try {
    chrome = await steps.run("launch Chromium with Surf extension", () =>
      launchChrome({ chromeBinary, cdpPort, userDataDir, headless, extensionDir: distDir })
    );
    await steps.run("wait for Chrome DevTools Protocol", () => waitForCdp(cdpPort));
    const extensionId = await steps.run("discover loaded extension id", () =>
      waitForExtensionId(cdpPort, userDataDir, distDir)
    );
    page = await steps.run("open standalone extension page", () =>
      openTarget(cdpPort, `chrome-extension://${extensionId}/src/ui/sidepanel/index.html`)
    );
    await steps.run("wait for standalone page load", () => page.ready);
    await steps.run("configure extension storage", () => configureExtensionStorage(page.client, fixtureBaseUrl));
    await steps.run("reload with bridge fixture config", () => page.client.send("Page.reload", { ignoreCache: true }));

    await steps.run("verify standalone page title", () => waitFor(page.client, () => document.body.innerText.includes("Surf AI"), "standalone page title"));
    await steps.run("verify session sidebar", () => waitFor(page.client, () => document.body.innerText.includes("Sessions"), "session sidebar"));
    await steps.run("verify empty state", () => waitFor(page.client, () => document.body.innerText.includes("No messages yet"), "empty state"));

    await steps.run("type first message", () => typeComposer(page.client, "Phase 6B fixture smoke"));
    await steps.run("send first message", () => clickButtonByText(page.client, "Send"));
    await steps.run("verify streamed assistant answer", () => waitFor(page.client, () => document.body.innerText.includes("Fixture answer"), "streamed assistant answer"));
    await steps.run("verify persisted user and assistant messages", () => waitFor(page.client, () => document.querySelectorAll("[data-message-id]").length >= 2, "persisted user and assistant messages"));

    await steps.run("reload after first answer", () => page.client.send("Page.reload", { ignoreCache: true }));
    await steps.run("verify refresh replay answer", () => waitFor(page.client, () => document.body.innerText.includes("Fixture answer"), "refresh replay answer"));
    await steps.run("verify refresh replay process timeline", () => waitFor(page.client, () => document.body.innerText.includes("Intermediate Commentary"), "refresh replay process timeline"));
    await steps.run("verify refresh replay messages", () => waitFor(page.client, () => document.querySelectorAll("[data-message-id]").length >= 2, "refresh replay messages"));

    await steps.run("type approval request message", () => typeComposer(page.client, "please request approval"));
    await steps.run("send approval request message", () => clickButtonByText(page.client, "Send"));
    await steps.run("verify approval card", () => waitFor(page.client, () => document.body.innerText.includes("Fixture approval"), "approval card"));
    await steps.run("approve once", () => clickButtonByText(page.client, "Allow once"));
    await steps.run("verify approval updated state", () => waitFor(page.client, () => document.body.innerText.includes("Approved"), "approval updated state"));
    await steps.run("verify post-approval assistant answer", () => waitFor(page.client, () => document.body.innerText.includes("Approved fixture answer"), "post-approval assistant answer"));

    await steps.run("reload after approval answer", () => page.client.send("Page.reload", { ignoreCache: true }));
    await steps.run("verify approval replay card", () => waitFor(page.client, () => document.body.innerText.includes("Fixture approval"), "approval replay card"));
    await steps.run("verify approval replay state", () => waitFor(page.client, () => document.body.innerText.includes("Approved"), "approval replay state"));
    await steps.run("verify approval replay answer", () => waitFor(page.client, () => document.body.innerText.includes("Approved fixture answer"), "approval replay answer"));

    await steps.run("persist dark theme", () => setChromeStorage(page.client, { "surf.theme": "dark" }));
    await steps.run("reload after theme update", () => page.client.send("Page.reload", { ignoreCache: true }));
    await steps.run("verify theme persistence", () => waitFor(page.client, () => document.documentElement.classList.contains("dark"), "theme persistence"));

    const summary = await steps.run("verify fixture summary", () => fixture.summary());
    assert(summary.sessions >= 1, "fixture should have at least one session");
    assert(summary.runs >= 2, "fixture should have created two runs");
    assert(summary.decisions >= 1, "fixture should have received approval decision");

    console.log(JSON.stringify({
      ok: true,
      extensionId,
      fixtureBaseUrl,
      sessions: summary.sessions,
      runs: summary.runs,
      decisions: summary.decisions
    }, null, 2));
  } catch (error) {
    const screenshotPath = await captureFailureScreenshot(page?.client, artifactDir, steps.currentLabel());
    if (screenshotPath) {
      console.error(`E2E failure screenshot: ${screenshotPath}`);
    }
    throw error;
  } finally {
    page?.client?.close();
    await terminateChrome(chrome);
    await fixture.stop();
    await removeTempDir(userDataDir);
  }
}

function createBridgeFixture() {
  let server;
  let baseUrl = "";
  const state = {
    sessions: [],
    messagesBySession: new Map(),
    runsBySession: new Map(),
    eventsByRun: new Map(),
    approvalsByRun: new Map(),
    activeStreamsByRun: new Map(),
    decisions: []
  };

  const tools = [
    tool("browser.selection.read", "Browser selection context"),
    tool("browser.page.extract_text", "Current tab full-page content", "medium"),
    tool("session.context_preview", "Session context preview"),
    tool("media.upload_attachment", "Image attachment upload", "medium"),
    tool("runtime.approval_request", "Runtime approval request", "high", true),
    tool("runtime.event_timeline", "Run timeline export"),
    tool("media.tts.minimax", "MiniMax text to speech", "medium")
  ];

  return {
    async start() {
      server = createServer(async (req, res) => {
        try {
          await handleFixtureRequest(req, res, state, tools);
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : "fixture_error" });
        }
      });
      const port = await listen(server, 0);
      baseUrl = `http://127.0.0.1:${port}`;
      return baseUrl;
    },
    async stop() {
      if (!server) return;
      await new Promise((resolveDone) => server.close(resolveDone));
    },
    async summary() {
      return {
        sessions: state.sessions.length,
        runs: Array.from(state.runsBySession.values()).reduce((sum, runs) => sum + runs.length, 0),
        decisions: state.decisions.length
      };
    }
  };
}

async function handleFixtureRequest(req, res, state, tools) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method ?? "GET";
  const now = Date.now();

  if (method === "GET" && path === "/health") {
    return sendJson(res, 200, { ok: true, version: "e2e-fixture", adapters: ["mock"], now: new Date(now).toISOString() });
  }
  if (method === "GET" && path === "/capabilities") {
    return sendJson(res, 200, {
      version: "e2e-fixture",
      now: new Date(now).toISOString(),
      chat: {
        adapters: [{ adapter: "mock", label: "Mock Fixture", kind: "native", enabled: true }],
        defaultAdapter: "mock",
        supportsModelOverride: true
      },
      tts: { minimax: { enabled: true, configured: false } },
      tools
    });
  }
  if (method === "GET" && path === "/tools") {
    return sendJson(res, 200, { tools });
  }
  if (method === "GET" && path === "/models") {
    return sendJson(res, 200, {
      models: [{ id: "auto", label: "Auto", adapter: "mock", enabled: true, isDefault: true }]
    });
  }
  if (method === "GET" && path === "/audit/events") {
    return sendJson(res, 200, { events: [] });
  }
  if (method === "GET" && path === "/sessions") {
    return sendJson(res, 200, { sessions: state.sessions });
  }
  if (method === "POST" && path === "/sessions") {
    const body = await readJson(req);
    const session = makeSession(body.title || `Chat ${state.sessions.length + 1}`, now);
    state.sessions.unshift(session);
    state.messagesBySession.set(session.id, []);
    state.runsBySession.set(session.id, []);
    return sendJson(res, 200, { session });
  }

  const messagesMatch = path.match(/^\/sessions\/([^/]+)\/messages$/);
  if (method === "GET" && messagesMatch) {
    const session = getSession(state, messagesMatch[1]);
    return sendJson(res, 200, { session, messages: state.messagesBySession.get(session.id) ?? [] });
  }

  const runsMatch = path.match(/^\/sessions\/([^/]+)\/runs$/);
  if (method === "GET" && runsMatch) {
    const session = getSession(state, runsMatch[1]);
    return sendJson(res, 200, { runs: state.runsBySession.get(session.id) ?? [] });
  }
  if (method === "POST" && runsMatch) {
    const session = getSession(state, runsMatch[1]);
    const body = await readJson(req);
    const messages = state.messagesBySession.get(session.id) ?? [];
    const userMessage = makeMessage(session.id, messages.length + 1, "user", body.content, "mock", now);
    messages.push(userMessage);
    state.messagesBySession.set(session.id, messages);

    const run = makeRun(session.id, userMessage.id, now, "RUNNING");
    const runs = state.runsBySession.get(session.id) ?? [];
    runs.unshift(run);
    state.runsBySession.set(session.id, runs);
    session.lastAdapter = "mock";
    session.status = "RUNNING";
    session.updatedAt = now;
    session.lastActiveAt = now;

    state.eventsByRun.set(run.id, [event(session.id, run.id, "run.started", { run }, now)]);
    state.approvalsByRun.set(run.id, []);
    return sendJson(res, 202, { session, run, userMessage });
  }

  const streamMatch = path.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/stream$/);
  if (method === "GET" && streamMatch) {
    const session = getSession(state, streamMatch[1]);
    const run = getRun(state, session.id, streamMatch[2]);
    return streamRun(res, state, session, run);
  }

  const eventsMatch = path.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/events$/);
  if (method === "GET" && eventsMatch) {
    getSession(state, eventsMatch[1]);
    return sendJson(res, 200, { events: state.eventsByRun.get(eventsMatch[2]) ?? [] });
  }

  const timelineMatch = path.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/timeline$/);
  if (method === "GET" && timelineMatch) {
    const session = getSession(state, timelineMatch[1]);
    const run = getRun(state, session.id, timelineMatch[2]);
    return sendJson(res, 200, {
      run,
      approvals: state.approvalsByRun.get(run.id) ?? [],
      events: state.eventsByRun.get(run.id) ?? [],
      artifacts: []
    });
  }

  const approvalsMatch = path.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/approvals$/);
  if (method === "GET" && approvalsMatch) {
    getSession(state, approvalsMatch[1]);
    return sendJson(res, 200, { approvals: state.approvalsByRun.get(approvalsMatch[2]) ?? [] });
  }

  const decisionMatch = path.match(/^\/sessions\/([^/]+)\/runs\/([^/]+)\/approvals\/([^/]+)\/decision$/);
  if (method === "POST" && decisionMatch) {
    getSession(state, decisionMatch[1]);
    const body = await readJson(req);
    const approvals = state.approvalsByRun.get(decisionMatch[2]) ?? [];
    const approval = approvals.find((item) => item.approvalRequestId === decisionMatch[3]);
    if (!approval) return sendJson(res, 404, { error: "approval_not_found" });
    approval.status = "APPROVED";
    approval.decision = body.decision;
    approval.decidedBy = "local";
    approval.decidedAt = Date.now();
    approval.updatedAt = approval.decidedAt;
    state.decisions.push(body.decision);
    const updated = event(decisionMatch[1], decisionMatch[2], "approval.updated", { approval }, Date.now());
    const session = getSession(state, decisionMatch[1]);
    const run = getRun(state, session.id, decisionMatch[2]);
    const completionEvents = completeRunWithAnswer(
      state,
      session,
      run,
      "Approved fixture answer after approval.",
      Date.now() + 1
    );
    const nextEvents = [...(state.eventsByRun.get(decisionMatch[2]) ?? []), updated, ...completionEvents];
    state.eventsByRun.set(decisionMatch[2], nextEvents);
    const stream = state.activeStreamsByRun.get(decisionMatch[2]);
    if (stream) {
      writeSse(stream, updated);
      for (const item of completionEvents) writeSse(stream, item);
      stream.end();
      state.activeStreamsByRun.delete(decisionMatch[2]);
    }
    return sendJson(res, 200, { approval });
  }

  return sendJson(res, 404, { error: "not_found", path, method });
}

function streamRun(res, state, session, run) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    ...corsHeaders()
  });

  const messages = state.messagesBySession.get(session.id) ?? [];
  const isApprovalRun = messages.find((item) => item.id === run.userMessageId)?.content.toLowerCase().includes("approval");
  const existingEvents = state.eventsByRun.get(run.id) ?? [];

  if (isApprovalRun) {
    if (run.status === "SUCCEEDED") {
      for (const item of existingEvents) writeSse(res, item);
      res.end();
      return;
    }

    let events = existingEvents;
    if (!events.some((item) => item.type === "approval.requested")) {
      const approval = makeApproval(session.id, run.id, Date.now());
      state.approvalsByRun.set(run.id, [approval]);
      const approvalEvent = event(session.id, run.id, "approval.requested", { approval }, Date.now());
      events = [...events, approvalEvent];
      state.eventsByRun.set(run.id, events);
    }

    for (const item of events) writeSse(res, item);
    state.activeStreamsByRun.set(run.id, res);
    res.on("close", () => {
      if (state.activeStreamsByRun.get(run.id) === res) {
        state.activeStreamsByRun.delete(run.id);
      }
    });
    return;
  }

  if (run.status === "SUCCEEDED") {
    for (const item of existingEvents) writeSse(res, item);
    res.end();
    return;
  }

  const streamEvents = completeRunWithAnswer(state, session, run, "Fixture answer from E2E bridge.", Date.now());
  state.eventsByRun.set(run.id, [...existingEvents, ...streamEvents]);

  let index = 0;
  const timer = setInterval(() => {
    const next = streamEvents[index++];
    if (!next) {
      clearInterval(timer);
      res.end();
      return;
    }
    writeSse(res, next);
  }, 25);
  res.on("close", () => clearInterval(timer));
}

function completeRunWithAnswer(state, session, run, content, now) {
  const messages = state.messagesBySession.get(session.id) ?? [];
  const assistantId = run.assistantMessageId ?? randomId("msg");
  const finalRun = { ...run, status: "SUCCEEDED", assistantMessageId: assistantId, finishedAt: now, updatedAt: now };
  Object.assign(run, finalRun);
  session.status = "IDLE";
  session.updatedAt = now;
  session.lastActiveAt = now;

  let assistant = messages.find((message) => message.id === assistantId);
  if (!assistant) {
    assistant = makeMessage(session.id, messages.length + 1, "assistant", content, "mock", now, assistantId);
    messages.push(assistant);
    state.messagesBySession.set(session.id, messages);
  }

  const words = content.split(" ");
  return [
    event(session.id, run.id, "assistant.completed", { content: "Fixture commentary step.", phase: "commentary" }, now + 1),
    event(session.id, run.id, "assistant.delta", { delta: `${words[0] ?? content} `, phase: "final_answer" }, now + 2),
    event(session.id, run.id, "assistant.delta", { delta: words.slice(1).join(" "), phase: "final_answer" }, now + 3),
    event(session.id, run.id, "assistant.completed", { content: assistant.content, message: assistant, phase: "final_answer" }, now + 4),
    event(session.id, run.id, "run.status", { run: finalRun }, now + 5)
  ];
}

function makeSession(title, now) {
  return { id: randomId("session"), title, starred: false, lastAdapter: "mock", status: "IDLE", createdAt: now, updatedAt: now, lastActiveAt: now };
}

function makeMessage(sessionId, seq, role, content, adapter, now, id = randomId("msg")) {
  return { id, sessionId, seq, role, adapter, content, createdAt: now };
}

function makeRun(sessionId, userMessageId, now, status) {
  return { id: randomId("run"), sessionId, adapter: "mock", status, userMessageId, createdAt: now, startedAt: now, updatedAt: now };
}

function makeApproval(sessionId, runId, now) {
  return {
    id: randomId("approval"),
    userId: "local",
    sessionId,
    runId,
    adapter: "mock",
    approvalRequestId: randomId("approval-request"),
    kind: "toolUserInput",
    title: "Fixture approval",
    payload: { prompt: "Fixture approval" },
    availableDecisions: ["accept", "decline"],
    status: "PENDING",
    requestedAt: now,
    expiresAt: now + 600000,
    createdAt: now,
    updatedAt: now
  };
}

function event(sessionId, runId, type, data, ts) {
  return { eventId: randomId("event"), sessionId, runId, type, ts, data };
}

function tool(id, label, risk = "low", requiresApproval = false) {
  return {
    id,
    label,
    description: label,
    scope: id.startsWith("browser") ? "client" : id.startsWith("runtime") ? "runtime" : id.startsWith("media") ? "media" : "session",
    risk,
    availability: id === "media.tts.minimax" ? "unconfigured" : "available",
    metadataOnly: true,
    callable: false,
    requiresApproval,
    inputSource: id.startsWith("browser") ? "browser" : id.startsWith("runtime") ? "runtime" : "bridge",
    outputKind: id.includes("approval") ? "approval" : id.includes("tts") ? "audio" : "metadata",
    tags: id.split(".")
  };
}

function getSession(state, sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error(`session not found: ${sessionId}`);
  return session;
}

function getRun(state, sessionId, runId) {
  const run = (state.runsBySession.get(sessionId) ?? []).find((item) => item.id === runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  return run;
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
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-surf-user-id,x-surf-token"
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function configureExtensionStorage(client, fixtureBaseUrl) {
  const now = Date.now();
  await setChromeStorage(client, {
    "surf.connections": [{ id: "e2e-local", name: "E2E Bridge", baseUrl: fixtureBaseUrl, userId: "local", enabled: true, createdAt: now, updatedAt: now }],
    "surf.activeConnectionId": "e2e-local",
    "surf.locale": "en",
    "surf.defaultAdapter": "mock",
    "surf.theme": "light",
    "surf.sidebarMode": "docked",
    "surf.sidebarCollapsed": false
  });
}

async function setChromeStorage(client, data) {
  await client.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `new Promise((resolve, reject) => chrome.storage.local.set(${JSON.stringify(data)}, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true)))`
  });
}

async function typeComposer(client, text) {
  await waitFor(client, () => Boolean(document.querySelector("textarea")), "composer textarea");
  await client.send("Runtime.evaluate", {
    expression: `(() => {
      const textarea = document.querySelector("textarea");
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, ${JSON.stringify(text)});
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    })()`
  });
}

async function clickButtonByText(client, text) {
  await waitFor(client, (label) => Array.from(document.querySelectorAll("button")).some((button) => button.textContent.trim() === label && !button.disabled), `button ${text}`, text);
  await client.send("Runtime.evaluate", {
    expression: `(() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent.trim() === ${JSON.stringify(text)} && !item.disabled);
      if (!button) throw new Error("button_not_found:${text}");
      button.click();
    })()`
  });
}

async function waitFor(client, predicate, label, arg, timeoutMs = 10000) {
  const source = `(${predicate.toString()})(${arg === undefined ? "" : JSON.stringify(arg)})`;
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeoutMs) {
    const result = await client.send("Runtime.evaluate", { expression: source, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      lastError = result.exceptionDetails.text ?? "exception";
    } else if (result.result?.value) {
      return;
    }
    await delay(100);
  }
  const snapshot = await client.send("Runtime.evaluate", { expression: "document.body.innerText.slice(0, 2000)", returnByValue: true });
  throw new Error(`Timed out waiting for ${label}. Last error: ${lastError}. Body: ${snapshot.result?.value ?? ""}`);
}

async function openTarget(port, url) {
  const targetInfo = await createTarget(port, url);
  const client = await CdpClient.connect(targetInfo.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return { client, ready: waitForPageLoad(client) };
}

async function createTarget(port, url) {
  let response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) {
    response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to create Chrome target: ${response.status}`);
  }
  return response.json();
}

async function waitForPageLoad(client) {
  const ready = client.waitForEvent("Page.loadEventFired", 10000).catch(() => undefined);
  await ready;
}

async function waitForExtensionId(port, userDataDir, extensionDir) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const storedId = await readExtensionIdFromPreferences(userDataDir, extensionDir);
    if (storedId) return storedId;

    const targets = await getChromeTargets(port);
    const found = targets.find((target) => {
      if (typeof target.url !== "string" || !target.url.startsWith("chrome-extension://")) {
        return false;
      }
      return target.url.includes("/service-worker-loader.js") || target.url.includes("/src/ui/");
    });
    if (found) return new URL(found.url).hostname;
    await delay(100);
  }
  throw new Error("Timed out discovering loaded extension id");
}

async function readExtensionIdFromPreferences(userDataDir, extensionDir) {
  try {
    const raw = await readFile(join(userDataDir, "Default", "Preferences"), "utf8");
    const preferences = JSON.parse(raw);
    const settings = preferences.extensions?.settings;
    if (!settings || typeof settings !== "object") return undefined;
    for (const [id, entry] of Object.entries(settings)) {
      if (!entry || typeof entry !== "object") continue;
      const path = entry.path;
      if (typeof path === "string" && resolve(path) === resolve(extensionDir)) {
        return id;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function getChromeTargets(port) {
  const targets = await getJson(port, "/json/list").catch(() => []);
  const version = await getJson(port, "/json/version").catch(() => null);
  if (!version?.webSocketDebuggerUrl) {
    return targets;
  }

  let client;
  try {
    client = await CdpClient.connect(version.webSocketDebuggerUrl);
    const targetResponse = await client.send("Target.getTargets");
    return [...targets, ...(targetResponse.targetInfos ?? [])];
  } catch {
    return targets;
  } finally {
    client?.close();
  }
}

async function waitForCdp(port) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      await getJson(port, "/json/version");
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("Timed out waiting for Chrome DevTools Protocol");
}

async function getJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`${path} ${response.status}`);
  return response.json();
}

class CdpClient {
  static async connect(wsUrl) {
    const client = new CdpClient(wsUrl);
    await client.opened;
    return client;
  }

  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws = new WebSocket(wsUrl);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(new Error(`CDP websocket error: ${event.message ?? "unknown"}`)));
    });
    this.ws.addEventListener("message", (event) => this.handleMessage(event));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, 15000).unref();
    });
  }

  waitForEvent(method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`CDP event timed out: ${method}`));
      }, timeoutMs).unref();
      const listener = (params) => {
        cleanup();
        resolve(params);
      };
      const cleanup = () => {
        clearTimeout(timer);
        const listeners = this.listeners.get(method) ?? [];
        this.listeners.set(method, listeners.filter((item) => item !== listener));
      };
      const listeners = this.listeners.get(method) ?? [];
      listeners.push(listener);
      this.listeners.set(method, listeners);
    });
  }

  close() {
    this.ws.close();
  }

  handleMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
    }
  }
}

function launchChrome({ chromeBinary, cdpPort, userDataDir, headless, extensionDir }) {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-features=Translate,OptimizationHints,MediaRouter",
    "--window-size=1440,1000"
  ];
  if (headless) args.push("--headless=new");
  if (process.getuid?.() === 0) args.push("--no-sandbox");
  const child = spawn(chromeBinary, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", (chunk) => {
    if (process.env.SURF_AI_E2E_DEBUG) process.stderr.write(chunk);
  });
  child.stdout.on("data", (chunk) => {
    if (process.env.SURF_AI_E2E_DEBUG) process.stdout.write(chunk);
  });
  child.once("exit", (code) => {
    if (code !== null && code !== 0 && process.env.SURF_AI_E2E_DEBUG) {
      process.stderr.write(`Chrome exited with code ${code}\n`);
    }
  });
  return child;
}

async function terminateChrome(chrome) {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) {
    return;
  }

  const exited = new Promise((resolveDone) => chrome.once("exit", resolveDone));
  chrome.kill("SIGTERM");
  await Promise.race([exited, delay(5000)]);

  if (chrome.exitCode === null && chrome.signalCode === null) {
    chrome.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
  }
}

function findChromeBinary() {
  const candidates = ["/sbin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((candidate) => existsSync(candidate));
}

async function getFreePort() {
  const server = createServer();
  const port = await listen(server, 0);
  await new Promise((resolveDone) => server.close(resolveDone));
  return port;
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen(server.address().port);
    });
  });
}

function randomId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function createStepRunner(stepDelayMs) {
  let current = "startup";
  return {
    currentLabel() {
      return current;
    },
    async run(label, action) {
      current = label;
      console.log(`[e2e] ${label}`);
      const result = await action();
      if (stepDelayMs > 0) {
        await delay(stepDelayMs);
      }
      return result;
    }
  };
}

async function captureFailureScreenshot(client, artifactDir, stepLabel) {
  if (!client) {
    return undefined;
  }

  try {
    await mkdir(artifactDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const safeStep = String(stepLabel || "unknown-step")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 80) || "unknown-step";
    const screenshotPath = join(artifactDir, `${timestamp}-${safeStep}.png`);
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    if (typeof result.data !== "string" || !result.data) {
      return undefined;
    }
    await writeFile(screenshotPath, Buffer.from(result.data, "base64"));
    return screenshotPath;
  } catch (error) {
    console.error(`Failed to capture E2E screenshot: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function parseNonNegativeInt(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

async function removeTempDir(path) {
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
