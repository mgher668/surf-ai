# surf-ai

Chrome AI Web Assistant powered by a local bridge service.

## Stack

- Monorepo: `pnpm workspace`
- Extension: `TypeScript + React + Vite + CRXJS (Manifest V3)`
- Bridge: `Node.js + Fastify`
- Shared contracts: `packages/shared`
- Persistence: `chrome.storage.local` + `IndexedDB`

## Project Structure

```text
apps/
  extension/     # Chrome extension (MV3)
  bridge/        # Local backend service
packages/
  shared/        # Shared types and API contracts
docs/
  bridge-api.md
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

## Current MVP Skeleton

- Selection handle in any webpage (`Summarize / Translate / Read`)
- Context menu and keyboard command entrypoints
- Side panel as main chat UI
- Local bridge connection management (`baseURL`, optional token)
- Session list + starred sessions + message persistence
- Adapter routing skeleton (`mock`, `codex`, `claude`)
- `MiniMax TTS` integration via bridge `/tts` (API key only in bridge env)

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
- MiniMax endpoint: `https://api.minimax.io/v1/t2a_v2`

## Notes

- This repository is optimized for local self-hosted usage.
- For production-grade security, enable token auth and keep bridge bound to localhost.
- gstack (Codex) repo-local install guide: `docs/gstack-codex.md`.
- `.agents/skills/gstack-*` entry symlinks are machine-local and ignored by git; run `pnpm gstack:setup` after clone.
