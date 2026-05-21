# Phase 8 Harness: Memory V2 Durable Scopes

Status: DONE_WITH_CONCERNS
Date: 2026-05-21

## Goal

Expand memory beyond session summaries into explicit, inspectable, user-controlled durable memory scopes.

## Scope

- Add or finalize a general memory model for `user`, `workspace`, `page`, and `session` scopes.
- Add confirmed memory and candidate memory lifecycle.
- Require user confirmation before durable user memory persistence.
- Add inspect/delete APIs and UI surface.
- Integrate recalled memory into `ContextEngine` with fences, attribution, confidence, and evidence refs.

## Non-Goals

- No vector database.
- No cross-user shared memory.
- No silent persistence of sensitive long-term user memory.
- No automatic self-modifying skills.
- No memory marketplace or sync service.

## Subagent Plan

- Read-only analysis: map existing `session_memories`, retrieval, ContextEngine injection, UI settings/history surfaces, and schema migration patterns.
- Test supplement: own memory CRUD, scope isolation, candidate confirmation, deletion, and context injection tests.
- UI QA: inspect confirm/edit/delete flows and verify memory is visible and removable.
- Risk review: focus on privacy, prompt injection, evidence attribution, stale memory, and deletion guarantees.

## Implementation Plan

1. Design schema for durable memories and candidate memories.
2. Add MemoryService APIs for list/create/update/delete/recall by scope.
3. Add candidate extraction after run completion using current available local agent/model.
4. Keep candidate memory separate until user confirms.
5. Add UI for review, confirm, edit, and delete.
6. Inject recalled memory through ContextEngine only with explicit fences and source refs.
7. Add retention/privacy controls and audit events.

## Decision Log

- 2026-05-21: Durable user memory must require user confirmation.
- 2026-05-21: Hermes memory ideas are architecture input only; implementation must remain Surf-native.
- 2026-05-21: Memory recall must be attributable and fenced, not silently blended into user messages.
- 2026-05-21: Phase 8 ships user-controlled candidate/confirm/delete first; automatic candidate extraction is deferred to avoid silent privacy mistakes.
- 2026-05-21: Recalled memory is injected as JSON fenced reference data, not XML-like pseudo-tags, because raw pseudo-tags can be escaped by malicious memory content.
- 2026-05-21: Candidate and rejected memories are inspectable but never recalled into ContextEngine.
- 2026-05-21: Workspace scope is schema-ready but dormant until a real `workspaceId` source is added to chat context.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Memory CRUD and scope isolation tests.
- Candidate-to-confirmed lifecycle tests.
- ContextEngine injection tests with fences and evidence refs.
- Manual UI QA for inspect/confirm/delete.

## Validation Report

- `pnpm --filter @surf-ai/bridge typecheck`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/memory-service.test.ts src/core/context-engine.test.ts`: PASS.
- `pnpm --filter @surf-ai/bridge exec node --import tsx --test src/core/memory-service.test.ts src/core/context-engine.test.ts src/core/tool-dispatcher.test.ts`: PASS.
- `pnpm build`: PASS.
- Temporary bridge eval command with `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43139`: PASS, 4/4 evals.
- Memory API smoke with temporary bridge:
  - `POST /sessions`: PASS.
  - `POST /memories`: PASS, creates candidate.
  - `GET /memories/recall` before confirm: PASS, returns 0.
  - `POST /memories/:id/confirm`: PASS.
  - `GET /memories/recall` after confirm: PASS, returns 1.
  - `DELETE /memories/:id`: PASS.
  - `GET /memories/recall` after delete: PASS, returns 0.
- `pnpm --filter @surf-ai/extension e2e:standalone`: PASS.

Implemented:

- Added shared durable memory types for scope, status, kind, create/list/response/delete payloads.
- Added `durable_memories` SQLite table with `user_id`, `scope`, `scope_key`, `session_id`, `status`, confidence, source refs, timestamps, `last_used_at`, and `expires_at`.
- Added store CRUD/recall APIs with user/session ownership checks and user-scoped page/workspace keys.
- Added MemoryService candidate creation, confirmation, rejection, deletion, recall, and JSON fenced formatting.
- Added authenticated bridge memory APIs: list, recall, create candidate, confirm, reject, delete.
- Added settings UI Memory section for reviewing candidate/confirmed memories, confirming, rejecting, deleting, and refreshing.
- Added ContextEngine recall of confirmed durable memories with attribution and JSON fences.
- Changed old session facts/todos handoff strings to JSON fenced memory blocks.
- Added tests for candidate lifecycle, cross-user/page-scope isolation, JSON fence injection safety, and ContextEngine durable memory injection.

## Risk Review

Planned review focus:

- Bad extraction can pollute future context.
- User memory can accidentally store secrets or sensitive personal data.
- Prompt injection can enter through recalled page/session memory.
- Delete must remove memory from future recall and UI lists.
- Memory confidence/source refs must be visible enough for debugging.

Read-only review findings addressed:

- Cross-scope isolation: every durable memory row includes `user_id`; all list/recall/confirm/reject/delete paths filter by authenticated user.
- Raw memory injection: ContextEngine now injects JSON fenced memory with explicit non-instruction wording.
- Fence escaping: memory content is JSON serialized inside code fences; pseudo-XML closing tags stay quoted data.
- Confirmation boundary: `POST /memories` creates candidates only; only explicit confirm API transitions to confirmed; only confirmed memories are recalled.
- Audit privacy: memory audit events store IDs, scope, kind, and source type only, never memory body text.
- Staleness/retention: durable memory has `confidence`, `updated_at`, `confirmed_at`, `last_used_at`, and optional `expires_at`; expired memories are excluded from recall and purged by maintenance.

Residual risks / deferred work:

- Automatic candidate extraction after run completion is deferred. This is deliberate because extraction quality and sensitive-data filtering need a separate evaluator pass.
- Settings UI supports confirm/reject/delete but not inline editing yet.
- Workspace memory is persisted and listable, but not recalled automatically until the product has a real workspace identity in chat context.
- No tombstone/recreation-prevention table yet; rejected memories remain visible as rejected, hard-deleted memories can be recreated manually.

## Final Status

DONE_WITH_CONCERNS
