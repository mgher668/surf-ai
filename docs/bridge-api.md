# Bridge API (v0.1)

Base URL example: `http://127.0.0.1:43127`

Auth header (optional but recommended):

- `x-surf-token: <token>`
- `x-surf-user-id: <user-id>` (required when multi-user mode is enabled)

Security defaults:

- CORS allowlist patterns from `SURF_AI_CORS_ALLOW_ORIGINS` (wildcards allowed, default includes extension/localhost).
- Fixed-window rate limit for write-heavy routes:
  - `POST /chat`
  - `POST /sessions/:id/messages`
  - `POST /tts`
- Optional HTTPS enforcement via `SURF_AI_REQUIRE_HTTPS=1` (typically with reverse proxy + `SURF_AI_TRUST_PROXY=1`).
- Security events are persisted into `audit_events` and queryable via `GET /audit/events`.
- Retention maintenance is available via `POST /admin/maintenance/purge` (dry-run default).

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

### GET /audit/events?limit=100&eventType=rate_limited

Security/audit timeline query (user-scoped).

Response:

```json
{
  "events": [
    {
      "id": "uuid",
      "userId": "local",
      "eventType": "rate_limited",
      "level": "WARN",
      "route": "/chat",
      "method": "POST",
      "statusCode": 429,
      "ip": "127.0.0.1",
      "details": {
        "bucket": "chat",
        "retryAfterMs": 59984
      },
      "createdAt": 1775369895657
    }
  ]
}
```

### POST /admin/maintenance/purge

Manual retention cleanup endpoint (user-scoped).  
Defaults to dry-run.

Request:

```json
{
  "dryRun": true,
  "includeSessions": true,
  "includeAudit": true,
  "sessionDays": 90,
  "auditDays": 30
}
```

Response:

