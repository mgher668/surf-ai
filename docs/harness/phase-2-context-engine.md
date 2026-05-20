# Phase 2 Harness: Context Engine V1

Status: IN_PROGRESS
Date: 2026-05-21

## Goal

Extract context assembly into a dedicated bridge subsystem without changing provider-visible behavior first. The first implementation should be a compatibility refactor: centralize handoff, retrieval, recent-window, memory, and page-context packaging while preserving current Codex/Claude behavior.

## Scope

- Create `ContextEngine` under `apps/bridge/src/core/context-engine.ts`.
- Move adaptive handoff construction out of `SessionManager`.
- Move retrieval preview packaging behind `ContextEngine`.
- Keep `/sessions/:id/context` behavior equivalent.
- Keep current Codex/Claude handoff JSON shape equivalent during the first implementation slice.
- Add focused tests or evals for context package shape and retrieval preview.

## Non-Goals

- No new database schema.
- No embeddings/vector database.
- No cross-session memory.
- No UI changes.
- No approval runtime work.
- No Tool Registry work.
- No broad shared API redesign.
- No long-context compression lineage table.

## Dependencies

- Phase 1 `MemoryService` should complete first. Phase 2 depends on memory access moving behind a stable service boundary.
- If Phase 2 starts before Phase 1 is complete, the harness must explicitly mark that as a deviation and keep memory calls behind an interim adapter.

## Subagent Plan

- Read-only analysis: completed for planning; found `SessionManager` owns handoff, retrieval, summary generation, memory reads, and page-context clipping.
- Test supplement: during implementation, own context package shape tests and retrieval preview regression tests only.
- UI QA: not required for the first compatibility refactor unless `/sessions/:id/context` or sidepanel behavior changes.
- Risk review: focus on prompt injection, retrieval isolation, provider-visible prompt diffs, and split-path divergence with Codex App Server runs.

## Implementation Plan

1. Create `ContextEngine` with typed APIs:
   - `buildHandoff`
   - `preview`
2. Move budget constants and pure helpers from `SessionManager` into the engine:
   - recent window selection
   - evidence refs
   - page context normalization
   - clipping
   - retrieval trigger and packaging
3. Keep `SessionManager` responsible only for orchestration:
   - adapter selection
   - provider resume/fallback
   - agent session link sync
4. Preserve current handoff payload shape for Codex/Claude resume paths.
5. Decide separately whether canonical Codex App Server runs should consume rendered context in this phase or remain unchanged until a later slice.
6. Update docs only after behavior is stable.

## Decision Log

- 2026-05-21: Phase 2 is planned but not executable until Phase 1 Memory Layer is complete.
- 2026-05-21: First slice must be provider-visible compatibility refactor, not behavior redesign.
- 2026-05-21: Codex App Server prompt integration is optional in Phase 2 and must be explicitly decided before implementation.
- 2026-05-21: Phase 1 MemoryService is complete (`5a0dae9`), so Phase 2 can start.
- 2026-05-21: First implementation slice will not edit dirty `codex-app-server-runtime.ts`; canonical App Server context integration remains deferred unless explicitly reopened.
- 2026-05-21: `buildRunContext` is intentionally deferred. This phase only extracts the existing Codex/Claude CLI resume handoff and context preview paths.
- 2026-05-21: `SessionManager` keeps provider resume prompt rendering so this phase does not change the surrounding prompt text.

## Validation Plan

- `pnpm --filter @surf-ai/bridge typecheck`
- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Focused tests/snapshots for handoff package shape.
- Focused tests for `/sessions/:id/context` preview behavior.
- Static boundary check: `SessionManager` no longer owns context helper functions or direct retrieval.

## Validation Report

- Passed: `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/memory-service.test.ts src/core/context-engine.test.ts src/core/session-manager-boundary.test.ts`
- Passed: `pnpm --filter @surf-ai/bridge typecheck`
- Passed: `pnpm typecheck`
- Passed: `pnpm build`
- Passed: `pnpm evals` (`4/4` passed)
- Note: `pnpm evals` used an already running bridge on `127.0.0.1:43127`; the attempted temporary bridge start failed with `EADDRINUSE`, then evals completed successfully against the existing local bridge.
- Passed: static boundary check for removed `SessionManager` helpers:
  - `buildAdaptiveHandoff`
  - `resolveDeltaSummary`
  - `shouldRetrieveOlderContext`
  - `pickRecentWindow`
  - `normalizeContext`
  - `retrieveSessionMessages`

## Risk Review

- Provider-visible prompt drift remains the main risk. Mitigation in this phase: prompt rendering stays in `SessionManager`, and focused tests cover handoff package shape.
- Split-path risk remains by design. Canonical Codex App Server runs still assemble context separately and are not refactored in Phase 2.
- Retrieval isolation currently depends on `SessionManager` passing history already scoped by `userId + sessionId`; do not expose `ContextEngine.preview(history, query)` to arbitrary callers without preserving that boundary.
- Prompt injection hardening is not changed in this phase. Page context, retrieved context, pinned facts, and todos remain compatibility JSON fields, not newly fenced text.
- Worktree risk handled: existing dirty `apps/bridge/src/runtimes/codex-app-server-runtime.ts` and untracked `temp/` were not touched by Phase 2.

## Likely Files

- `apps/bridge/src/core/context-engine.ts`
- `apps/bridge/src/core/context-engine.test.ts`
- `apps/bridge/src/core/session-manager-boundary.test.ts`
- `apps/bridge/src/core/session-manager.ts`
- `docs/harness/phase-2-context-engine.md`

## Final Status

DONE
