# Phase 9 Harness: Multi-Client CLI Smoke Client

Status: DONE
Date: 2026-05-21

## Goal

Prove Surf is a backend Agent Runtime and not only a browser-extension backend by adding a minimal non-extension CLI client.

## Scope

- Add a minimal CLI smoke client or script.
- Support bridge connection, session listing, run start/message send, event streaming, and approval response.
- Add minimal client identity/capability contract only if required.
- Keep browser extension behavior unchanged.

## Non-Goals

- No full terminal UI.
- No public SaaS account system.
- No complex pairing UX.
- No MCP/ACP bridge.
- No replacement of browser extension UX.

## Subagent Plan

- Read-only analysis: map current bridge APIs, auth headers, SSE behavior, approval endpoint, and package layout options.
- Test supplement: own CLI smoke tests and mock bridge fixtures.
- UI QA: verify browser extension still works after any shared API changes.
- Risk review: focus on auth, client isolation, SSE reconnect behavior, and accidental coupling to extension-specific fields.

## Implementation Plan

1. Decide first location: `apps/cli` or `scripts/surf-cli.mjs`.
2. Define minimal client identity and capability headers if needed.
3. Implement list sessions and send message/start run.
4. Stream ordered events to stdout.
5. Support approval prompts in terminal for pending approvals.
6. Add smoke tests with mock or local bridge.
7. Document usage in README/RUNBOOK.

## Decision Log

- 2026-05-21: CLI is a proof of runtime boundary, not a product-grade client.
- 2026-05-21: CLI must use the same backend truth source as the extension.
- 2026-05-21: Extension-specific page context remains optional client capability, not a required run input.
- 2026-05-21: Chose `scripts/surf-cli.mjs` instead of `apps/cli` to keep Phase 9 a smoke client, not a maintained product surface.
- 2026-05-21: CLI uses existing bridge headers (`x-surf-user-id`, optional `x-surf-token`) and existing session/run/approval/SSE APIs without extension-specific fields.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- CLI smoke test.
- Manual CLI run against local bridge.
- Extension smoke after any shared API changes.

## Validation Report

- PASS `pnpm cli:smoke`
- PASS `pnpm typecheck`
- PASS `pnpm build`
- PASS temp bridge evals: `4/4 passed`
- PASS `pnpm e2e:extension`

## Risk Review

- Auth/user isolation: CLI goes through the same bridge headers and does not introduce privileged routes.
- Browser coupling: CLI send path only requires message, adapter, optional model, and session id.
- SSE behavior: smoke fixture validates streamed assistant deltas and approval event handling.
- Approval auditability: CLI submits decisions through the same run approval endpoint, preserving backend audit path.
- Product boundary: CLI remains a proof client and intentionally avoids terminal UI/session management complexity.

## Final Status

DONE
