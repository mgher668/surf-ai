# Phase 5 Harness: Event Timeline And Artifact Model

Status: PLANNED
Date: 2026-05-21

## Goal

Make every run reconstructable from a persisted ordered timeline and artifact references. Large reasoning, tool, command, and generated outputs should not be stored only in `messages.content` or inline `run_events.data_json`.

## Scope

- Define canonical event taxonomy while preserving backward compatibility.
- Add artifact persistence for large generated/captured outputs.
- Add artifact references to event payloads.
- Add run timeline export/debug endpoint.
- Update Codex runtime event mapping.
- Update sidepanel reconstruction to rely on ordered timeline where appropriate.
- Add event ordering and refresh parity tests.

## Non-Goals

- No branching visualization.
- No collaborative multi-client live cursors.
- No replacement of message persistence.
- No provider continuity redesign.
- No broad adapter rewrite beyond minimal timeline parity.

## Dependencies

- Should run after Phase 4 Approval Runtime if approval events are part of canonical timeline.
- Should run before Phase 3 exposes write-capable tools, so tool output and approval traces have a stable timeline model.

## Subagent Plan

- Read-only analysis: completed for planning; found existing `run_events`, `approval_events`, `session_runs`, `attachments`, and sidepanel replay behavior.
- Test supplement: during implementation, own event ordering, replay reconstruction, artifact reference, and refresh parity tests.
- UI QA: manually validate refresh after a tool-heavy run and approval-heavy run.
- Risk review: focus on payload bloat, event ordering, artifact ownership, retention, and backward compatibility.

## Implementation Plan

1. Freeze shared event contract in `packages/shared/src/index.ts`.
2. Add canonical lifecycle names while preserving existing event support or adding a compatibility mapper.
3. Add `artifacts` table with:
   - user ownership
   - session ownership
   - run ownership
   - kind
   - mime type
   - byte size
   - storage path or metadata
   - sha256
   - timestamps
4. Add artifact fetch metadata/content API with owner checks.
5. Offload large event payloads above a defined threshold.
6. Update Codex runtime to emit canonical lifecycle/tool/message/artifact events.
7. Add `GET /sessions/:id/runs/:runId/timeline` returning ordered run, messages, approvals, events, and artifact metadata.
8. Update sidepanel timeline reconstruction while preserving current message rendering.
9. Update docs and runbook.

## Decision Log

- 2026-05-21: Event replay must use persisted DB ordering, not timestamps alone.
- 2026-05-21: Existing event names must remain supported during transition.
- 2026-05-21: Artifacts must be generic and separate from image message attachments.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Regression test for event ordering.
- Test for artifact owner checks.
- Test for timeline export shape.
- Manual refresh after a tool-heavy Codex run.
- Manual refresh after an approval-heavy Codex run.

## Validation Report

Not run. This harness is planning-only.

## Risk Review

- Event renaming can break live sidepanel rendering unless legacy events are supported during transition.
- Large payload offload must not hide errors or approval context needed for audit/debug.
- Artifact files need strict path safety, ownership checks, retention behavior, and deletion behavior.
- Non-Codex `/sessions/:id/messages` path may not have full timeline parity yet.
- Worktree risk: current dirty Codex runtime file overlaps likely event mapping work.

## Likely Files

- `packages/shared/src/index.ts`
- `apps/bridge/src/core/store.ts`
- `apps/bridge/src/core/run-event-bus.ts`
- `apps/bridge/src/core/runtime-manager.ts`
- `apps/bridge/src/runtimes/types.ts`
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts`
- `apps/bridge/src/index.ts`
- `apps/extension/src/lib/bridge-sse.ts`
- `apps/extension/src/ui/sidepanel/App.tsx`
- `docs/bridge-api.md`
- `RUNBOOK.md`

## Final Status

PLANNED
