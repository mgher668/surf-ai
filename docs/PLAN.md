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
