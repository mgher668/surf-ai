# Phase 10 Harness: OpenAI API Runtime Adapter

Status: PLANNED
Date: 2026-05-21

## Goal

Add a non-local-agent runtime adapter using OpenAI API so Surf can support both local agents and cloud/compatible model APIs behind the same runtime boundary.

## Scope

- Add OpenAI API adapter/runtime configuration.
- Support normal chat/run flow through sessions, messages, ContextEngine, timeline events, and existing UI adapter/model selection.
- Support OpenAI-compatible base URL where practical.
- Preserve Codex App Server behavior.
- Add mocked API tests so credentials are not required for validation.

## Non-Goals

- No Anthropic or Gemini direct API in this phase.
- No OpenAI tool calling until Tool Registry dispatch and approval policy are stable.
- No server-side shared billing/account management.
- No automatic model discovery unless endpoint support is reliable and explicitly configured.

## Subagent Plan

- Read-only analysis: map current adapter/runtime interfaces, model settings UI, config storage, and message/run persistence.
- Test supplement: own mocked OpenAI-compatible HTTP tests and adapter error tests.
- UI QA: verify adapter/model selection, message rendering, stream rendering, and error display.
- Risk review: focus on API key storage, context injection, provider errors, token/context limits, and no leakage into logs.

## Implementation Plan

1. Define OpenAI provider config shape: base URL, API key reference, model list, default model, and optional compatible endpoint settings.
2. Add runtime adapter that converts `ContextEngine` output and chat messages into OpenAI-compatible requests.
3. Stream response deltas into canonical run events.
4. Persist adapter/model metadata on runs/messages.
5. Add structured error handling for auth, rate limit, invalid model, stream disconnect, and unsupported content.
6. Add settings UI integration only if current model settings cannot represent OpenAI API cleanly.
7. Add mocked tests and docs.

## Decision Log

- 2026-05-21: OpenAI API is chosen as the first non-local-agent runtime validation target.
- 2026-05-21: OpenAI-compatible endpoints should be considered, but official OpenAI correctness comes first.
- 2026-05-21: Tool calling through OpenAI API is intentionally deferred.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Mocked OpenAI adapter tests.
- Manual run with configured compatible endpoint if credentials are available.
- Risk review for secrets, logs, and context boundaries.

## Validation Report

Not executed yet. This is a planning-only harness record.

## Risk Review

Planned review focus:

- API keys must not be logged, committed, or exposed to extension UI beyond configured secret handling.
- Provider errors must be structured and visible without leaking secrets.
- ContextEngine output must be fenced so page/memory context is not confused with user instruction.
- OpenAI adapter must not require Codex App Server concepts like thread/approval methods.
- Streaming disconnects must produce failed run events and not corrupt session history.

## Final Status

PLANNED
