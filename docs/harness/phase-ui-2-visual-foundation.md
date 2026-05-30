# Phase UI-2: Visual Foundation

Status: DONE

## Goal

Apply the Surf AI design-system baseline to global CSS tokens and shared shadcn-style primitives before touching the large sidepanel application file.

## Scope

- `apps/extension/src/ui/common/base.css`
- `apps/extension/src/ui/components/ui/button.tsx`
- `apps/extension/src/ui/components/ui/input.tsx`
- `apps/extension/src/ui/components/ui/textarea.tsx`
- `apps/extension/src/ui/components/ui/select.tsx`
- `apps/extension/src/ui/components/ui/badge.tsx`
- `apps/extension/src/ui/components/ui/dialog.tsx`
- `apps/extension/src/ui/components/ui/dropdown-menu.tsx`
- `apps/extension/src/ui/components/ui/sheet.tsx`
- `apps/extension/src/ui/components/ui/tabs.tsx`
- `apps/extension/src/ui/components/ui/sidebar.tsx`

## Non-Goals

- No sidepanel message-flow refactor.
- No settings page layout redesign.
- No runtime, storage, bridge, SSE, approval, session, or memory changes.
- No new dependencies.
- No remote fonts or external assets.

## Subagent Plan

- `Read-only Analysis`: completed in main thread by inspecting primitives, global CSS, and sidepanel usage.
- `Test Supplement`: not needed before implementation; existing typecheck/build/E2E will be used after.
- `UI QA`: deferred until Phase UI-3/4 because this phase changes foundation only.
- `Risk Review`: verify changes stay presentational and do not alter component APIs.

## Implementation Plan

1. Add design-system font, surface, shadow, motion, and status variables to `base.css`.
2. Update light/dark theme tokens to match `premium minimal agent cockpit`.
3. Add safe global body texture and text rendering improvements.
4. Update primitive components to use stronger radii, focus, active, hover, and surface rules.
5. Preserve all exported names and props.
6. Run extension typecheck/build.

## Decision Log

- Keep Tailwind v3 syntax only.
- Use CSS-only motion.
- Keep Iconify offline.
- Do not add local font files in this phase; define preferred stack with fallbacks.
- Do not edit `App.tsx` in this phase.

## Validation Plan

- `pnpm --filter @surf-ai/extension typecheck`
- `pnpm --filter @surf-ai/extension build`
- Inspect `git diff --stat` and ensure only scoped files changed.

## Validation Report

- `pnpm --filter @surf-ai/extension typecheck`: passed.
- `pnpm --filter @surf-ai/extension build`: passed.
- `pnpm e2e:extension`: passed after running outside the sandbox because the in-sandbox run failed with `listen EPERM: operation not permitted 127.0.0.1`.
- Build warning: existing large chunks remain, mostly from Markdown/Mermaid dependencies. This is not introduced by the visual foundation change.
- Changed files stayed inside the scoped UI foundation files plus this harness document.

## Risk Review

- Primitive style changes can affect all UI surfaces at once.
- Mitigation: keep class names compatible, avoid removing focus/disabled behavior, and avoid behavior props changes.

## Final Status

DONE
