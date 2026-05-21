# Phase 10 Harness: OpenAI API Runtime Adapter

Status: DONE_WITH_CONCERNS
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
- 2026-05-21: Use Chat Completions shape for Phase 10 because it is the common OpenAI-compatible denominator.
- 2026-05-21: `openai-compatible` becomes a real adapter/runtime; `anthropic` and `gemini` remain fallback aliases.
- 2026-05-21: OpenAI API keys are read only from bridge environment variables, not from extension storage.
- 2026-05-21: OpenAI-compatible context is injected as fenced JSON reference data before history, not as executable instructions.

## Validation Plan

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`
- Mocked OpenAI adapter tests.
- Manual run with configured compatible endpoint if credentials are available.
- Risk review for secrets, logs, and context boundaries.

## Validation Report

- PASS `pnpm typecheck`
- PASS `pnpm build`
- PASS `pnpm test:bridge`
- PASS temp bridge evals: `4/4 passed`
- PASS `pnpm cli:smoke`
- PASS `pnpm e2e:extension`

## Risk Review

- API keys: kept server-side in env (`SURF_AI_OPENAI_API_KEY` / `OPENAI_API_KEY`), not persisted in SQLite or extension storage.
- Error leakage: provider error messages are capped and redact configured key/Bearer tokens before surf error propagation.
- Context boundary: page/selection context is injected as fenced JSON reference data with explicit non-instructional wording.
- Runtime separation: OpenAI-compatible runtime does not use Codex thread/approval concepts and does not alter Codex App Server approval flow.
- Stream failures: non-OK provider responses and malformed stream chunks fail the run through existing `session_run_failed` handling.
- Remaining concern: no real OpenAI credential smoke was run in this phase; validation uses mocked API streams only.
- Remaining concern: OpenAI tool calling is deliberately not enabled, so provider-native tool approval semantics remain out of scope.

## Final Status

DONE_WITH_CONCERNS
