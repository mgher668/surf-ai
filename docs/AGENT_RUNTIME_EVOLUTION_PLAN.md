# Surf AI Agent Runtime Evolution Plan

Status: Draft for staged implementation
Date: 2026-05-20

## 1. Product Direction

Surf AI should evolve from "Chrome AI web assistant with a local bridge" into a general-purpose AI Agent Runtime with a browser extension as the first client.

The browser extension remains important because it provides web-page context, selection actions, sidepanel UX, and tab-aware workflows. It should not define the whole product boundary. The backend runtime should become the stable product core.

## 2. Current Baseline

Already present in the repository:

- Backend session source of truth with SQLite.
- `sessions`, `messages`, `session_runs`, `agent_session_links`, `session_memories`, `approval_events`, and `run_events`.
- Codex App Server runtime path with run stream, approval API, and run event persistence.
- Browser extension sidepanel/standalone page client.
- Adaptive handoff payload with summary, recent window, facts, todos, evidence refs, page context, and session-local retrieval.
- Lightweight BM25 plus semantic-style retrieval over current session messages.
- Audit events, rate limit, CORS allowlist, optional HTTPS gate, and retention cleanup.

Hermes Agent references already analyzed in `docs/HERMES_AGENT_ARCHITECTURE.md`.

## 3. Guiding Principles

1. Backend runtime is the source of truth.
2. Clients are replaceable.
3. Browser capabilities are tools, not core runtime assumptions.
4. Memory, context, tools, approvals, and events are runtime subsystems.
5. Every agent-visible injected context must be fenced and attributable.
6. Every irreversible or privileged action must produce an auditable event.
7. Provider-specific details must stay behind runtime adapters.

## 4. Target Architecture

```text
clients/
  browser extension
  future web console
  future CLI
  future MCP/ACP bridge

bridge runtime/
  session + run manager
  event stream
  memory layer
  context engine
  tool registry
  approval runtime
  audit + retention

runtimes/
  codex app server
  claude code
  future OpenAI/Anthropic/Gemini APIs
  future MCP-hosted agents
```

## 5. Harness Engineering Execution Model

Goal:

- Make every large change executable, reviewable, and recoverable before implementation starts.

This project should not evolve by directly editing core runtime code first. Each major phase must start with a harness record that defines the plan, subagent split, validation path, risk review, and final status.

### 5.1 Required Harness Record

Every major phase must create one file before implementation:

```text
docs/harness/phase-x-short-name.md
```

Naming examples:

- `docs/harness/phase-0-repositioning.md`
- `docs/harness/phase-1-memory-layer.md`
- `docs/harness/phase-2-context-engine.md`
- `docs/harness/phase-4-approval-runtime.md`

The file is the execution record for that phase. It should be updated throughout the phase, not written once and abandoned.

Required sections:

1. `Goal`
2. `Scope`
3. `Non-Goals`
4. `Subagent Plan`
5. `Implementation Plan`
6. `Decision Log`
7. `Validation Plan`
8. `Validation Report`
9. `Risk Review`
10. `Final Status`

Allowed final statuses:

- `PLANNED` for planning-only harness records before implementation starts
- `IN_PROGRESS` while implementation is active
- `DONE`
- `DONE_WITH_CONCERNS`
- `BLOCKED`

No implementation phase should proceed to the next implementation phase without `DONE`, `DONE_WITH_CONCERNS`, or `BLOCKED`. Planning-only harness records may stay `PLANNED` until their implementation starts.

### 5.2 Subagent Split

Subagents are required for large phases, but their responsibilities must be split to avoid conflicting edits.

Default split:

- Read-only analysis subagent: maps current code paths, data flow, coupling, and unknowns.
- Test supplement subagent: owns focused tests/evals only, with a clearly bounded write set.
- UI QA subagent: exercises browser extension flows and reports issues; read-only by default.
- Risk review subagent: reviews data isolation, prompt injection, tool approval, migration, and rollback risks; read-only.

Main agent responsibilities:

- Own architecture decisions.
- Own core runtime code changes.
- Integrate subagent findings.
- Resolve tradeoffs.
- Update the phase harness record.
- Produce the final report.

Subagent constraints:

- Do not let multiple agents edit `SessionManager`, store/schema code, runtime manager code, or shared event types at the same time.
- Do not let read-only/review/QA subagents write code.
- If a worker subagent writes code, assign a disjoint file set before it starts.
- Summarize subagent outputs into the harness record; do not paste long raw transcripts.

