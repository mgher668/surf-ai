# Phase 6B Harness: Standalone Extension Page E2E

Status: PLANNED
Date: 2026-05-21

## Goal

Add automated E2E coverage for the standalone extension page first, because it shares the main sidepanel UI and is easier to automate reliably than Chrome's real sidepanel surface.

## Scope

- Add Playwright or equivalent browser E2E setup for the standalone extension page.
- Add deterministic bridge fixture or mock server for stream and approval scenarios.
- Cover session loading, message send, SSE-style rendering, approval cards, timeline replay, and settings persistence.
- Document E2E commands for local development.

## Non-Goals

- No real Chrome extension sidepanel automation.
- No visual regression approval system unless needed for a concrete bug.
- No dependency on real Codex/OpenAI credentials.
- No broad UI redesign.

## Subagent Plan

- Read-only analysis: identify standalone page route, dev server command, bridge API dependencies, and current test tooling.
- Test supplement: own E2E test files and fixture server only.
- UI QA: run the E2E target manually once and compare against automated coverage gaps.
- Risk review: check test determinism, fixture realism, and accidental leakage of real bridge credentials or local data.

## Implementation Plan

1. Select E2E runner and package script.
2. Add local fixture server or mock bridge mode for deterministic sessions/runs/events/approvals.
3. Add tests for basic load, session list, sending a message, stream completion, and refresh replay.
4. Add tests for approval card rendering and decision submission.
5. Add settings persistence test for adapter/model/base URL fields where possible.
6. Keep fixtures small and explicit; avoid coupling tests to live Codex behavior.

## Decision Log

- 2026-05-21: Start with standalone extension page, not real Chrome sidepanel.
- 2026-05-21: E2E must be deterministic and should not require real local agent credentials.
- 2026-05-21: Sidepanel parity depends on shared UI components; real sidepanel automation remains a later hardening task.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- New E2E command passes locally.
- Manual standalone page smoke after E2E wiring.

## Validation Report

Not executed yet. This is a planning-only harness record.

## Risk Review

Planned review focus:

- Fake bridge fixtures can hide real integration bugs if too synthetic.
- E2E tests may become flaky if they depend on uncontrolled timing.
- The standalone page may diverge from true sidepanel behavior if shared UI assumptions break.
- Tests must not rely on real user sessions, tokens, or local SQLite data.

## Final Status

PLANNED
