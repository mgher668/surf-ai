# Phase 6A Harness: Runtime And UI QA Baseline

Status: DONE_WITH_CONCERNS
Date: 2026-05-21

## Goal

Establish a repeatable QA baseline for the existing Surf runtime and browser-extension UI paths before adding new runtime capabilities.

## Scope

- Document and execute current core user paths.
- Validate bridge sessions, runs, SSE streaming, approvals, timeline replay, page extraction, attachments, settings persistence, and bridge restart behavior.
- Use the standalone extension page and sidepanel where feasible, but prioritize reproducible local QA over broad browser coverage.
- Add focused regression tests only for bugs discovered in existing runtime behavior.

## Non-Goals

- No large UI redesign.
- No Tool Registry V2 implementation.
- No Memory V2 implementation.
- No full Playwright E2E suite yet.
- No Chrome sidepanel deep automation in this phase.

## Subagent Plan

- Read-only analysis: completed. Mapped sessions/runs/SSE, approvals, timeline replay, page extraction, attachments, settings persistence, and restart recovery code paths.
- Test supplement: not needed because no new runtime bug was fixed in this phase; existing focused backend tests were re-run.
- UI QA: completed as a manual standalone-page QA matrix, not as an automated or fully executed Chrome UI pass.
- Risk review: completed. Risks are summarized below and should feed Phase 6B and later runtime hardening.

## Implementation Plan

1. Build a QA matrix for normal chat, long streaming output, approval flow, page extraction, attachments, settings, refresh replay, and bridge restart.
2. Document deterministic local startup commands for bridge and extension UI.
3. Execute the matrix and record pass/fail evidence.
4. Inspect SQLite state for sessions/messages/runs/events/approvals after key flows.
5. Fix only baseline-blocking defects or create explicit follow-up issues in the harness record.
6. Run typecheck/build/evals before final status.

## Decision Log

- 2026-05-21: QA baseline must precede new capability expansion.
- 2026-05-21: Standalone extension page is acceptable as the primary UI target because it shares the sidepanel UI.
- 2026-05-21: This phase is allowed to be mostly verification and documentation; code changes are not required unless QA finds blocking regressions.
- 2026-05-21: Subagent slots were initially full from earlier completed work; those agents were closed, then Phase 6A read-only analysis, UI QA planning, and risk review were delegated successfully.
- 2026-05-21: Use isolated ports and temporary SQLite databases for API smoke/evals when possible. Port `43127` may already be occupied by a user-running bridge and can produce misleading results.
- 2026-05-21: A `/tools` 404 observed on `43127` was traced to an already-running older bridge on that port, not the current source. Isolated port smoke confirmed `/tools` is present.
- 2026-05-21: No runtime code changes were made in Phase 6A; this phase establishes the baseline and risk backlog.

## QA Baseline Matrix

Primary target:

- Standalone extension page loaded from the unpacked extension, because it reuses the sidepanel UI while being easier to inspect.

Setup:

1. Start bridge: `pnpm dev:bridge`.
2. Build or run extension: `pnpm dev:extension` or `pnpm --filter @surf-ai/extension build`.
3. Load unpacked extension from `apps/extension/dist`.
4. Open standalone page: `chrome-extension://<extension-id>/src/ui/sidepanel/index.html`.
5. Do not use plain Vite localhost for the standalone page; the UI depends on `chrome.runtime`.

Manual QA matrix to execute before Phase 6B automation:

| Area | Flow | Expected observation | Main endpoints / storage |
|---|---|---|---|
| Initial load | Open standalone page with bridge running | Header, sidebar, sessions, adapter/model controls render | `GET /capabilities`, `GET /models`, `GET /sessions` |
| Bridge unreachable | Stop bridge and reload | User-facing bridge unreachable error | failed bridge fetches, optional alert badge |
| New backend session | Send first message from empty draft | Session is created only on send; user/assistant messages persist | `POST /sessions`, `POST /sessions/:id/runs`, stream, messages |
| Streaming render | Send long/multi-step output | Incremental output appears and final message persists | stream, events, messages |
| Refresh replay | Reload after completion | Same messages and process timeline reappear without duplicates | sessions, messages, runs, events, approvals |
| Stop run | Cancel active run | UI exits busy state and run reaches terminal state | `POST /runs/:id/cancel` |
| Approval card | Trigger runtime approval | Inline approval card appears and decision updates it | approvals endpoint and approval events |
| Page extraction | Extract active tab content | Attached page context banner/checkbox appears; context is sent only when enabled | extension message then run context |
| Selection payload | Select page text and use content handle | Composer receives selected-text action payload | background/content messages then run context |
| Image attachments | Add/send valid images | Preview, upload, persisted thumbnail work | `POST /uploads`, `GET /uploads/:id`, run attachments |
| Attachment limits | Invalid count/type/size | Client-side error and no invalid upload | chrome UI/local validation |
| Session actions | Favorite, rename, delete | Backend and UI state match after reload | star, patch, delete session APIs |
| Theme/sidebar mode | Toggle and reload | Preferences persist | `chrome.storage.local` |
| Settings round trip | Change locale/adapter/theme/connection | Sidepanel reflects updated settings | storage, `/models` |
| Auth/token error | Use wrong token/user | Clear auth error; no token leaks in audit/log UI | protected endpoints, `/audit/events` |

