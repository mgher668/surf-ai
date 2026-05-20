# Phase 9 Harness: Multi-Client CLI Smoke Client

Status: PLANNED
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

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- CLI smoke test.
- Manual CLI run against local bridge.
- Extension smoke after any shared API changes.

## Validation Report

Not executed yet. This is a planning-only harness record.

## Risk Review

Planned review focus:

- CLI must not bypass auth or user isolation.
- CLI must not require browser-only fields.
- SSE handling must be robust enough for basic reconnect/error reporting.
- Approval submission must be auditable and tied to the same user/session/run.

## Final Status

PLANNED
