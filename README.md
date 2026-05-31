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
  surf-cli.mjs
  surf-cli-smoke.mjs
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
- CLI proof client:
  - `scripts/surf-cli.mjs` can list sessions, create/send a run, stream SSE events, and submit approvals.
  - This proves the bridge is a reusable Agent Runtime, not only an extension backend.
- Runtime-owned data:
  - Backend session APIs (`/sessions/*`) with SQLite source-of-truth
  - Session list + starred sessions + message persistence
  - Audit event persistence (`audit_events`) + query endpoint (`GET /audit/events`)
  - Retention maintenance endpoint (`POST /admin/maintenance/purge`) with dry-run support
- Agent/runtime integration:
  - Adapter routing skeleton (`mock`, `codex`, `claude`)
  - Codex App Server run path with SSE stream and inline approval APIs
  - OpenAI-compatible API run path with SSE assistant streaming
  - Codex/Claude continuity in backend session mode (`provider_session_id` + `synced_seq` + resume fallback)
  - Adaptive handoff memory layer (`session_memories`: summary/facts/todos) for cross-adapter continuity
  - Durable memory V2 (`durable_memories`) with candidate/confirmed/rejected lifecycle and user-confirmed recall
  - On-demand history retrieval (keywords/BM25 + evidence refs) for old-context questions
- Safety and capability support:
  - Bridge capability negotiation (`/capabilities`) for dynamic adapter/TTS availability
  - Unified bounded task payload normalization before local agent invocation
  - Security baseline for production mode (CORS allowlist patterns + per-route rate limit + optional HTTPS-required gate)
  - `MiniMax TTS` integration via bridge `/tts` (API key only in bridge env)
- Current strategy:
  - Local-Agent-first backend strategy (`codex` / `claude`)
  - `openai-compatible` is a real API runtime
  - `anthropic` / `gemini` are compatibility placeholders in current version

## Development Commands

```bash
pnpm dev
pnpm dev:extension
pnpm dev:bridge
pnpm build
pnpm typecheck
pnpm test:bridge
pnpm evals
pnpm cli:smoke
pnpm gstack:setup
pnpm gstack:check
```

## Extension E2E

```bash
pnpm build
pnpm e2e:extension
```

Visual debug mode:

```bash
SURF_AI_E2E_HEADLESS=0 SURF_AI_E2E_STEP_DELAY_MS=1000 pnpm e2e:extension
```

Useful options:

- `SURF_AI_E2E_CHROME=/path/to/chrome`
- `SURF_AI_E2E_HEADLESS=0`
- `SURF_AI_E2E_STEP_DELAY_MS=1000`
- `SURF_AI_E2E_ARTIFACT_DIR=/tmp/surf-ai-extension-e2e-artifacts`

On failure, the E2E script captures a PNG screenshot to `SURF_AI_E2E_ARTIFACT_DIR`.

## CLI Client

```bash
node scripts/surf-cli.mjs sessions --base-url http://127.0.0.1:43127 --user local
node scripts/surf-cli.mjs send --message "hello" --adapter mock
node scripts/surf-cli.mjs send --message "do it" --adapter codex --auto-approve accept
```

Environment variables:

- `SURF_AI_BASE_URL`
- `SURF_AI_USER_ID`
- `SURF_AI_TOKEN`
- `SURF_AI_ADAPTER`

## Bridge Config

See `apps/bridge/.env.example`.

OpenAI-compatible API runtime:

- `SURF_AI_OPENAI_API_KEY` or `OPENAI_API_KEY`
- `SURF_AI_OPENAI_BASE_URL`, defaults to `https://api.openai.com/v1`
- `SURF_AI_OPENAI_MODEL`, defaults to `gpt-4.1-mini`
- `SURF_AI_OPENAI_TIMEOUT_MS`, defaults to `600000`

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