### 5.3 Medium-Strict Gates

Each implementation phase must pass these gates:

1. Plan gate: phase harness record exists with scope, non-goals, subagent plan, and validation plan.
2. Build gate: `pnpm typecheck` and relevant package builds pass unless documented as blocked.
3. Eval gate: existing evals pass, and new focused evals are added when behavior changes.
4. Manual QA gate: at least one real user path is exercised when UI/runtime behavior changes.
5. Risk gate: risk review findings are written into the harness record.
6. Report gate: final status is written before commit.

Pure documentation phases can use a lighter gate:

1. Plan gate.
2. Docs consistency review.
3. Final status.

### 5.4 Hermes As Architecture Input

Hermes Agent is a formal architecture input for this evolution, but only at the level of ideas and tradeoffs.

Allowed:

- Borrow memory-layer concepts.
- Borrow run timeline and reconstructability principles.
- Borrow tool boundary and approval separation ideas.
- Borrow checkpoint/state-continuity thinking.

Not allowed:

- Copy Hermes internals line by line.
- Make Surf depend on Hermes code.
- Import Hermes-specific abstractions without adapting them to Surf's backend-first architecture.

### 5.5 Execution Order Rule

For this plan, execution must start with:

1. Phase 0: Repositioning And Architecture Contract.
2. Phase 1: Memory Layer V1.

Phase 0 should be documentation-only. Phase 1 should start with a small `MemoryService` wrapper around existing `session_memories` before adding new memory tables or user-facing memory features.

## 6. Phase 0: Repositioning And Architecture Contract

Goal:

- Update project documents so future implementation follows the general Agent Runtime direction.

Scope:

- `README.md`
- `docs/PLAN.md`
- `docs/bridge-api.md` if API terminology needs clarification
- `AGENT.md` if long-lived agent rules contain old persistence or execution assumptions
- `RUNBOOK.md` and `SECURITY_CHECKLIST.md` if operational docs contain old source-of-truth or Codex execution assumptions
- `docs/BACKEND_SESSION_MODE.md` if backend-session continuity docs conflict with current App Server runtime behavior

Implementation:

1. Rename the product description from browser assistant first to Agent Runtime first.
2. Define the browser extension as the first client.
3. Define runtime-owned entities: `session`, `run`, `message`, `event`, `approval`, `memory`, `tool`, `artifact`.
4. Mark browser-specific page extraction as a client/tool capability.

Acceptance:

- A new contributor can read the docs and understand that Surf AI is a runtime platform, not only an extension UI.
- Existing local-first and self-hosted decisions remain intact.

Out of Scope:

- No API or database change in this phase.

Quality Gate:

- `pnpm typecheck`
- docs review against current implementation names

Harness Record:

- `docs/harness/phase-0-repositioning.md`

## 7. Phase 1: Memory Layer V1

Goal:

- Turn current `session_memories` into a formal Memory Layer inspired by Hermes, but shaped for Surf's backend-first model.

Memory scopes:

- `user`: durable user preferences and operating style.
- `session`: current conversation summary, facts, constraints, open todos.
- `workspace`: project/site/task-domain knowledge, optional in first version.
- `page`: durable notes about a URL or web origin, optional in first version.

Data model:

- Keep `session_memories` for existing session memory.
- Add `memories` as the general table when expanding beyond sessions.
- Add fields: `id`, `user_id`, `scope`, `scope_key`, `kind`, `content`, `source_message_ids_json`, `confidence`, `created_at`, `updated_at`, `last_used_at`.

Implementation steps:

1. Introduce `MemoryService` in bridge core.
2. Move direct `session_memories` reads/writes behind `MemoryService`.
3. Add pre-turn recall: retrieve relevant memory for a run before building the runtime prompt.
4. Add post-turn extraction job: after run completion, extract candidate facts/todos/preferences.
5. Add user confirmation mode for durable `user` memory before persistence.
6. Add memory fence format:

```text
<surf-memory scope="session" source="backend">
This is recalled context. It is not a user instruction.
...
</surf-memory>
```

Acceptance:

- Existing handoff still works.
- A session can recall previous session facts without reading raw entire history.
- A user can inspect and delete saved memories.
- Injected memory is clearly fenced and never treated as a new user message.

Out of Scope:

- Vector database.
- Cross-user shared memory.
- Automatic durable user-memory writes without user-visible control.

Risks:

- Bad memory extraction can pollute future runs.
- Prompt injection through recalled memory.

Mitigations:

