# Phase UI-5: Settings And Popup Consistency

Status: DONE

## Goal

Align the settings page and popup with the same premium minimal agent cockpit visual system used by sidepanel/standalone.

## Scope

- `apps/extension/src/ui/common/base.css`
- `apps/extension/src/ui/settings/App.tsx`
- `apps/extension/src/ui/popup/App.tsx`

## Non-Goals

- No settings behavior changes.
- No model, connection, memory, or storage changes.
- No new routes or dependencies.
- No form schema changes.

## Implementation Plan

1. Add shared settings/popup surface classes.
2. Restyle settings shell, header, side navigation, cards, and memory rows.
3. Restyle popup as compact command card.
4. Run typecheck/build/E2E.

## Validation Plan

- `pnpm --filter @surf-ai/extension typecheck`
- `pnpm --filter @surf-ai/extension build`
- `pnpm e2e:extension`

## Validation Report

- `pnpm --filter @surf-ai/extension typecheck` passed.
- `pnpm --filter @surf-ai/extension build` passed.
- `pnpm e2e:extension` passed with extension fixture:
  - sessions: 1
  - runs: 2
  - decisions: 1
- Build still reports existing large chunk warnings from Mermaid/KaTeX-related bundles. This is not a behavioral failure and was not introduced by the settings/popup styling pass.

## Risk Review

- Settings page is not directly covered by current E2E; avoid changing logic and inputs.
- Popup is not directly covered by current E2E; keep button handlers unchanged.

## Final Status

DONE.
