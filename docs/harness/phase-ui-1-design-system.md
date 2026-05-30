# Phase UI-1: Design System

Status: DONE

## Goal

Create a stable design-system source of truth for Surf AI's extension UI redesign.

## Scope

- Define visual direction, color roles, typography, layout, component styling, message timeline, process events, settings UI, motion, accessibility, and implementation rules.
- Output: `docs/design/surf-ai-design-system.md`

## Non-Goals

- No source code changes.
- No generated mockups.
- No dependency installation.
- No brand/logo work.

## Subagent Plan

No subagent execution is required for this documentation-only phase. Future code phases should use:

- `Read-only Analysis`: map the design system to existing components and identify extraction points.
- `UI QA`: verify sidepanel and standalone layouts against the design system.
- `Risk Review`: ensure visual refactors do not change runtime behavior.

## Implementation Plan

1. Convert the selected direction into concrete UI rules.
2. Keep the rules compatible with Chrome extension constraints.
3. Preserve the existing tech stack.
4. Make message/process/approval UI a first-class part of the design system.
5. Define validation rules for future implementation phases.

## Decision Log

- Visual direction: premium minimal agent cockpit.
- Density: medium. Narrow sidepanel is compact; standalone is calmer and wider.
- Accent policy: one primary accent only.
- Typography policy: prefer local/system-safe sans and mono stacks; no remote font loading by default.
- Motion policy: CSS-first, restrained, functional.
- Component policy: customize shadcn-style primitives instead of adding a new UI kit.

## Validation Plan

- Confirm the design-system document covers the main extension surfaces.
- Confirm it does not require new dependencies.
- Confirm it includes explicit anti-patterns and acceptance criteria.

## Validation Report

- Created `docs/design/surf-ai-design-system.md`.
- No code changed.
- Existing unrelated dirty files were not touched.

## Risk Review

- Risk: over-designed UI could reduce clarity in a dense agent product.
- Mitigation: the design system prioritizes timeline clarity, compact status blocks, readable typography, and restrained motion over decorative effects.

## Final Status

DONE
