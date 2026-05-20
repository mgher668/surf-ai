# Phase 5 Harness: Event Timeline And Artifact Model

Status: IN_PROGRESS
Date: 2026-05-21

## Goal

Make every run reconstructable from a persisted ordered timeline and artifact references. Large reasoning, tool, command, and generated outputs should not be stored only in `messages.content` or inline `run_events.data_json`.

## Scope

- Preserve the current event taxonomy and add timeline/artifact primitives around it.
- Add artifact persistence for large generated/captured outputs.
- Add artifact references to event payloads.
- Add run timeline export/debug endpoint.
- Keep existing `/events` and sidepanel replay behavior compatible.
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
2. Keep current event names unchanged for V1.
3. Add `artifacts` table with:
   - user ownership
   - session ownership
   - run ownership
   - kind
   - mime type
   - byte size
   - metadata
   - inline content for V1
   - sha256
   - timestamps
4. Add run-scoped artifact content API with owner checks.
5. Offload large event payloads above a defined threshold.
6. Hydrate offloaded event payloads by default when listing/replaying events so existing clients remain compatible.
7. Add `GET /sessions/:id/runs/:runId/timeline` returning ordered run, approvals, events, and artifact metadata.
8. Update docs and runbook only if the public runbook behavior changes.

## Decision Log

- 2026-05-21: Event replay must use persisted DB ordering, not timestamps alone.
- 2026-05-21: Existing event names must remain supported during transition.
- 2026-05-21: Artifacts must be generic and separate from image message attachments.
- 2026-05-21: V1 stores artifact content inline in SQLite to avoid introducing filesystem/blob path safety in the same slice.
- 2026-05-21: `/sessions/:id/runs/:runId/events` remains backward-compatible by hydrating offloaded artifact payloads before returning events.
- 2026-05-21: Raw offloaded event references are an internal store option for tests/debug only, not the default client contract.
- 2026-05-21: Artifact content API is scoped by `sessionId + runId + artifactId`; no global artifact content endpoint in V1.

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

- Passed: `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/store-timeline-artifacts.test.ts src/core/approval-service.test.ts`
- Passed: `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/store-timeline-artifacts.test.ts`
- Passed: `pnpm --filter @surf-ai/bridge typecheck`
- Passed: `pnpm typecheck`
- Passed: `pnpm build`
- Passed after temporary bridge start: `pnpm evals` (`4/4` passed).

## Risk Review

- Avoided: event names are not renamed in V1.
- Fixed during risk review: default event replay hydrates large offloaded payloads, so refresh behavior matches live SSE for existing clients.
- Fixed during risk review: duplicate event IDs do not create orphan artifacts before `INSERT OR IGNORE`.
- Fixed during risk review: artifact content endpoint validates user, session, and run ownership.
- Artifact content is inline SQLite text in V1; this avoids path traversal risks but can grow DB/WAL if very large outputs are stored frequently.
- Retention reports now count artifacts for expired session purges; session deletion cascades artifact rows.
- Non-Codex `/sessions/:id/messages` path may not have full timeline parity yet.
- Sidepanel still uses `/events` + `/approvals`; timeline endpoint is additive/debug-first in V1.

## Likely Files

- `packages/shared/src/index.ts`
- `apps/bridge/src/core/store.ts`
- `apps/bridge/src/core/store-timeline-artifacts.test.ts`
- `apps/bridge/src/index.ts`
- `docs/harness/phase-5-event-timeline-artifacts.md`

## Final Status

DONE
