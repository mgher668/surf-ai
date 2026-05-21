# Phase 6B Harness: Standalone Extension Page E2E

Status: DONE
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
- 2026-05-21: Use system Chromium + native Chrome DevTools Protocol instead of adding Playwright dependency.
- 2026-05-21: Load the real built MV3 extension from `apps/extension/dist`, not a Vite-only React page, because the UI depends on `chrome.storage` and extension APIs.
- 2026-05-21: Use a deterministic in-process fixture bridge for sessions, runs, SSE, approvals, models, tools, and capabilities.
- 2026-05-21: Discover the unpacked extension ID from Chrome preferences or extension service worker targets to avoid accidentally selecting built-in Chrome extensions.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- New E2E command passes locally.
- Manual standalone page smoke after E2E wiring.

## Validation Report

- `pnpm --filter @surf-ai/extension build`: PASS.
- `pnpm --filter @surf-ai/extension typecheck`: PASS.
- `pnpm --filter @surf-ai/extension e2e:standalone`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- `pnpm evals`: direct run expectedly failed without bridge running.
- Temporary bridge eval command with `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43139`: PASS, 4/4 evals.

E2E coverage added:

- Opens real extension standalone sidepanel URL: `chrome-extension://<id>/src/ui/sidepanel/index.html`.
- Seeds `chrome.storage.local` with deterministic bridge connection, locale, adapter, theme, and sidebar preferences.
- Verifies initial standalone page load and empty state.
- Sends a message through `/sessions/:id/runs`.
- Verifies SSE assistant answer rendering.
- Verifies process timeline replay through persisted run events after reload.
- Verifies approval card rendering and approval decision submission.
- Verifies post-approval assistant answer continuation.
- Verifies approval state and answer replay after reload.
- Verifies theme persistence from extension storage.

Environment notes:

- The E2E command needs local loopback listening and Chromium startup. In sandboxed environments it may require elevated execution.
- The eval command also needs a running bridge. For isolated validation, start bridge on a temporary port and set `SURF_AI_EVAL_BASE_URL`.

## Risk Review

- Fake bridge fixtures can hide real integration bugs if too synthetic.
- E2E tests may become flaky if they depend on uncontrolled timing.
- The standalone page may diverge from true sidepanel behavior if shared UI assumptions break.
- Tests must not rely on real user sessions, tokens, or local SQLite data.
- Current fixture intentionally covers the critical standalone page contract only. It does not cover uploads, TTS, cancel, rename, delete, star, adapter updates, or real Codex/OpenAI runtime behavior.
- The test validates UI behavior against the bridge API shape, not model quality or real agent output.
- Real sidepanel automation is still out of scope; standalone and sidepanel currently share the same app entry behavior, but Chrome sidepanel shell issues would need a later browser QA phase.

Read-only review outcome:

- Fixed a top-level execution ordering bug by moving test execution into `main()`.
- Fixed extension ID discovery to avoid built-in Chrome extensions.
- Fixed Chrome cleanup so an already-exited browser process cannot hang finalization.
- Made approval fixture more realistic by continuing the SSE stream after approval and emitting terminal run events.
- Added replay assertions for approval state and process timeline.

## Final Status

DONE
