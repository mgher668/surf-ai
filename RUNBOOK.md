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
- Codex run stream disconnects: check App Server process, thread mapping, SSE connection, and `session_runs` / `run_events` status.
- Codex approval appears stuck: inspect pending approval events and confirm the client is connected to the run stream.
- Codex thread recovery: if a stored thread cannot be resumed, bridge should mark the link/run failed or create a new thread according to the runtime policy.
- `claude --resume` failures: bridge marks claude link as `BROKEN` and falls back to a new `--session-id` session.
- `session_memories` not generated on handoff: verify delta size crossed summary trigger threshold (message count / char count).
- Retrieval miss for old context: check `/sessions/:id/context?query=...` preview output (`topScore`, `items`, `expanded`) before tuning thresholds.
- `https_required`: disable `SURF_AI_REQUIRE_HTTPS` for local HTTP, or put bridge behind TLS reverse proxy and set `SURF_AI_TRUST_PROXY=1`.
- `rate_limited` (`429`): raise `SURF_AI_RATE_LIMIT_MAX_REQUESTS` or widen `SURF_AI_RATE_LIMIT_WINDOW_MS`.
- CORS blocked: verify `SURF_AI_CORS_ALLOW_ORIGINS` includes your exact origin pattern.
- Need security timeline: query `GET /audit/events?limit=100` with your user headers.
- Retention dry-run: `POST /admin/maintenance/purge` with `{ "dryRun": true }` before actual purge.
- Retention execute: `POST /admin/maintenance/purge` with `{ "dryRun": false }`.

## Extension Troubleshooting

- Content script not loaded: reload extension and target tab.
- Side panel not opening: check command conflicts and Side Panel permission.
- No messages persisted: inspect bridge SQLite first, then extension cache/settings.

## Recovery

- If extension cache is inconsistent, clear extension local storage/IndexedDB and reload; do not delete bridge SQLite unless you intentionally want to erase source-of-truth data.
- If bridge hangs, restart process and check last stderr output.