```json
{
  "retention": {
    "enabled": true,
    "sessionDays": 90,
    "auditDays": 30
  },
  "result": {
    "dryRun": true,
    "includeSessions": true,
    "includeAudit": true,
    "sessionCutoffMs": 1770000000000,
    "auditCutoffMs": 1775000000000,
    "counts": {
      "sessions": 2,
      "messages": 34,
      "agentSessionLinks": 2,
      "sessionMemories": 6,
      "auditEvents": 20
    },
    "executedAt": 1777000000000
  },
  "cutoffs": {
    "sessionBefore": "2026-01-01T00:00:00.000Z",
    "auditBefore": "2026-03-01T00:00:00.000Z"
  }
}
```

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
    {
      "id": "m1",
      "sessionId": "uuid",
      "seq": 1,
      "role": "user",
      "content": "hello",
      "parts": [
        { "type": "text", "text": "hello" },
        {
          "type": "image",
          "attachment": {
            "id": "att_1",
            "mimeType": "image/png",
            "sizeBytes": 125667,
            "fileName": "screenshot.png",
            "url": "/uploads/att_1",
            "createdAt": 1777000000000
          }
        }
      ],
      "createdAt": 1
    },
    { "id": "m2", "sessionId": "uuid", "seq": 2, "role": "assistant", "content": "world", "createdAt": 2 }
  ]
}
```

### POST /uploads?sessionId=:sessionId[&fileName=...]

Upload one image attachment.

Request:

- Method: `POST`
- Body: raw binary
- `Content-Type`: `image/png` / `image/jpeg` / `image/webp` / `image/gif`
- Optional header: `x-surf-file-name: <url-encoded-name>`

Limits:

- max file size: `10MB`

Response:

```json
{
  "attachment": {
    "id": "att_1",
    "mimeType": "image/png",
    "sizeBytes": 125667,
    "fileName": "screenshot.png",
    "url": "/uploads/att_1",
    "createdAt": 1777000000000
  }
}
```

### GET /uploads/:id

Returns uploaded image bytes for the authenticated owner.

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

Possible error (`429`):

```json
{
  "error": "rate_limited",
  "bucket": "session-message",
  "retryAfterMs": 2100
}
```

### POST /sessions/:id/star

Request:

```json
{ "starred": true }
```

### DELETE /sessions/:id

No request body required.

Response:

```json
{
  "ok": true,
  "deletedSessionId": "uuid"
}
```

### GET /sessions/:id/context?query=...

Debug endpoint for retrieval preview (phase 5).

Response shape:

```json
{
  "session": {
    "id": "uuid",
    "title": "Manual QA",
    "starred": false
  },
  "context": {
    "query": "上次提到的结论是什么？",
    "triggered": true,
    "queryTokens": ["上", "次提", "..."],
    "topScore": 5.82,
    "lowConfidence": false,
    "expanded": false,
    "items": [
      {
        "seq": 1,
        "role": "user",
        "source": "direct",
        "score": 5.8264,
        "snippet": "结论：蓝色方案优先，预算10万。"
      }
    ]
  }
}
```

Note:

- `openai-compatible` / `anthropic` / `gemini` adapter values are compatibility placeholders in current version and route to configured local fallback adapter.
- For codex/claude in backend session mode, bridge keeps `agent_session_links` (`provider_session_id`, `synced_seq`).
- Bridge also keeps `session_memories` (`summary` / `facts` / `todos`) for adaptive handoff packaging.
- When codex link is healthy, bridge uses `codex exec resume <provider_session_id>` with delta handoff payload.
- When claude link is healthy, bridge uses `claude -p --output-format json --resume <provider_session_id>` with delta handoff payload.
- If resume fails, link is marked `BROKEN`, and bridge auto-falls back to a fresh provider session for that request.
- Handoff payload now includes: `latest_user_request`, optional `delta_summary`, `recent_verbatim`, optional `pinned_facts/open_todos`, and `evidence_refs`.
- Phase 5 retrieval is session-scoped keyword/BM25 based, with low-confidence neighbor expansion and `evidence_refs` binding.

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

Possible error (`429`):

```json
{
  "error": "rate_limited",
  "bucket": "chat",
  "retryAfterMs": 3210
}
```

Notes:

- Bridge will normalize incoming chat request into a unified internal `AgentTaskPayload` before calling local agents.
- Current normalization limits:
  - conversation history: latest 24 messages
  - per-message/user-request clip: 4,000 chars
  - selected text clip: 12,000 chars
  - full-page text clip: 24,000 chars
- Rate-limit metadata headers:
  - `x-ratelimit-limit`
  - `x-ratelimit-remaining`
  - `x-ratelimit-reset-ms`
  - `retry-after` (only when blocked)

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

```json
{
  "error": "rate_limited",
  "bucket": "tts",
  "retryAfterMs": 1500
}
```

MiniMax credentials must be configured in bridge env (`apps/bridge/.env.example`), not in extension UI.

## Run Streaming APIs (Codex App Server)

Codex run path is now app-server based for `/sessions/:id/runs`.

### POST /sessions/:id/runs

Creates a queued run and appends the user message.

Request:

```json
{
  "adapter": "codex",
  "model": "auto",
  "content": "请解释这张图",
  "attachmentIds": ["att_1", "att_2"],
  "context": {
    "pageTitle": "Example",
    "pageUrl": "https://example.com"
  }
}
```

Rules:

- `content` can be empty only when `attachmentIds` is non-empty.
- per-message image max count: `10`.
- `attachmentIds` must belong to current user + session.

Behavior:

- per-user concurrent active run cap is `10`.
- over cap returns `429` with `error=too_many_concurrent_turns`.
- non-codex adapters ignore image attachments and use text-only path.
- codex app-server model without `image` modality will auto-ignore image inputs.

### GET /sessions/:id/runs/:runId/stream

Server-Sent Events stream for one run.

Response header:

- `content-type: text/event-stream`

Data frame (`data: ...`):

```json
{
  "eventId": "evt_xxx",
  "sessionId": "session-id",
  "runId": "run-id",
  "type": "approval.requested",
  "ts": 1770000000000,
  "data": {}
}
```

Current event types:

- `run.started`
- `run.status`
- `assistant.delta`
- `assistant.completed`
- `reasoning.summary.delta`
- `reasoning.text.delta`
- `command.output.delta`
- `approval.requested`
- `approval.updated`
- `error`
- `heartbeat`

### GET /sessions/:id/runs/:runId/approvals?status=pending|all

List approval records for one run.

Response:

```json
{
  "approvals": [
    {
      "id": "uuid",
      "approvalRequestId": "req-1",
      "kind": "commandExecution",
      "status": "PENDING",
      "availableDecisions": ["accept", "acceptForSession", "decline", "cancel"],
      "payload": {}
    }
  ]
}
```

### POST /sessions/:id/runs/:runId/approvals/:approvalRequestId/decision

Submit one approval decision.

Request:

```json
{
  "decision": "accept",
  "reason": "optional"
}
```

Response:

```json
{
  "approval": {
    "id": "uuid",
    "status": "APPROVED",
    "decision": "accept"
  }
}
```

### Restart Recovery

On bridge startup:

- interrupted runs (`QUEUED/RUNNING/CANCELLING`) are marked `FAILED`;
- pending approvals are marked `FAILED`.
