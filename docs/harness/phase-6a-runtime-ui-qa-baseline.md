# Phase 6A Harness: Runtime And UI QA Baseline

Status: PLANNED
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

- Read-only analysis: map current runtime/UI paths, required bridge endpoints, and data persistence expectations.
- Test supplement: add focused tests only for defects found during QA; write scope limited to test files unless a fix is explicitly assigned.
- UI QA: run standalone extension page and sidepanel smoke flows; record screenshots or exact reproduction notes for failures.
- Risk review: inspect persistence, timeline replay, approval recovery, and untrusted page context handling.

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

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Manual QA matrix covering:
  - new run and stream rendering
  - refresh/replay
  - approval request and decision
  - page extraction context
  - settings persistence
  - bridge restart recovery
- Risk review of persistence and untrusted context boundaries.

## Validation Report

Not executed yet. This is a planning-only harness record.

## Risk Review

Planned review focus:

- UI may show live stream correctly but fail persisted replay.
- Approval events may be recoverable in backend but not visible in UI after refresh.
- Page extraction content is untrusted and must remain clearly contextual.
- Bridge restart may leave runs/approvals in ambiguous states.
- SQLite test data and local user state must not be accidentally committed.

## Final Status

PLANNED
