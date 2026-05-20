# Phase 8 Harness: Memory V2 Durable Scopes

Status: PLANNED
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

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Memory CRUD and scope isolation tests.
- Candidate-to-confirmed lifecycle tests.
- ContextEngine injection tests with fences and evidence refs.
- Manual UI QA for inspect/confirm/delete.

## Validation Report

Not executed yet. This is a planning-only harness record.

## Risk Review

Planned review focus:

- Bad extraction can pollute future context.
- User memory can accidentally store secrets or sensitive personal data.
- Prompt injection can enter through recalled page/session memory.
- Delete must remove memory from future recall and UI lists.
- Memory confidence/source refs must be visible enough for debugging.

## Final Status

PLANNED
