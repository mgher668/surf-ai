# Phase 1 Harness: Memory Layer V1

Status: DONE
Date: 2026-05-21

## Goal

Add a `MemoryService` around existing `session_memories` without changing user-visible behavior. This phase creates a stable memory boundary for Phase 2 Context Engine while preserving current adaptive handoff semantics.

## Scope

- Add `apps/bridge/src/core/memory-service.ts`.
- Move direct `session_memories` reads/writes from `SessionManager` behind `MemoryService`.
- Preserve existing `summary`, `facts`, and `todos` storage behavior.
- Preserve existing handoff JSON shape.
- Add a memory fence formatter for future prompt/context injection.
- Update docs/harness with validation and risk review.

## Non-Goals

- No new `memories` table.
- No database schema change.
- No user/workspace/page memory.
- No memory confirmation UI.
- No vector database or embeddings.
- No Context Engine extraction.
- No Tool Registry, Approval Runtime, or Event Timeline work.

## Subagent Plan

- Read-only analysis subagent: inspect current `session_memories` call sites and implementation map.
- Risk review subagent: inspect prompt injection, source evidence, session isolation, summary failures, and Phase 2 dependency risks.
- Test supplement subagent: inspect available test/eval structure and propose focused validation.
- UI QA subagent: not used unless implementation changes user-visible behavior.

Main agent owns implementation and final integration.

Subagent summaries:

- Read-only analysis confirmed the only direct `session_memories` behavior to preserve is `summary` cache/reuse/upsert plus `facts` and `todos` reads for handoff. It also confirmed `facts` and `todos` currently have no production writer.
- Risk review identified split-path risk with canonical Codex App Server runs, prompt-injection/memory-poisoning risk, coarse source evidence, cache/summary behavior regression risk, user/session isolation risk, and Phase 2 dependency risk.
- Test supplement found no existing unit-test runner and recommended lightweight `node:test` coverage around `MemoryService`, plus static boundary checks and existing eval smoke tests.

## Implementation Plan

1. Create `MemoryService` that wraps `BridgeStore.getSessionMemory` and `BridgeStore.upsertSessionMemory`.
2. Add typed helpers for:
   - getting session memory by kind
   - getting handoff memories (`facts`, `todos`)
   - getting reusable summary
   - upserting session summary
   - formatting fenced memory text
3. Inject `MemoryService` into `SessionManager`.
4. Replace direct store memory reads/writes in `SessionManager`.
5. Keep handoff payload shape unchanged.
6. Run validation commands.
7. Update this harness with subagent summaries, validation result, risk review, and final status.

## Decision Log

- 2026-05-21: Phase 1 is an abstraction-only implementation.
- 2026-05-21: Existing `session_memories` remains the only persistence table for this phase.
- 2026-05-21: Memory fence support is added as a service helper but not forced into current handoff payload unless behavior remains equivalent.
- 2026-05-21: Phase 2 Context Engine depends on this service boundary.
- 2026-05-21: Current canonical Codex App Server run path is not integrated with adaptive memory in this phase; that remains a Phase 2 Context Engine concern.
- 2026-05-21: `MemoryService` exposes both current string handoff helpers and a source-range bundle helper for Phase 2.

## Validation Plan

- `pnpm --filter @surf-ai/bridge typecheck`
- `pnpm typecheck`
- `pnpm build`
- `pnpm evals` with a running bridge
- Static check that `SessionManager` no longer directly calls `getSessionMemory` or `upsertSessionMemory`.

## Validation Report

Completed:

- Added `apps/bridge/src/core/memory-service.ts`.
- Updated `SessionManager` to use `MemoryService` instead of direct `BridgeStore.getSessionMemory` / `BridgeStore.upsertSessionMemory` calls.
- Added `apps/bridge/src/core/memory-service.test.ts` using built-in `node:test`.
- Static boundary check passed: `rg -n "getSessionMemory|upsertSessionMemory" apps/bridge/src/core/session-manager.ts` returns no matches.
- Focused test passed:
  - `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/memory-service.test.ts`
- Typecheck passed:
  - `pnpm --filter @surf-ai/bridge typecheck`
  - `pnpm typecheck`
- Build passed:
  - `pnpm build`
- Evals passed:
  - `pnpm evals`
  - Result: `4/4 passed`

Notes:

- Direct `pnpm evals` failed once when no bridge was running.
- A temporary bridge was then started with escalated local-bind permission because sandboxed `127.0.0.1:43127` binding returned `EPERM`.
- The temporary bridge was cleaned up; no matching temp bridge process remained after validation.

## Risk Review

Resolved or mitigated:

- `SessionManager` no longer directly reads or writes session memories.
- Every `MemoryService` method requires `userId`; cross-user reads return null and cross-user writes fail through existing `BridgeStore` ownership checks.
- Existing handoff JSON shape is preserved: `pinned_facts` and `open_todos` remain raw strings, and memory fence text is not injected into current handoff payload.
- Summary source range behavior is preserved and tested through `getReusableSummary`.
- A source-range bundle helper was added for Phase 2 without changing current provider-visible behavior.

Remaining concerns:

- Canonical Codex App Server `/sessions/:id/runs` still has a separate context path. Phase 1 intentionally does not solve that split-path issue.
- Existing `session_memories` schema only stores coarse source ranges, not per-fact evidence.
- `facts` and `todos` currently have no production writer; Phase 1 only preserves existing read behavior.
- Prompt-injection hardening is not complete until Phase 2 consistently fences memory, retrieval, page context, and tool output as non-instructional reference data.
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts` is dirty but was not touched by Phase 1.

## Final Status

DONE
