# Phase 7 Harness: Tool Registry V2 Dispatch

Status: PLANNED
Date: 2026-05-21

## Goal

Upgrade Tool Registry from metadata discovery to a controlled Surf-owned backend tool dispatch boundary.

## Scope

- Add callable read-only backend tools first.
- Route dispatch through registry metadata, schema validation, ownership checks, approval policy, execution, timeline events, and audit logging.
- Keep provider-native tools separate from Surf-owned tools.
- Keep browser page extraction as client-provided untrusted context/tool result.

## Non-Goals

- No external MCP client.
- No tool marketplace.
- No destructive filesystem or database mutation tools in the first dispatch slice.
- No automatic browser tab control from backend.
- No bypass of Codex App Server's own provider-native tool semantics.

## Subagent Plan

- Read-only analysis: map existing tool-like backend capabilities and classify read/write/external/privileged risks.
- Test supplement: own dispatcher, schema, approval, authorization, and timeline tests.
- UI QA: verify discovered/callable tools display or execute through the intended UI path if UI is touched.
- Risk review: focus on privilege escalation, prompt injection, user isolation, audit completeness, and provider-specific leakage.

## Implementation Plan

1. Define dispatcher interfaces and handler contracts.
2. Add schema validation for tool inputs and structured tool results.
3. Register first read-only tools, likely context preview, session search, and artifact metadata read.
4. Persist `tool.started`, `tool.output`, and `tool.failed` timeline events.
5. Route approval-required tools through `ApprovalService` before execution.
6. Add authenticated bridge API for dispatch.
7. Add tests for unknown tool, invalid input, wrong user/session, read-only success, approval-required block, and timeline replay.

## Decision Log

- 2026-05-21: V2 starts with read-only Surf backend tools, not external MCP or write-capable actions.
- 2026-05-21: Provider-native Codex tools remain provider-native; Surf-owned tools use Surf's dispatcher.
- 2026-05-21: Tool execution must be reconstructable from run timeline.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Focused dispatcher and authorization tests.
- Timeline replay test for tool events.
- Manual QA with one read-only tool and one blocked/approval-required path.

## Validation Report

Not executed yet. This is a planning-only harness record.

## Risk Review

Planned review focus:

- Registry discovery must not expose internal route names, secrets, filesystem paths, or privileged implementation details.
- Tool handlers must enforce `userId` and `sessionId` ownership independently of caller-supplied metadata.
- Browser/page content must stay untrusted and never become executable instruction text.
- Approval policy must be enforced before side effects, not after.
- Timeline/audit events must be written for both success and failure paths.

## Final Status

PLANNED