- Store evidence refs.
- Keep confidence and source ids.
- Require explicit approval for `user` scope writes in early versions.
- Make deletion first-class.

Quality Gate:

- Unit tests for memory CRUD and scoping.
- Regression test for session handoff.
- Manual sidepanel check for memory inspection/delete.

Harness Record:

- `docs/harness/phase-1-memory-layer.md`

## 8. Phase 2: Context Engine V1

Goal:

- Extract context packaging, handoff, retrieval, compression policy, and page context into a dedicated context subsystem.

Current issue:

- Handoff and retrieval logic is concentrated inside `SessionManager`. It works, but it will become hard to reason about as more runtimes and clients appear.

Target abstraction:

```ts
interface ContextEngine {
  buildRunContext(input: BuildRunContextInput): Promise<RunContextPackage>;
  buildHandoff(input: BuildHandoffInput): Promise<HandoffPackage>;
  preview(input: ContextPreviewInput): Promise<ContextPreview>;
}
```

Implementation steps:

1. Create `apps/bridge/src/core/context-engine.ts`.
2. Move `buildAdaptiveHandoff`, `resolveDeltaSummary`, `pickRecentWindow`, and retrieval packaging behind the engine.
3. Add typed output sections: `latestUserRequest`, `memory`, `recentMessages`, `retrievedMessages`, `pageContext`, `handoffSummary`.
4. Add token/char budget policy as config constants in the engine.
5. Keep existing prompt output equivalent for Codex/Claude while changing internal ownership.

Acceptance:

- Codex and Claude handoff output remains functionally equivalent.
- Context preview endpoint continues to work.
- New runtime adapters can request context without depending on `SessionManager` internals.

Out of Scope:

- Full semantic embeddings.
- Long-context compression lineage table.

Quality Gate:

- Snapshot tests for context package shape.
- Existing evals still pass.

Harness Record:

- `docs/harness/phase-2-context-engine.md`

## 9. Phase 3: Tool Registry V1

Goal:

- Introduce a provider-neutral tool registry so browser actions, backend actions, MCP tools, and runtime-native tool approvals use one conceptual model.

Tool categories:

- `browser`: selected text, current tab content, screenshots later.
- `backend`: session search, memory read/write, artifact read/write.
- `external`: MCP tools and user configured services.
- `runtime-native`: tools exposed by Codex/Claude app server or future runtimes.

Implementation steps:

1. Add `ToolRegistry` with tool definitions, scopes, risk level, input schema, and handler metadata.
2. Register existing backend capabilities as internal tools first.
3. Model browser page extraction as a client-provided context/tool result, not a hardcoded chat field.
4. Add risk levels: `read`, `write`, `external_write`, `privileged`.
5. Route risky tool events into Approval Runtime.
6. Add tool discovery API for clients.

Acceptance:

- The extension can discover supported browser/backend tools from the bridge.
- A new tool can be added without editing runtime-specific adapter code.
- Tool calls and approvals share audit metadata.

Out of Scope:

- Full MCP client implementation in this phase.
- Remote marketplace.

Quality Gate:

- Type-level schema tests or focused unit tests.
- Manual run with at least one read-only tool and one approval-required tool.

Harness Record:

- `docs/harness/phase-3-tool-registry.md`

## 10. Phase 4: Approval Runtime Hardening

Goal:

- Move from "Codex approval support" to a generic Approval Runtime.

Current baseline:

- `approval_events` exists.
- Codex App Server path has approval request/decision events.

Implementation steps:

1. Add `ApprovalService` if not already separated cleanly from runtime code.
2. Normalize decision model: `allow_once`, `allow_session`, `deny`, plus runtime-provided custom decisions.
3. Add approval policy config:
   - default mode: `ask`
   - global/session "allow all" toggle
   - timeout behavior
   - per-tool risk behavior
4. Add recovery on bridge restart: mark pending approvals and running runs as failed with audit details.
5. Add approval event replay from persistence for reconnecting clients.

Acceptance:

- Approval UI can reconnect and recover current pending approval state.
- Timeout and denial are visible in the run timeline.
- All approval decisions are auditable.
- Non-Codex runtime can reuse the same approval model.

Out of Scope:

- Organization policy engine.
- Multi-approver workflow.

Quality Gate:

- Unit tests for decision validation.
- Manual SSE reconnect test during pending approval.

Harness Record:

- `docs/harness/phase-4-approval-runtime.md`

## 11. Phase 5: Event Timeline And Artifact Model

Goal:

