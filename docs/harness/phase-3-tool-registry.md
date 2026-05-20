# Phase 3 Harness: Tool Registry V1

Status: PLANNED
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

Not run. This harness is planning-only.

## Risk Review

- Phase order risk: Tool Registry becomes useful only after approval/event primitives are stable.
- Browser page content is untrusted and must not become executable instruction text.
- Do not expose retention purge, filesystem actions, or external writes as callable tools in V1.
- Runtime-native Codex approval payloads may stay provider-specific until Phase 4/5 normalize them.
- Worktree risk: current dirty Codex runtime file overlaps likely Phase 3 metadata integration.

## Likely Files

- `packages/shared/src/index.ts`
- `apps/bridge/src/core/tool-registry.ts`
- `apps/bridge/src/index.ts`
- `apps/bridge/src/runtimes/types.ts`
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts` only for metadata attachment after Phase 4/5
- `apps/extension/src/background/index.ts`
- `apps/extension/src/content/index.ts`
- `apps/extension/src/ui/sidepanel/App.tsx`
- `docs/bridge-api.md`

## Final Status

PLANNED
