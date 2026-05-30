# Phase UI-3: Main Shell Redesign

Status: DONE

## Goal

Apply the new Surf AI visual system to the sidepanel/standalone main shell so the product feels like a premium minimal agent cockpit while preserving all runtime behavior.

## Scope

- `apps/extension/src/ui/sidepanel/App.tsx`
- Optional tiny supporting CSS additions in `apps/extension/src/ui/common/base.css` only if required.

## Non-Goals

- No runtime, bridge, SSE, session, storage, approval, memory, or extraction behavior changes.
- No settings page redesign.
- No popup redesign.
- No new dependency.
- No large component extraction unless needed for safety.

## Subagent Plan

- `Read-only Analysis`: inspect current shell, sidebar, header, conversation viewport, and composer hotspots.
- `Test Supplement`: reuse existing extension typecheck/build/E2E.
- `UI QA`: validate standalone smoke path; visual slow mode can be deferred unless user requests screenshots.
- `Risk Review`: verify message ordering, approvals, composer actions, theme persistence, and attachment controls remain reachable.

## Implementation Plan

1. Keep state and data functions unchanged.
2. Restyle session sidebar using semantic Tailwind classes and design-system tokens.
3. Restyle top header as compact cockpit command bar.
4. Restyle conversation viewport, empty state, and message cards without changing timeline construction.
5. Restyle composer footer as command console with clearer controls and status context.
6. Run typecheck, build, and extension E2E.

## Decision Log

- Keep sidepanel and standalone on the same component path.
- Use CSS/Tailwind only; no animation library.
- Leave process/tool event redesign to Phase UI-4 unless low-risk improvements naturally fit.
- Avoid broad extraction from the 5k-line `App.tsx` in this phase.

## Validation Plan

- `pnpm --filter @surf-ai/extension typecheck`
- `pnpm --filter @surf-ai/extension build`
- `pnpm e2e:extension`

## Validation Report

- `pnpm --filter @surf-ai/extension typecheck`: passed.
- `pnpm --filter @surf-ai/extension build`: passed.
- `pnpm e2e:extension`: in-sandbox run failed with `listen EPERM: operation not permitted 127.0.0.1`; re-run outside sandbox passed.
- One E2E failure occurred after a parallel build/e2e run loaded stale `dist` and saw transformed `SESSIONS`; after sequential rebuild and removing uppercase text transform from the sidebar title, E2E passed.
- Build warning: existing large chunks remain, mostly from Markdown/Mermaid dependencies. This phase did not introduce new runtime dependencies.

## Risk Review

- Risk: changing wrappers and focusable containers could break keyboard shortcuts or E2E selectors.
- Mitigation: keep existing handlers, refs, ARIA labels, and data attributes intact.

## Final Status

DONE