- Make every run reconstructable from persisted events and artifacts.

Current baseline:

- `run_events` exists.
- Sidepanel already consumes streamed events.

Implementation steps:

1. Define canonical event taxonomy:
   - `run.started`
   - `message.delta`
   - `message.completed`
   - `reasoning.delta`
   - `tool.started`
   - `tool.output`
   - `approval.requested`
   - `approval.updated`
   - `artifact.created`
   - `run.failed`
   - `run.completed`
2. Add `artifacts` table for generated files, page captures, transcripts, images, and large tool outputs.
3. Store large event payloads as artifacts and reference them from events.
4. Make UI render from timeline, not only final `messages`.
5. Add export/debug endpoint for a run timeline.

Acceptance:

- Refreshing the UI reconstructs the same ordered timeline.
- Tool output, approvals, reasoning summaries, and final answer remain visible.
- Large outputs do not bloat `messages.content`.

Out of Scope:

- Branching visualization.
- Collaborative multi-client live cursors.

Quality Gate:

- Regression test for event ordering.
- Manual refresh after a tool-heavy run.

Harness Record:

- `docs/harness/phase-5-event-timeline-artifacts.md`

## 12. Phase 6A: Runtime And UI QA Baseline

Goal:

- Establish a repeatable QA baseline for the existing runtime and browser-extension user paths before adding new capabilities.

Scope:

- Manual QA scripts for sidepanel and standalone extension page.
- Runtime smoke checks for sessions, runs, SSE, approvals, timeline replay, page extraction, attachments, settings persistence, and bridge restart recovery.
- QA result recording under `docs/harness/phase-6a-runtime-ui-qa-baseline.md`.
- Bug filing or focused fixes only when they block the baseline.

Implementation steps:

1. Create a QA matrix covering current user-visible flows.
2. Add deterministic local setup commands for bridge and extension standalone page.
3. Exercise a normal run, a tool/approval run, a page-context run, and a refresh/reconnect run.
4. Verify persisted sessions/messages/events/approvals after reload and bridge restart.
5. Record issues with severity, reproduction steps, and owner phase.
6. Add focused regression tests for any runtime bug found during QA.

Acceptance:

- Existing core flows have a documented pass/fail baseline.
- Refresh and replay behavior is verified from persisted backend data.
- Known non-blocking UI issues are documented instead of hidden.
- No new feature phase starts with unknown baseline stability.

Out of Scope:

- No large UI redesign.
- No full Playwright suite yet.
- No Chrome sidepanel deep automation in this phase.
- No Tool Registry V2 or Memory V2 implementation.

Quality Gate:

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Manual QA matrix completed and linked in the harness record
- Risk review for persistence, approvals, and untrusted page context

Harness Record:

- `docs/harness/phase-6a-runtime-ui-qa-baseline.md`

## 13. Phase 6B: Standalone Extension Page E2E

Goal:

- Add automated E2E coverage for the standalone extension page first, because it shares the main sidepanel UI while being more stable to automate.

Scope:

- Playwright-based E2E test harness for the standalone extension page.
- Mock or local bridge fixture for deterministic tests.
- Coverage for conversation startup, message send, stream rendering, approval cards, timeline replay, settings persistence, and page-context attachment display where feasible.
- CI-friendly commands documented in package scripts.

Implementation steps:

1. Choose the E2E runner and folder layout.
2. Add bridge fixture mode or test server stubs for deterministic SSE and approval events.
3. Add first tests for session list, new empty composer, send message, and final answer rendering.
4. Add tests for commentary/tool/approval timeline rendering.
5. Add refresh/reload replay test.
6. Document how to run E2E locally.

Acceptance:

- A developer can run one command to test the standalone extension page.
- The most fragile UI paths have automated regression coverage.
- E2E tests do not require real Codex/OpenAI credentials.
- Sidepanel implementation remains shared with standalone page.

Out of Scope:

- No real Chrome extension sidepanel automation.
- No remote browser-cloud testing.
- No visual snapshot approval system unless a specific regression requires it.

Quality Gate:

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- E2E command passes locally
- Manual smoke of standalone page after E2E wiring

Harness Record:

- `docs/harness/phase-6b-standalone-extension-e2e.md`

## 14. Phase 7: Tool Registry V2 Dispatch

Goal:

- Upgrade Tool Registry from metadata discovery to a controlled backend tool dispatch boundary.

Scope:

