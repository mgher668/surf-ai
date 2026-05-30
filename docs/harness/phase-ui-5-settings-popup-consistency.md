# Phase UI-5: Settings And Popup Consistency

Status: DONE

## Goal

Align the settings page and popup with the same premium minimal agent cockpit visual system used by sidepanel/standalone.

## Scope

- `apps/extension/src/ui/common/base.css`
- `apps/extension/src/ui/settings/App.tsx`
- `apps/extension/src/ui/popup/App.tsx`
- `apps/extension/src/ui/popup/index.html`
- `apps/extension/src/ui/popup/popup.css`

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

Post-completion update, 2026-05-31:

- Popup toolbar menu flicker was traced to the extension popup having no stable dimensions until React and Tailwind-rendered content mounted.
- Added a popup-specific early stylesheet linked from `src/ui/popup/index.html` so Chrome can size the popup before the React entry script runs.
- Matched `.surf-popup-shell` to the same minimum height and kept the command card top-aligned to avoid a resize/stretch flash.
- `pnpm --filter @surf-ai/extension typecheck` passed.
- `pnpm --filter @surf-ai/extension build` passed.
- Browser screenshot verification was not completed in the local agent environment because Playwright is not installed there; the Vite dev server and popup CSS endpoint were verified during the fix pass.

## Risk Review

- Settings page is not directly covered by current E2E; avoid changing logic and inputs.
- Popup is not directly covered by current E2E; keep button handlers unchanged.
- Popup flicker fix is layout-only. Residual risk is real Chrome extension popup compositor behavior, which should be manually checked after loading `apps/extension/dist` as an unpacked extension.

## Final Status

DONE.
