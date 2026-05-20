# Phase 2 Harness: Context Engine V1

Status: PLANNED
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
   - `buildRunContext`
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

## Validation Plan

- `pnpm --filter @surf-ai/bridge typecheck`
- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Focused tests/snapshots for handoff package shape.
- Focused tests for `/sessions/:id/context` preview behavior.
- Manual run: existing Codex/Claude continuity still works after context refactor.

## Validation Report

Not run. This harness is planning-only.

## Risk Review

- Phase ordering risk: Phase 1 memory abstraction is not yet implemented.
- Regression risk: small prompt/JSON shape changes can break provider continuity.
- Split-path risk: Codex App Server `/sessions/:id/runs` may continue to assemble context separately unless explicitly integrated.
- Injection risk: page context and retrieved messages must stay fenced as untrusted reference data.
- Isolation risk: retrieval must remain scoped to `userId + sessionId`.
- Worktree risk: `apps/bridge/src/runtimes/codex-app-server-runtime.ts` is already dirty and must not be mixed into Phase 2 without review.

## Likely Files

- `apps/bridge/src/core/context-engine.ts`
- `apps/bridge/src/core/session-manager.ts`
- `apps/bridge/src/core/retrieval.ts`
- `apps/bridge/src/index.ts`
- `apps/bridge/src/runtimes/types.ts`
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts` only if App Server run context integration is included
- `docs/bridge-api.md`
- focused test/eval files

## Final Status

PLANNED