- Add callable read-only Surf backend tools first.
- Route every dispatch through registry metadata, user/session ownership checks, approval policy when required, execution, timeline event persistence, and audit logging.
- Keep browser-provided context tools client-originated and untrusted.
- Add write/high-risk tools only after read-only dispatch is stable.

Implementation steps:

1. Define `ToolDispatcher` interfaces and handler contracts.
2. Add read-only tools such as session search, memory preview, artifact metadata read, and context preview.
3. Persist tool start/output/error events into run timeline.
4. Enforce risk levels and approval policy before non-read operations.
5. Add tests for authorization, unknown tools, schema validation, approval-required tools, and timeline output.
6. Expose tool dispatch only through authenticated bridge APIs; do not let provider adapters bypass registry for Surf-owned tools.

Acceptance:

- Read-only backend tools can be called through a single registry/dispatcher path.
- Tool calls are reconstructable from timeline events.
- Risky tools cannot execute without approval policy passing.
- Provider-native tools remain clearly separated from Surf-owned tools.

Out of Scope:

- No external MCP client yet.
- No tool marketplace.
- No destructive filesystem/database mutation tools in the first dispatch slice.
- No automatic browser tab control from backend.

Quality Gate:

- Unit tests for dispatcher routing and ownership checks
- Approval policy tests for high-risk tool attempts
- Timeline replay test for tool events
- Manual QA with at least one read-only tool and one blocked/approval-required path

Harness Record:

- `docs/harness/phase-7-tool-registry-v2-dispatch.md`

## 15. Phase 8: Memory V2 Durable Scopes

Goal:

- Expand memory beyond session summaries into explicit, inspectable, user-controlled durable memory scopes.

Scope:

- Add general `memories` table if not already present.
- Support `user`, `workspace`, `page`, and `session` scopes.
- Add candidate memory extraction after runs, but require user confirmation before durable user memory persistence.
- Add memory inspect/delete APIs and UI surface.
- Fence all injected memory with source, scope, confidence, and evidence refs.

Implementation steps:

1. Design and migrate general memory schema.
2. Add MemoryService APIs for create/list/update/delete/recall by scope.
3. Add candidate extraction pipeline using current available local agent or configured model.
4. Store candidate memories separately from confirmed durable memories.
5. Add UI to review, confirm, edit, and delete durable memory.
6. Add recall integration through ContextEngine with attribution and injection fences.
7. Add retention and privacy controls.

Acceptance:

- User can see and delete saved memories.
- Long-term user memory is not silently written.
- Context injection clearly marks recalled memory as context, not user instruction.
- Recall improves continuity without requiring full raw history injection.

Out of Scope:

- No vector database in V2.
- No cross-user shared memory.
- No automatic sensitive memory persistence.
- No self-modifying skill memory.

Quality Gate:

- Memory CRUD and scoping tests
- Candidate/confirmed memory lifecycle tests
- Prompt-injection and source-attribution risk review
- Manual UI QA for inspect/confirm/delete

Harness Record:

- `docs/harness/phase-8-memory-v2-durable-scopes.md`

## 16. Phase 9: Multi-Client CLI Smoke Client

Goal:

- Prove Surf is a backend Agent Runtime and not only a browser-extension backend by adding a minimal non-extension client.

Scope:

- Add a small CLI smoke client that can connect to the bridge, list sessions, start a run, stream events, and submit approvals when needed.
- Add client identity/capability model only as much as needed for CLI smoke.
- Keep browser extension behavior unchanged.

Implementation steps:

1. Define minimal client registration or client header contract.
2. Add CLI package or script under the monorepo.
3. Implement list sessions, create/send message, stream run events, and approval response.
4. Add smoke tests using mock/local bridge behavior where possible.
5. Document CLI usage in README/RUNBOOK.

Acceptance:

- A non-extension client can use the same runtime session/run APIs.
- CLI can stream timeline events in order.
- CLI can respond to approval requests.
- Browser extension continues to work without client-specific branching.

Out of Scope:

- No full terminal UI.
- No public SaaS account system.
- No multi-device pairing UX beyond the minimal local contract.
- No MCP/ACP bridge yet.

Quality Gate:

- API contract tests
- CLI smoke test
- Existing extension build and evals pass
- Manual CLI run against local bridge

Harness Record:

- `docs/harness/phase-9-multi-client-cli-smoke.md`

## 17. Phase 10: OpenAI API Runtime Adapter

Goal:

- Add a non-local-agent runtime adapter using OpenAI API to prove local agents and cloud model APIs can coexist behind the same Surf runtime boundary.

Scope:

