# Product Plan (v0.1)

## 1. Scope Baseline

Surf AI is evolving into a local-first Agent Runtime for personal and self-hosted usage.

Today, the Chrome extension is the shipped client and primary UX. It provides browser-native entrypoints, current-page context, selection actions, sidepanel chat, standalone tab mode, and settings. The backend bridge is becoming the durable runtime core for sessions, messages, runs, approvals, audit events, and long-term architecture boundaries.

- Primary runtime mode: local Agent bridge (`codex` / `claude`).
- TTS mode: MiniMax Text to Speech via `/tts`.
- Data persistence: bridge SQLite source of truth plus browser local cache/settings.

Currently implemented runtime-owned entities:

- `session`: user-visible conversation container.
- `run`: one agent execution attempt inside a session.
- `message`: durable user/assistant/system-visible conversation item.
- `event`: ordered runtime timeline item for streaming, reasoning, tools, approvals, and errors.
- `approval`: auditable user decision for risky tool/runtime actions.
- `memory`: backend-owned recalled context with source evidence and scope.

Target runtime vocabulary:

- `tool`: browser, backend, external, or runtime-native capability exposed through controlled boundaries.
- `artifact`: large generated or captured output referenced from events/messages.
- `client`: extension, future web console, future CLI, or future MCP/ACP bridge.

## 2. Locked Decisions (Current)

1. Chat backend priority is local Agent adapters, not hosted LLM APIs.
2. MiniMax is integrated for TTS only in current scope.
3. MiniMax LLM integration is not part of v0.1 baseline.
4. Browser capabilities are runtime tools/context sources, not the product boundary.
5. New large runtime phases must follow the harness process in `docs/AGENT_RUNTIME_EVOLUTION_PLAN.md`.

## 3. Current Runtime Routing

- `/capabilities` is the first handshake endpoint for UI capability negotiation:
  - dynamic chat adapter options,
  - local fallback mapping exposure for compatibility adapters,
  - MiniMax TTS availability/configuration flags.
- `/sessions/:id/runs` is the canonical runtime execution path for Codex App Server-based runs.
- `/chat` is a compatibility endpoint and supports adapter field:
  - `codex`, `claude`, `mock` are concrete local adapters.
  - `openai-compatible`, `anthropic`, `gemini` are currently compatibility placeholders and map to configured local fallback adapter.
  - request context is normalized into a bounded internal task payload before local agent invocation.
- `/tts` uses MiniMax T2A config from bridge environment.

## 4. Out of Scope (v0.1)

- User login / cloud account system.
- Cloud-hosted conversation storage.
- MiniMax LLM as a first-class chat provider.

## 5. Next Planning Checkpoint

When adding provider-mode LLM support, update this file first with:

- provider matrix,
- credential strategy,
- fallback policy,
- security and data-boundary changes.

## 6. Backend Source-of-Truth Direction (2026-04-05)

For upcoming shared deployment mode (one backend + multiple extension clients), architecture direction is updated:

1. Backend is the source of truth for sessions/messages in backend session mode.
2. Extension local storage/IndexedDB will act as cache/sync layer.
3. Agent continuity relies on explicit provider session/thread IDs:
   - Codex via App Server `threadId`
   - Claude Code via `--resume` or `--session-id`
4. `--last` strategy is not used for server-side continuity logic.
5. User auth and per-user data isolation become mandatory in this mode.

Confirmed execution choices:

- Storage starts with SQLite.
- Auth starts with multi-user account isolation.
- Handoff is adaptive (summary + dynamic recent window), not fixed-length raw history.
- Old-message retrieval is session-scoped and on-demand.
- Summary generation uses one-shot calls to available local Agent.

Implementation steps are tracked in:

- `docs/BACKEND_SESSION_MODE.md`
- `docs/AGENT_RUNTIME_EVOLUTION_PLAN.md`

Progress update:

- 2026-04-05: Phase 1 (backend session source-of-truth + extension cache sync) completed.
- 2026-04-05: Phase 2 codex continuity (`SessionManager`, `provider_session_id`, `synced_seq`, resume fallback) completed.
- 2026-04-05: Phase 3 claude continuity (`--session-id` create, `--resume` continue, `BROKEN` fallback) completed.
- 2026-04-05: Phase 4 handoff memory layer (`session_memories`, adaptive handoff package, summary reuse) completed.
- 2026-04-05: Phase 5 step 1 completed (`keywords/BM25 retrieval`, low-confidence expansion, context preview endpoint).
- 2026-04-05: Phase 6 step 1 completed (`CORS allowlist`, `write-route rate limit`, optional `HTTPS required` gate).
- 2026-04-05: Phase 6 step 2 completed (`audit_events` persistence + security event logging + `/audit/events` query API).
- 2026-04-05: Phase 6 step 3 completed (`retention config` + `/admin/maintenance/purge` dry-run/execute + scoped cleanup).

## 7. Priority Update (2026-04-06)

Re-prioritized by current product goal ("local self-use first, fast feedback"):

1. `IDLE` automatic status transition is deferred (not required in current UX path).
2. Next implementation priority is retrieval enhancement:
   - keep retrieval scope strictly session-local,
   - add semantic recall on top of BM25 (hybrid ranking),
   - keep evidence refs for traceability.
3. Next implementation priority is lightweight security alert UX:
   - sidepanel status hint for `backend_unreachable` / `auth_failed` / `rate_limited`,
   - extension badge marker for actionable errors,
   - recent audit event quick view (based on `/audit/events`).

Progress update:

- 2026-04-06: retrieval enhancement completed (session-local hybrid recall/ranking on top of BM25).
- 2026-04-06: lightweight security alert UX completed (sidepanel runtime alert + extension badge + recent audit preview).
- 2026-04-09: codex run path migrated to App Server runtime (`/sessions/:id/runs`), with SSE run stream and inline approval APIs (`/stream`, `/approvals`, `/decision`).

## 8. Agent Runtime Evolution Direction (2026-05-20)

The next architecture track is to make the bridge a general Agent Runtime rather than a browser-assistant-specific backend.

Execution order:

1. Phase 0: Repositioning and architecture contract.
2. Phase 1: Memory Layer V1.
3. Phase 2: Context Engine V1.
4. Phase 4: Approval Runtime hardening.
5. Phase 5: Event Timeline and Artifact model.
6. Phase 3: Tool Registry V1.
7. Phase 6: Multi-client Runtime API.
8. Phase 7: Skill and Workflow Layer.

Execution rules:

- Each major phase must first create a harness record under `docs/harness/`.
- Phase 0 is documentation-only.
- Phase 1 starts with a small `MemoryService` wrapper around existing `session_memories`.
- Hermes Agent is a formal architecture input by concept only; Surf does not copy or depend on Hermes internals.
