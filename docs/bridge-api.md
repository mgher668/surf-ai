# Bridge API (v0.1)

Base URL example: `http://127.0.0.1:43127`

Auth header (optional but recommended):

- `x-surf-token: <token>`
- `x-surf-user-id: <user-id>` (required when multi-user mode is enabled)

Current positioning:

- Chat path is local-Agent-first (`codex` / `claude` / `mock`).
- MiniMax is currently integrated for TTS (`/tts`) only.

## GET /health

Response:

```json
{
  "ok": true,
  "version": "0.1.0",
  "adapters": ["mock", "codex", "claude"],
  "now": "2026-04-03T00:00:00.000Z"
}
```

## GET /models

Response:

```json
{
  "models": [
    { "id": "mock/default", "label": "Mock (local)", "adapter": "mock" },
    { "id": "codex/default", "label": "Codex CLI", "adapter": "codex" },
    { "id": "claude/default", "label": "Claude Code CLI", "adapter": "claude" }
  ]
}
```

## GET /capabilities

Response:

```json
{
  "version": "0.1.0",
  "now": "2026-04-04T00:00:00.000Z",
  "chat": {
    "defaultAdapter": "mock",
    "supportsModelOverride": false,
    "adapters": [
      { "adapter": "mock", "label": "Mock (local)", "kind": "native", "enabled": true },
      { "adapter": "codex", "label": "Codex CLI", "kind": "native", "enabled": true },
      { "adapter": "claude", "label": "Claude Code CLI", "kind": "native", "enabled": true },
      {
        "adapter": "openai-compatible",
        "label": "OpenAI Compatible (fallback)",
        "kind": "compatibility",
        "enabled": true,
        "routedTo": "mock"
      }
    ]
  },
  "tts": {
    "minimax": {
      "enabled": true,
      "configured": false
    }
  }
}
```

Notes:

- Sidepanel should fetch this endpoint first and render adapter options dynamically.
- `configured=false` for `tts.minimax` means MiniMax key is missing in bridge env and `/tts` will fail with `tts_not_configured`.

## Session APIs (Phase 1)

Session APIs are the new source-of-truth path for session/message storage in backend mode.

Headers:

- `x-surf-user-id: <user-id>`
- `x-surf-token: <token>` (if user account has token configured)

### POST /sessions

Request:

```json
{ "title": "New chat" }
```

Response:

```json
{
  "session": {
    "id": "uuid",
    "title": "New chat",
    "starred": false,
    "status": "ACTIVE",
    "createdAt": 1775355511020,
    "updatedAt": 1775355511020,
    "lastActiveAt": 1775355511020
  }
}
```

### GET /sessions

Response:

```json
{
  "sessions": [
    {
      "id": "uuid",
      "title": "Manual QA",
      "starred": false,
      "status": "ACTIVE",
      "createdAt": 1775355511020,
      "updatedAt": 1775355511048,
      "lastActiveAt": 1775355511048
    }
  ]
}
```

### GET /sessions/:id/messages?afterSeq=0&limit=200

Response:

```json
{
  "session": { "id": "uuid", "title": "Manual QA", "starred": false },
  "messages": [
    { "id": "m1", "sessionId": "uuid", "seq": 1, "role": "user", "content": "hello", "createdAt": 1 },
    { "id": "m2", "sessionId": "uuid", "seq": 2, "role": "assistant", "content": "world", "createdAt": 2 }
  ]
}
```

### POST /sessions/:id/messages

Request:

```json
{
  "adapter": "mock",
  "content": "hello from session api",
  "context": {
    "pageTitle": "Example",
    "pageUrl": "https://example.com"
  }
}
```

Response:

```json
{
  "session": { "id": "uuid", "title": "Manual QA", "starred": false, "status": "ACTIVE" },
  "userMessage": { "id": "u1", "sessionId": "uuid", "seq": 1, "role": "user", "content": "hello from session api" },
  "assistantMessage": { "id": "a1", "sessionId": "uuid", "seq": 2, "role": "assistant", "content": "..." }
}
```

### POST /sessions/:id/star

Request:

```json
{ "starred": true }
```

### POST /sessions/:id/close

No request body required.

Note:

- `openai-compatible` / `anthropic` / `gemini` adapter values are compatibility placeholders in current version and route to configured local fallback adapter.
- For codex/claude in backend session mode, bridge keeps `agent_session_links` (`provider_session_id`, `synced_seq`).
- Bridge also keeps `session_memories` (`summary` / `facts` / `todos`) for adaptive handoff packaging.
- When codex link is healthy, bridge uses `codex exec resume <provider_session_id>` with delta handoff payload.
- When claude link is healthy, bridge uses `claude -p --output-format json --resume <provider_session_id>` with delta handoff payload.
- If resume fails, link is marked `BROKEN`, and bridge auto-falls back to a fresh provider session for that request.
- Handoff payload now includes: `latest_user_request`, optional `delta_summary`, `recent_verbatim`, optional `pinned_facts/open_todos`, and `evidence_refs`.

## POST /chat

Request:

```json
{
  "adapter": "codex",
  "sessionId": "session-1",
  "messages": [
    { "role": "user", "content": "Summarize this" }
  ],
  "context": {
    "pageTitle": "Example",
    "pageUrl": "https://example.com",
    "selectedText": "some text",
    "pageText": "full page text (optional)",
    "pageTextSource": "readability"
  }
}
```

Response:

```json
{
  "output": "..."
}
```

Notes:

- Bridge will normalize incoming chat request into a unified internal `AgentTaskPayload` before calling local agents.
- Current normalization limits:
  - conversation history: latest 24 messages
  - per-message/user-request clip: 4,000 chars
  - selected text clip: 12,000 chars
  - full-page text clip: 24,000 chars

## POST /tts

Request:

```json
{
  "text": "你好，欢迎使用 Surf AI。",
  "voiceId": "male-qn-qingse"
}
```

Response (`output_format=hex`, default):

```json
{
  "provider": "minimax",
  "traceId": "xxx",
  "mimeType": "audio/mpeg",
  "base64Audio": "SUQzBAAAAA..."
}
```

Response (`output_format=url`):

```json
{
  "provider": "minimax",
  "traceId": "xxx",
  "mimeType": "audio/mpeg",
  "audioUrl": "https://..."
}
```

Error examples:

```json
{ "error": "tts_not_configured", "message": "MiniMax API key is not configured. Set SURF_AI_MINIMAX_API_KEY." }
```

```json
{ "error": "tts_timeout", "message": "MiniMax request timed out after 30000ms." }
```

MiniMax credentials must be configured in bridge env (`apps/bridge/.env.example`), not in extension UI.

## Planned API (Backend Session Mode)

For future shared backend deployment mode, session/message authority moves to bridge server.
See `docs/BACKEND_SESSION_MODE.md` for full flow.

Proposed endpoints:

- `POST /sessions`
- `GET /sessions`
- `POST /sessions/:id/star`
- `POST /sessions/:id/close`
- `GET /sessions/:id/messages?afterSeq=...`
- `POST /sessions/:id/messages`

Codex/Claude continuity rule in this mode:

- Always resume with explicit provider session id.
- Never rely on `--last` in backend automation.
- Maintain per-adapter sync cursor (`synced_seq`) for delta handoff.
- Handoff uses adaptive context packaging (summary + dynamic recent window + evidence refs).
