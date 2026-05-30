# Phase UI-0: Design Audit

Status: DONE_WITH_CONCERNS

## Goal

Audit the current Surf AI extension UI before redesign work starts. The goal is to identify high-impact visual, interaction, and code-structure issues without changing runtime behavior.

## Scope

- Main shared chat surface: `apps/extension/src/ui/sidepanel/App.tsx`
- Shared global styles: `apps/extension/src/ui/common/base.css`
- shadcn-style primitives: `apps/extension/src/ui/components/ui/*`
- Settings and popup are reviewed as downstream surfaces, not redesigned in this phase.

## Non-Goals

- No code changes.
- No visual mockup generation.
- No new dependency selection.
- No runtime, storage, bridge, or SSE behavior changes.

## Skill Inputs

- `redesign-existing-projects`: used as the audit checklist for existing UI, anti-generic patterns, and targeted upgrade priority.
- `design-taste-frontend`: used to set implementation guardrails for React, Tailwind v3, shadcn customization, CSS-safe motion, and responsive layout.
- `high-end-visual-design`: used selectively for premium surface and motion principles, but not for marketing-page/Awwwards-style over-animation.
- `stitch-design-taste`: used to structure the permanent design-system document.

## Current Baseline

- Stack: React 18, Vite, TailwindCSS v3, Radix/shadcn-style components, Iconify offline MDI icons.
- Main chat UI and standalone page share the sidepanel entry.
- Global tokens already exist in `base.css`, including light/dark variables, message colors, hint colors, markdown colors, and body radial background.
- `App.tsx` is functionally rich but very large and mixes state logic, data operations, UI layout, inline styles, and presentational helpers in one file.
- Current typography uses `"Noto Sans", "PingFang SC", "Segoe UI", sans-serif`.

## Audit Findings

### 1. Visual Identity Is Functional But Not Distinct

The current teal/cyan palette is coherent, but it reads like a safe productivity app rather than a strong agent cockpit. The app has a usable visual baseline but lacks a memorable surface language.

Recommended direction: premium minimal agent cockpit with cool charcoal/off-white neutrals, one restrained teal/green accent, and stronger mono metadata treatment.

### 2. Typography Needs Stronger Hierarchy

The current stack is safe for Chinese/English rendering but visually generic. Metadata, run status, adapter/model labels, timestamps, and tool names should use a mono stack. Headings and primary labels need stronger weight and tighter tracking.

Constraint: Chrome extension CSP and offline-first behavior mean remote web fonts should be avoided unless packaged locally.

### 3. Inline Styles Make Visual Consistency Hard

The main UI uses many inline style objects around header, conversation viewport, session rows, hints, approvals, and composer surfaces. This makes it difficult to enforce a consistent design system, hover states, density scale, and responsive rules.

Best-practice fix: migrate visual patterns gradually into reusable class names and component primitives. Do not rewrite the whole file in one step.

### 4. shadcn Primitives Are Still Close To Defaults

Button, input, dropdown, select, and card-like surfaces mostly follow default shadcn geometry and simple hover color changes. They need Surf-specific radii, tactile active states, stronger focus states, and consistent surface depth.

Best-practice fix: update primitives first, then replace one-off inline style usage progressively.

### 5. Message Timeline Needs Stronger Information Architecture

The product is now a general AI agent runtime, not just a chat box. The UI must visually separate:

- user messages
- assistant final answers
- commentary/reasoning/process events
- tool approvals
- tool results
- runtime errors
- retry/regenerate states

Current timeline support exists, but the visual hierarchy does not yet make the agent process feel first-class.

### 6. Agent Process UI Needs Persistent, Scannable Blocks

Tool approvals and process events are functionally present, but they should feel like a structured execution log with compact rows, clear status, timestamps, and collapsible details. This is critical for user trust.

### 7. Empty, Loading, Error, And Offline States Need A Unified System

The app already has hints and runtime alerts. They should be redesigned as a coherent status system:

- empty conversation
- bridge disconnected
- model unavailable
- streaming in progress
- run failed
- approval pending
- memory/retrieval context attached

### 8. Responsive Behavior Must Treat Sidepanel And Standalone Differently

The same UI entry serves a narrow sidepanel and wider standalone page. The layout should not merely stretch. Standalone should gain a calmer max-width layout, stronger sidebar/content proportions, and more breathing room; sidepanel should stay compact.

### 9. Motion Should Be Restrained And Useful

No heavy GSAP/Framer dependency is justified now. Use CSS-only motion:

- streaming cursor/pulse
- staggered list entry
- tactile active button transform
- skeleton shimmer
- collapse/expand transitions

Animate only `transform` and `opacity` where possible.

### 10. Icons Are Offline And Consistent Enough

Iconify offline MDI is already used. Do not introduce another icon library during the redesign unless there is a clear reason. Instead, standardize icon size, opacity, and placement.

## Recommended Refactor Order

1. Freeze design tokens and component rules in `docs/design/surf-ai-design-system.md`.
2. Update global CSS variables, typography, background, focus, and motion tokens.
3. Customize shared primitives: button, input, textarea, select, dialog, dropdown, badge.
4. Extract message/process visual components from `App.tsx` without changing data flow.
5. Redesign main shell: sidebar, header, conversation viewport, composer.
6. Redesign settings page after the main shell stabilizes.
7. Run extension E2E and visual slow-mode QA.

## Subagent Plan

Future implementation phases should split work as:

- `Read-only Analysis`: inspect sidepanel/settings coupling and inline-style hotspots.
- `Test Supplement`: maintain E2E checks and add stable selectors where needed.
- `UI QA`: run standalone extension path, inspect narrow and wide viewport behavior.
- `Risk Review`: verify no runtime, session, approval, or bridge behavior regression.

## Validation Plan

For this audit phase:

- Verify referenced files exist.
- Verify the proposed design direction matches the current stack.
- Confirm no source code changes are required.

For implementation phases:

- `pnpm --filter @surf-ai/extension typecheck`
- `pnpm --filter @surf-ai/extension build`
- `pnpm e2e:extension`
- Optional visual run: `SURF_AI_E2E_HEADLESS=0 SURF_AI_E2E_STEP_DELAY_MS=1000 pnpm e2e:extension`

## Validation Report

- Repository files inspected: `base.css`, `App.tsx`, `button.tsx`, `tailwind.config.cjs`, `package.json`.
- No runtime code changed.
- Existing unrelated dirty files were not touched: `README.md`, `apps/extension/e2e/standalone-smoke.mjs`, `temp/`.

## Risk Review

- Main risk: visual refactor in `App.tsx` can accidentally affect streaming, approvals, attachments, session selection, and local cache behavior.
- Mitigation: extract presentational components first, keep data/state functions unchanged, and validate after each step.
- Do not introduce remote font loading or animation libraries unless explicitly approved.

## Decision Log

- Decision: default visual direction is `premium minimal agent cockpit`.
- Decision: keep current React + Tailwind v3 + shadcn-style + Iconify offline stack.
- Decision: no remote web fonts by default.
- Decision: process events and tool approvals are first-class UI, not secondary metadata.

## Final Status

DONE_WITH_CONCERNS

Concern: this phase is code/static audit only. A later UI QA phase should capture screenshots or run the standalone page visually before and after redesign.