Important selectors and visual checkpoints identified for Phase 6B:

- Header controls: `aria-label="Toggle sidebar"`, `aria-label="Sidebar Mode"`, `aria-label="Theme"`, `aria-label="Open Standalone"`, `aria-label="Open Settings"`.
- Sidebar: `Sessions`, `New Session`, active row, `[data-session-title="true"]`, `Current Connection`.
- Conversation: `aria-label="Current session message list"`, `[data-message-id]`, `data-highlighted="true"`.
- Composer: adapter select, model select, `Add Images`, `Extract Page`, textarea placeholder, `Send`.
- Runtime process UI: commentary, reasoning, tool/command output, approval card statuses.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Focused backend tests for memory/context/session boundary/approval/timeline/tool registry.
- Isolated API smoke on a temporary port and temporary SQLite database.
- Manual QA matrix definition for standalone extension page.
- Risk review of persistence and untrusted context boundaries.

## Validation Report

Passed:

- `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/memory-service.test.ts src/core/context-engine.test.ts src/core/session-manager-boundary.test.ts src/core/approval-service.test.ts src/core/store-timeline-artifacts.test.ts src/core/tool-registry.test.ts`
- `pnpm typecheck`
- `pnpm build`
- `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43139 pnpm evals` against an isolated temporary bridge: `4/4` passed.
- Isolated API smoke against `SURF_AI_PORT=43138` and temporary SQLite:
  - `GET /health` returned ok.
  - `GET /capabilities` returned `tools` count `7`.
  - `GET /tools` returned `tools` count `7`.
  - `POST /sessions` created a session.
  - `POST /sessions/:id/runs` with mock adapter returned `202` and created a run.
  - `GET /sessions/:id/runs`, `GET /sessions/:id/runs/:runId/events`, `GET /sessions/:id/runs/:runId/timeline`, and `GET /sessions/:id/messages` returned expected data.

Notes:

- A direct sandboxed temporary bridge start failed once with `EPERM` on `127.0.0.1`; rerun with escalated local-bind permission succeeded.
- A smoke attempt on port `43127` hit an existing user bridge and returned stale `/capabilities`/`/tools` behavior. Isolated port smoke is the reliable evidence for current source.
- A smoke attempt used the wrong field name `message` for `POST /sessions/:id/runs`; corrected to the actual schema field `content`.
- The isolated eval shell printed `4/4 passed` but did not return cleanly to the tool session before timeout; process inspection showed no remaining phase-specific bridge process. The eval result itself is valid and logged.

Not completed in this phase:

- Full real Chrome standalone-page manual execution of every QA matrix row.
- Real sidepanel smoke with loaded extension.
- Automated E2E coverage. This is explicitly Phase 6B.
- Real Codex approval run, because Phase 6A avoided requiring live local-agent behavior and credentials.

## Risk Review

Key risks from Phase 6A review:

1. Early Codex App Server events or approvals may arrive before active run context is registered, causing dropped events or `approval_run_context_not_found`.
2. Codex App Server page-context injection has weaker untrusted-context framing than the legacy `/chat` prompt path.
3. Approval expiry depends mainly on in-memory timers; persisted stale approvals may remain pending while bridge is alive if timers are lost.
4. UI replay can diverge from backend truth because it reconstructs timeline from separate event/approval/message calls and sorts process items by timestamp.
5. The consolidated `/timeline` endpoint exists but the sidepanel still reconstructs from separate `/events` and `/approvals` calls.
6. Settings connection tokens live in `chrome.storage.local`; QA must verify they are not shown in UI lists, logs, or audit responses.
7. Bridge restart recovery marks stale runs/approvals failed in SQLite, but existing UI clients may require reload/reconnect to reflect that terminal state.
8. SQLite remains the source of truth; extension IndexedDB/cache can diverge and must remain secondary.
9. Attachments and page extraction originate from browser/page-controlled inputs and require prompt-injection and privacy QA.

Phase 6B should turn the standalone-page matrix into automated tests. Later runtime hardening should address the Codex early-event, page-context framing, approval expiry, and UI timeline ordering concerns.

## Final Status

DONE_WITH_CONCERNS
