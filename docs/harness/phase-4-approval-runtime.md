# Phase 4 Harness: Approval Runtime Hardening

Status: IN_PROGRESS
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
- 2026-05-21: Codex JSON-RPC method mapping and response payload shaping remain in `CodexAppServerRuntime`; `ApprovalService` owns durable lifecycle and event publication.
- 2026-05-21: Terminal approval updates use a store-level `WHERE status = 'PENDING'` transition to prevent duplicate decisions from overwriting prior terminal state.
- 2026-05-21: Existing dirty local cancel behavior is preserved: bridge rejects the local run immediately and sends `turn/interrupt` asynchronously.
- 2026-05-21: Duplicate provider approval requests for the same `runId + approvalRequestId` are rejected with a JSON-RPC error instead of overwriting the original pending waiter.

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

- Passed: `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/approval-service.test.ts src/core/memory-service.test.ts src/core/context-engine.test.ts src/core/session-manager-boundary.test.ts`
- Passed: `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/approval-service.test.ts`
- Passed: `pnpm --filter @surf-ai/bridge typecheck`
- Passed: `pnpm typecheck`
- Passed: `pnpm build`
- Initial `pnpm evals` failed because bridge was not running.
- Passed after temporary bridge start: `pnpm evals` (`4/4` passed).

## Risk Review

- Current update path may not atomically require `PENDING`, allowing duplicate decision races.
- Fixed: pending-to-terminal updates now use `transitionPendingApprovalEvent(...)` with `status = 'PENDING'`.
- Fixed: disconnect handling now attempts to mark active pending approvals `FAILED` before removing in-memory waiters.
- Reduced: provider response now happens after durable transition wins; duplicate decisions return the existing terminal approval without republishing.
- Remaining: timeout timers are still runtime-local; bridge restart recovery remains store-level and does not republish per-run timeline events in this phase.
- Remaining: `toolUserInput` approval payloads may need richer UI rendering later.
- Remaining: the preserved fast local cancel behavior can still desync from a provider that ignores/delays `turn/interrupt`; this tradeoff existed before this phase's extraction and is documented.

## Likely Files

- `apps/bridge/src/core/approval-service.ts`
- `apps/bridge/src/core/approval-service.test.ts`
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts`
- `apps/bridge/src/core/store.ts`
- `docs/harness/phase-4-approval-runtime.md`

## Final Status

DONE
