# Bridge API (v0.1)

Base URL example: `http://127.0.0.1:43127`

Auth header (optional but recommended):

- `x-surf-token: <token>`

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

Note:

- `openai-compatible` / `anthropic` / `gemini` adapter values are compatibility placeholders in current version and route to configured local fallback adapter.

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
