# gstack on Codex (Repo-local)

This project uses **repo-local gstack** for Codex.

## Why repo-local

- Scopes skills to this repository only.
- Avoids polluting `~/.codex/skills`.
- Keeps team workflow reproducible from project root.

## Installed layout

- Source checkout: `.agents/skills/gstack`
- Generated Codex skills: `.agents/skills/gstack-*`
- Browser binary: `.agents/skills/gstack/browse/dist/browse`

Important:

- Top-level `.agents/skills/gstack-*` are machine-local symlink entrypoints.
- They are intentionally ignored in git because setup may write absolute targets.
- Each machine must run `pnpm gstack:setup` once after clone to generate local links.

## Current install command

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git .agents/skills/gstack
cd .agents/skills/gstack && ./setup --host codex
```

## Operational commands

From project root:

```bash
pnpm gstack:check
pnpm gstack:setup
```

- `gstack:check`: verifies browse binary + linked skill count.
- `gstack:setup`: rebuilds binary, regenerates skills, relinks Codex entries.

## Upgrade workflow (best practice)

```bash
cd .agents/skills/gstack
git pull --ff-only
./setup --host codex
```

Then verify:

```bash
cd /path/to/project
pnpm gstack:check
```

## Best practices for Codex host

1. Keep install path as `.agents/skills/gstack` for repo-local mode.
2. Always run `./setup --host codex` after pulling gstack updates.
3. Do not manually symlink source skill folders; rely on generated `gstack-*` entries.
4. If skills stop resolving, rerun setup from `.agents/skills/gstack`.
5. Keep API/browser credentials out of gstack files; use environment variables.

## Notes

- Repo-local setup does not require `~/.codex/skills/gstack`.
- Playwright browser assets are installed under user cache (`~/.cache/ms-playwright`).