- Add OpenAI API adapter/runtime configuration.
- Support normal chat/run flow through existing sessions, messages, ContextEngine, timeline events, and UI adapter/model selection.
- Do not require browser extension changes beyond configuration and display if existing UI can support it.
- Preserve local Codex App Server behavior.

Implementation steps:

1. Define provider config storage for OpenAI API base URL/key/model list.
2. Add OpenAI runtime adapter behind existing runtime/provider interfaces.
3. Integrate ContextEngine output into OpenAI request format.
4. Stream OpenAI responses into canonical run events.
5. Record adapter/model metadata on messages/runs.
6. Add tests using mocked OpenAI-compatible HTTP responses.
7. Add docs for local/self-hosted compatible endpoints where applicable.

Acceptance:

- User can choose OpenAI API adapter and model.
- A run through OpenAI API persists messages and timeline events like Codex runs.
- Existing Codex App Server runs are unaffected.
- Adapter-specific errors are structured and visible in UI.

Out of Scope:

- No Anthropic/Gemini direct API in this phase.
- No tool calling through OpenAI API until Tool Registry dispatch policy is stable.
- No automatic provider model discovery unless the configured endpoint supports it reliably.
- No server-side shared billing/account management.

Quality Gate:

- Mocked adapter unit/integration tests
- Typecheck/build/evals
- Manual run with configured compatible endpoint if credentials are available
- Risk review for API key storage and prompt/context boundaries

Harness Record:

- `docs/harness/phase-10-openai-api-runtime-adapter.md`

## 18. Recommended Execution Order

1. Phase 0: Repositioning docs. DONE.
2. Phase 1: Memory Layer V1. DONE.
3. Phase 2: Context Engine V1. DONE.
4. Phase 4: Approval Runtime Hardening. DONE.
5. Phase 5: Event Timeline And Artifact Model. DONE.
6. Phase 3: Tool Registry V1. DONE.
7. Phase 6A: Runtime And UI QA Baseline.
8. Phase 6B: Standalone Extension Page E2E.
9. Phase 7: Tool Registry V2 Dispatch.
10. Phase 8: Memory V2 Durable Scopes.
11. Phase 9: Multi-Client CLI Smoke Client.
12. Phase 10: OpenAI API Runtime Adapter.

Reasoning:

- QA baseline and automated E2E should come before new capability expansion, so existing behavior is not accidentally destabilized.
- Tool Registry V2 should precede Memory V2 UI/tool interactions because memory inspection and recall can become tool-like backend reads.
- Memory V2 should precede multi-client and OpenAI adapter work so every client/runtime shares the same recall semantics.
- CLI smoke proves the backend runtime boundary before adding a cloud API runtime.
- OpenAI API adapter validates that Surf can support both local agents and non-local model APIs without changing the client model.

Planning note:

- Phase 6A/6B/7/8/9/10 may be planned together as `Status: PLANNED` harness records.
- Implementation must still proceed one phase at a time.
- Every implementation phase requires a current harness record, validation report, risk review, final status, and independent commit.
- Default no push; push only after explicit user confirmation.

## 19. Open Questions Before Implementation

1. For Phase 6A, which real sites should be used as stable page-extraction QA fixtures if local fixtures are insufficient?
2. For Phase 6B, should E2E run against a fake bridge fixture by default and real bridge only in smoke mode?
3. For Phase 7, which read-only backend tool should be the first callable tool: context preview, session search, or artifact metadata read?
4. For Phase 8, should durable user memories require confirmation every time, or allow category-level auto-save after explicit opt-in?
5. For Phase 9, should the CLI live as `apps/cli` or `scripts/surf-cli.mjs` for the first smoke version?
6. For Phase 10, should OpenAI-compatible endpoints be supported from day one, or only official OpenAI first?

## 20. Non-Goals

- Do not copy Hermes internals line by line.
- Do not make Surf depend on Hermes Agent code.
- Do not make browser extension state the source of truth.
- Do not auto-save sensitive user memory silently.
- Do not let provider-specific concepts leak into shared client APIs.
- Do not add write-capable tools before approval, audit, and timeline behavior are verified.

## 21. Review Gates

Every phase should pass these gates before commit:

1. `plan-eng-review`: architecture, data boundaries, failure modes.
2. `build`: typecheck and build.
3. `qa`: at least one real run through the affected user path.
4. `review`: diff review focused on regressions and data isolation.
5. `report`: DONE / DONE_WITH_CONCERNS / BLOCKED.
