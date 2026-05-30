# Phase UI-4: Agent Process Timeline

Status: DONE

## Goal

Make Surf AI's agent process events first-class UI: approvals, commentary, reasoning, command output, and runtime errors should read as an auditable execution timeline, not incidental debug blocks.

## Scope

- `apps/extension/src/ui/common/base.css`
- `apps/extension/src/ui/sidepanel/App.tsx`

## Non-Goals

- No event schema changes.
- No database or backend changes.
- No SSE/runtime logic changes.
- No changes to chronological sorting.
- No new dependencies.

## Subagent Plan

- `Read-only Analysis`: inspect current process rendering and style constants.
- `Test Supplement`: reuse existing standalone E2E approval/process replay checks.
- `UI QA`: validate approval card remains visible before and after decision.
- `Risk Review`: verify decision buttons still submit and process timeline text remains searchable.

## Implementation Plan

1. Add semantic process timeline classes.
2. Replace inline approval/process block styles with semantic classes.
3. Preserve existing details disclosure behavior for long content.
4. Keep approval decision buttons generated from server-provided options.
5. Run typecheck, build, and standalone E2E.

## Decision Log

- Keep one chronological timeline; do not move process events below final answers.
- Do not hide completed approvals.
- Keep raw reasoning collapsed by default via native `details`.
- Avoid icons beyond existing Iconify set for this phase.

## Validation Plan

- `pnpm --filter @surf-ai/extension typecheck`
- `pnpm --filter @surf-ai/extension build`
- `pnpm e2e:extension`

## Validation Report

- `pnpm --filter @surf-ai/extension typecheck`: passed.
- `pnpm --filter @surf-ai/extension build`: passed.
- `pnpm e2e:extension`: passed outside sandbox.
- In-sandbox E2E still cannot listen on `127.0.0.1`; this is an environment permission issue.
- One E2E failure found CSS `uppercase` changing visible text from `Intermediate Commentary` to `INTERMEDIATE COMMENTARY`; fixed by removing text-transform from dynamic process labels.

## Risk Review

- Main risk is breaking E2E text lookups for `Intermediate Commentary`, `Fixture approval`, and `Approved`.
- Mitigation: keep visible text unchanged; only change wrappers/classes.

## Final Status

DONE
