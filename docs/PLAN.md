# Product Plan (v0.1)

## 1. Scope Baseline

This repository follows a local-first architecture for personal usage.

- Primary backend mode: local Agent bridge (`codex` / `claude`).
- TTS mode: MiniMax Text to Speech via `/tts`.
- Data persistence: browser local storage + IndexedDB.

## 2. Locked Decisions (Current)

1. Chat backend priority is local Agent adapters, not hosted LLM APIs.
2. MiniMax is integrated for TTS only in current scope.
3. MiniMax LLM integration is not part of v0.1 baseline.

## 3. Current Runtime Routing

- `/capabilities` is the first handshake endpoint for UI capability negotiation:
  - dynamic chat adapter options,
  - local fallback mapping exposure for compatibility adapters,
  - MiniMax TTS availability/configuration flags.
- `/chat` supports adapter field:
  - `codex`, `claude`, `mock` are concrete local adapters.
  - `openai-compatible`, `anthropic`, `gemini` are currently compatibility placeholders and map to configured local fallback adapter.
  - request context is normalized into a bounded internal task payload before local agent invocation.
- `/tts` uses MiniMax T2A config from bridge environment.

## 4. Out of Scope (v0.1)

- User login / cloud account system.
- Cloud-hosted conversation storage.
- MiniMax LLM as a first-class chat provider.

## 5. Next Planning Checkpoint

When adding provider-mode LLM support, update this file first with:

- provider matrix,
- credential strategy,
- fallback policy,
- security and data-boundary changes.

## 6. New Direction (2026-04-05)

For upcoming shared deployment mode (one backend + multiple extension clients), architecture direction is updated:

1. Backend will become the source of truth for sessions/messages.
2. Extension local storage/IndexedDB will act as cache/sync layer.
3. Agent continuity will rely on explicit provider session IDs:
   - Codex via `codex exec resume <session_id>`
   - Claude Code via `--resume` or `--session-id`
4. `--last` strategy is not used for server-side resume logic.
5. User auth and per-user data isolation become mandatory in this mode.

Confirmed execution choices:

- Storage starts with SQLite.
- Auth starts with multi-user account isolation.
- Handoff is adaptive (summary + dynamic recent window), not fixed-length raw history.
- Old-message retrieval is session-scoped and on-demand.
- Summary generation uses one-shot calls to available local Agent.

Implementation steps are tracked in:

- `docs/BACKEND_SESSION_MODE.md`
