# Runbook

## Local Startup

1. Install deps: `pnpm install`
2. Start bridge: `pnpm dev:bridge`
3. Start extension build/dev: `pnpm dev:extension`
4. Load unpacked extension from `apps/extension/dist`

## Bridge Troubleshooting

- `401 unauthorized`: verify `SURF_AI_TOKEN` and `x-surf-token` header.
- `401 unauthorized_user` on session APIs: verify `x-surf-user-id` and per-user token configuration (`SURF_AI_USERS_JSON`).
- `adapter_failed`: check local CLI availability (`codex`, `claude`).
- `codex_session_id_not_found`: verify Codex session index file exists (`~/.codex/session_index.jsonl`) and bridge process has read permission.
- `codex resume` failures: bridge marks codex link as `BROKEN` and falls back to new codex session on next request.
- `claude --resume` failures: bridge marks claude link as `BROKEN` and falls back to a new `--session-id` session.
- CORS blocked: ensure request origin is `chrome-extension://...` and bridge is on localhost.

## Extension Troubleshooting

- Content script not loaded: reload extension and target tab.
- Side panel not opening: check command conflicts and Side Panel permission.
- No messages persisted: inspect IndexedDB `surf-ai` / `messages` store.

## Recovery

- If storage is inconsistent, clear extension local storage and restart.
- If bridge hangs, restart process and check last stderr output.
