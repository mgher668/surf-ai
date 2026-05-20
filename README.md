# surf-ai

Local-first AI Agent Runtime with a Chrome extension as the first client.

Surf AI is evolving from a browser-only assistant into a local-first runtime. Today, the Chrome extension is the shipped client and primary UX; the bridge is becoming the durable runtime core for sessions, runs, events, approvals, memory, and browser-aware workflows.

## Stack

- Monorepo: `pnpm workspace`
- Extension: `TypeScript + React + Vite + CRXJS (Manifest V3)`
- Bridge runtime: `Node.js + Fastify`
- Shared contracts: `packages/shared`
- Persistence: bridge `SQLite` source of truth + extension local cache/settings

## Project Structure

```text
apps/
  extension/     # Chrome extension (MV3)
  bridge/        # Local backend service
packages/
  shared/        # Shared types and API contracts
docs/
  PLAN.md
  bridge-api.md
  BACKEND_SESSION_MODE.md
  AGENT_RUNTIME_EVOLUTION_PLAN.md
  harness/
evals/
  cases/
scripts/
  run-evals.mjs
AGENT.md
TASK_TEMPLATE.md
RUNBOOK.md
SECURITY_CHECKLIST.md
```

## Quick Start

1. Install dependencies

```bash
pnpm install
```

2. Start local bridge

```bash
pnpm dev:bridge
```

3. Start extension build/dev

```bash
pnpm dev:extension
```

4. Load extension in Chrome

- Open `chrome://extensions`
- Enable Developer Mode
- Click `Load unpacked`
- Select `apps/extension/dist`

## Current Runtime Capabilities

- Browser extension first client:
  - Selection handle in any webpage (`Summarize / Translate / Read`)
  - Context menu and keyboard command entrypoints
  - Side panel as main chat UI
  - Standalone tab mode reusing the same chat UI as side panel
  - Settings page for connection management, default adapter, and locale
  - Local bridge connection management (`baseURL`, optional token)
- Runtime-owned data:
  - Backend session APIs (`/sessions/*`) with SQLite source-of-truth
  - Session list + starred sessions + message persistence
  - Audit event persistence (`audit_events`) + query endpoint (`GET /audit/events`)
  - Retention maintenance endpoint (`POST /admin/maintenance/purge`) with dry-run support
- Agent/runtime integration:
  - Adapter routing skeleton (`mock`, `codex`, `claude`)
  - Codex App Server run path with SSE stream and inline approval APIs
  - Codex/Claude continuity in backend session mode (`provider_session_id` + `synced_seq` + resume fallback)
  - Adaptive handoff memory layer (`session_memories`: summary/facts/todos) for cross-adapter continuity
  - On-demand history retrieval (keywords/BM25 + evidence refs) for old-context questions
- Safety and capability support:
  - Bridge capability negotiation (`/capabilities`) for dynamic adapter/TTS availability
  - Unified bounded task payload normalization before local agent invocation
  - Security baseline for production mode (CORS allowlist patterns + per-route rate limit + optional HTTPS-required gate)
  - `MiniMax TTS` integration via bridge `/tts` (API key only in bridge env)
- Current strategy:
  - Local-Agent-first backend strategy (`codex` / `claude`)
  - Provider-mode adapters are compatibility placeholders in current version

## Development Commands

```bash
pnpm dev
pnpm dev:extension
pnpm dev:bridge
pnpm build
pnpm typecheck
pnpm evals
pnpm gstack:setup
pnpm gstack:check
```

## Bridge Config

See `apps/bridge/.env.example`.

Defaults:

- Host: `127.0.0.1`
- Port: `43127`
- Adapter: `mock`
- CORS allowlist: `SURF_AI_CORS_ALLOW_ORIGINS` (wildcard patterns supported)
- Rate limit: `SURF_AI_RATE_LIMIT_WINDOW_MS=60000`, `SURF_AI_RATE_LIMIT_MAX_REQUESTS=120`
- Optional HTTPS gate: `SURF_AI_REQUIRE_HTTPS=1` (typically with reverse proxy + `SURF_AI_TRUST_PROXY=1`)
- Retention policy: `SURF_AI_RETENTION_SESSION_DAYS=90`, `SURF_AI_RETENTION_AUDIT_DAYS=30`
- MiniMax endpoint: `https://api.minimax.io/v1/t2a_v2`

## Notes

- This repository is optimized for local self-hosted usage.
- For production-grade security, enable token auth, configure strict CORS allowlist, and run HTTPS (reverse proxy recommended).
- Planning baseline: `docs/PLAN.md`.
- Agent Runtime evolution plan: `docs/AGENT_RUNTIME_EVOLUTION_PLAN.md`.
- Large runtime phases must create a harness record under `docs/harness/` before core implementation starts.
- Shared backend session roadmap (IDLE policy, handoff, retrieval): `docs/BACKEND_SESSION_MODE.md`.
- MiniMax is currently used for TTS only, not as chat LLM provider.
- gstack (Codex) repo-local install guide: `docs/gstack-codex.md`.
- `.agents/skills/gstack-*` entry symlinks are machine-local and ignored by git; run `pnpm gstack:setup` after clone.
