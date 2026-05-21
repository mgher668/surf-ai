# Phase 7 Harness: Tool Registry V2 Dispatch

Status: DONE
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
- 2026-05-21: Callable V2 slice is limited to `session.context_preview`, `session.messages.search`, `runtime.event_timeline`, and `runtime.artifact_metadata`.
- 2026-05-21: Browser/page tools and provider-native approval tools stay metadata-only.
- 2026-05-21: Every persisted tool timeline event carries an immutable `toolCallId`.
- 2026-05-21: Runtime timeline tool returns a redacted model-facing view; raw event payloads remain available only through existing authenticated timeline APIs.
- 2026-05-21: `runtime.event_timeline` persists only output summary counts in `tool.output`, avoiding recursive large timeline snapshots.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Focused dispatcher and authorization tests.
- Timeline replay test for tool events.
- Manual QA with one read-only tool and one blocked/approval-required path.

## Validation Report

- `pnpm --filter @surf-ai/shared typecheck`: PASS.
- `pnpm --filter @surf-ai/bridge typecheck`: PASS.
- `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/tool-registry.test.ts src/core/tool-dispatcher.test.ts src/core/store-timeline-artifacts.test.ts src/core/approval-service.test.ts`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- Temporary bridge eval command with `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43139`: PASS, 4/4 evals.
- HTTP smoke with temporary bridge:
  - `POST /sessions`: PASS.
  - `POST /tools/session.context_preview/call`: PASS, returned callable tool metadata, structured result, and `toolCallId`.

Implemented:

- Added shared `BridgeToolCallRequest`, `BridgeToolCallResult`, and `BridgeToolCallResponse`.
- Added `tool.started`, `tool.output`, and `tool.failed` timeline event types.
- Added `ToolDispatcher` with schema validation, authenticated user/session/run ownership checks, read-only handlers, event publishing, and structured errors.
- Added authenticated `POST /tools/:toolId/call`.
- Made first Surf-owned tools callable while keeping client/browser/provider-native tools metadata-only.
- Added focused dispatcher tests for unknown tool, metadata-only rejection, invalid input, wrong user, run-required behavior, successful dispatch, timeline events, strict empty input, and timeline replay.

## Risk Review

Planned review focus:

- Registry discovery must not expose internal route names, secrets, filesystem paths, or privileged implementation details.
- Tool handlers must enforce `userId` and `sessionId` ownership independently of caller-supplied metadata.
- Browser/page content must stay untrusted and never become executable instruction text.
- Approval policy must be enforced before side effects, not after.
- Timeline/audit events must be written for both success and failure paths.

Read-only review findings addressed:

- Cross-session read risk: dispatcher re-resolves session and run through `BridgeStore` using authenticated `userId`; mismatches fail closed.
- Ambiguous replay risk: all tool events include immutable `toolCallId`, and audit success records include it.
- Sensitive timeline leakage risk: dispatcher runtime timeline output is redacted and omits raw approval payloads, reasoning text, command output, thread ids, and turn ids.
- Arbitrary input persistence risk: no-input runtime tools use strict empty schemas.
- Large timeline recursion risk: `runtime.event_timeline` persists only summary counts in its `tool.output` event while returning the redacted result in the HTTP response.

Residual risks:

- This phase does not yet expose a first-class UI for manual tool invocation.
- Approval-required Surf-owned tools are intentionally blocked until a later write-capable tool phase.
- Provider-native Codex/MCP tools remain controlled by the Codex App Server path, not this Surf-owned dispatcher.

## Final Status

DONE
