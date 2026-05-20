# Phase 4 Harness: Approval Runtime Hardening

Status: PLANNED
Date: 2026-05-21

## Goal

Move from Codex-specific approval support to a provider-neutral Approval Runtime that owns approval lifecycle, validation, persistence transitions, timeout handling, replay, and audit semantics.

## Scope

- Add `ApprovalService` under `apps/bridge/src/core/approval-service.ts`.
- Move decision validation, status mapping, timeout policy, replay-safe update publishing, and recovery helpers out of `CodexAppServerRuntime`.
- Keep runtime adapters responsible for provider protocol glue only.
- Tighten approval persistence transitions so terminal decisions cannot race.
- Preserve existing sidepanel approval UX unless a gap is found.
- Preserve existing Codex App Server approval behavior.

## Non-Goals

- No organization policy engine.
- No multi-approver workflow.
- No full Tool Registry integration.
- No non-Codex runtime implementation beyond reusable interfaces.
- No major UI redesign.

## Dependencies

- Can start after Phase 2 if Context Engine does not touch approval code.
- Should complete before Phase 3 write-capable tools.
- Should complete before Phase 5 canonical timeline normalization if approval event semantics need to be reused there.

## Subagent Plan

- Read-only analysis: completed for planning; found approval request intake, Codex method mapping, timeout, pending state, DB writes, and event publishing are coupled inside `CodexAppServerRuntime`.
- Test supplement: during implementation, own approval transition tests.
- UI QA: manually validate approval replay, pending approval display, decision buttons, and SSE reconnect.
- Risk review: focus on duplicate decisions, timeout/restart recovery, provider/DB desync, and user isolation.

## Implementation Plan

1. Add focused tests/evals around existing approval transitions before moving logic.
2. Extract pure helpers:
   - decision equality
   - status mapping
   - timeout fallback
   - display metadata normalization
3. Add `ApprovalService` using existing store methods and event sink.
4. Add an active-provider waiter interface so runtimes can wait for decisions without owning persistence policy.
5. Refactor `CodexAppServerRuntime` to delegate lifecycle decisions while retaining JSON-RPC response construction.
6. Route HTTP decision submission through `RuntimeManager` and `ApprovalService`.
7. Add atomic store update for pending-to-terminal transitions.
8. Validate UI replay from `/approvals` plus `/events`.
9. Update bridge API docs and this harness.

## Decision Log

- 2026-05-21: Approval Runtime should own durable lifecycle; runtime adapters should own protocol glue only.
- 2026-05-21: Existing UI dynamic decisions should be preserved.
- 2026-05-21: Duplicate decision race must be addressed during implementation.

## Validation Plan

- `pnpm --filter @surf-ai/bridge typecheck`
- `pnpm --filter @surf-ai/extension typecheck`
- `pnpm build`
- Unit/focused tests for:
  - allow once
  - allow session / runtime-provided equivalent
  - deny
  - cancel
  - timeout
  - duplicate decision
  - stale pending after restart
- Manual SSE reconnect during pending approval.
- Manual Codex App Server approval flow: request -> UI decision -> `approval.updated`.
- Restart recovery check: pending approvals become `FAILED` and are visible in timeline.

## Validation Report

Not run. This harness is planning-only.

## Risk Review

- Current update path may not atomically require `PENDING`, allowing duplicate decision races.
- Provider response and DB update can desync if ordering is wrong.
- Timeout timers are runtime-local; restart recovery cannot resume active provider waiters.
- `toolUserInput` approval payloads may need richer UI rendering later.
- Worktree risk: `apps/bridge/src/runtimes/codex-app-server-runtime.ts` is already dirty and Phase 4 will likely need it.

## Likely Files

- `apps/bridge/src/core/approval-service.ts`
- `apps/bridge/src/core/runtime-manager.ts`
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts`
- `apps/bridge/src/runtimes/types.ts`
- `apps/bridge/src/core/store.ts`
- `apps/bridge/src/index.ts`
- `packages/shared/src/index.ts`
- `apps/extension/src/ui/sidepanel/App.tsx` only if UI gaps surface
- `docs/bridge-api.md`

## Final Status

PLANNED
