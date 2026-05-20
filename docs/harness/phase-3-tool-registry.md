# Phase 3 Harness: Tool Registry V1

Status: IN_PROGRESS
Date: 2026-05-21

## Goal

Introduce a provider-neutral Tool Registry without changing runtime behavior first. The first implementation should expose stable tool metadata and discovery, then gradually migrate existing browser, backend, and runtime-native capabilities behind that conceptual model.

## Scope

- Add shared tool definition, risk, and result types.
- Add bridge `ToolRegistry` with static metadata registration.
- Expose tool discovery through `GET /tools` or `/capabilities.tools`.
- Treat browser page extraction and selected text as client-provided tool results.
- Register backend read-only capabilities first.
- Register runtime-native Codex approval/tool-like events as metadata/pass-through only.
- Preserve old `BridgeChatRequest.context` fields for backward compatibility.

## Non-Goals

- No full MCP client.
- No tool marketplace.
- No screenshot/new Chrome permission work.
- No artifact table.
- No destructive agent-callable backend tools.
- No generic approval policy engine unless Phase 4 has already provided it.
- No Tool Registry dispatch for privileged writes in V1.

## Dependencies

- Preferred execution order is after Phase 4 Approval Runtime and Phase 5 Event Timeline, because risky tools need stable approval and timeline primitives.
- If implemented earlier, Phase 3 must be discovery/metadata-only and must not add write-capable agent tools.

## Subagent Plan

- Read-only analysis: completed for planning; identified current tool-like capabilities across browser extraction, backend APIs, TTS/models/audit/retention, and runtime-native Codex approvals.
- Test supplement: during implementation, own schema/discovery shape tests only.
- UI QA: validate current-tab extraction, sidepanel actions, and backward compatibility after discovery integration.
- Risk review: focus on prompt injection, accidental exposure of privileged backend actions, and provider-specific metadata leakage.

## Implementation Plan

1. Add shared types for:
   - `BridgeToolDefinition`
   - `BridgeToolRisk`
   - `BridgeToolScope`
   - `BridgeToolResult`
2. Create `apps/bridge/src/core/tool-registry.ts`.
3. Register safe metadata entries:
   - browser selection context
   - current tab content result
   - session context preview
   - uploads/image attachments
   - TTS availability
   - runtime-native approval-capable operations
4. Add discovery endpoint or extend `/capabilities`.
5. Preserve existing request/context behavior.
6. Optionally wrap page extraction payloads in a tool-result-compatible envelope while keeping old fields.
7. Document risk levels and capability categories.

## Decision Log

- 2026-05-21: Phase 3 is planned after Phase 4/5 for implementation, despite its numeric order.
- 2026-05-21: First slice must be metadata/discovery-first, not agent-callable write tools.
- 2026-05-21: Browser extraction is client-provided context/tool result; bridge does not directly browse the user's tab.
- 2026-05-21: Phase 4 (`98a30c1`) and Phase 5 (`e1a0b2e`) are complete, so Phase 3 can safely expose metadata on top of approval/timeline primitives.
- 2026-05-21: V1 tool definitions are explicitly `metadataOnly: true` and `callable: false`; no handler, route, provider method, or dispatch schema is exposed.
- 2026-05-21: Tool discovery is additive through `/tools` and `/capabilities.tools`; legacy `/capabilities.chat` and `/capabilities.tts` shape is preserved.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Focused tests for tool schema, risk levels, and discovery response.
- Manual QA:
  - current tab extraction still works
  - run stream still works
  - approval decision still works
  - old `/chat` context compatibility still works

## Validation Report

- Passed: `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/tool-registry.test.ts`
- Passed: `pnpm --filter @surf-ai/bridge typecheck`
- Passed: `pnpm typecheck`
- Passed: `pnpm build`
- Passed after temporary bridge start: `pnpm evals` (`4/4` passed).

## Risk Review

- Resolved: Phase 4 Approval Runtime and Phase 5 Event Timeline/Artifacts completed before this implementation.
- Browser page content is untrusted and must not become executable instruction text.
- Enforced in metadata: current-tab extraction is `risk: "medium"`, `metadataOnly: true`, `callable: false`, and tagged `untrusted`.
- Do not expose retention purge, filesystem actions, or external writes as callable tools in V1.
- Runtime approvals are represented only as high-risk metadata and remain runtime-native; approval decisions are not exposed as generic tools.
- UI compatibility risk reduced by additive `/capabilities.tools`; existing clients that ignore `tools` remain compatible.
- Discovery intentionally avoids backend route names, handler names, storage paths, provider method names, purge internals, and approval payload schemas.

## Likely Files

- `packages/shared/src/index.ts`
- `apps/bridge/src/core/tool-registry.ts`
- `apps/bridge/src/core/tool-registry.test.ts`
- `apps/bridge/src/index.ts`
- `docs/harness/phase-3-tool-registry.md`

## Final Status

DONE
