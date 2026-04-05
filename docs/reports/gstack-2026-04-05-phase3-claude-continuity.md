# gstack Workflow Report (2026-04-05, Phase 3 Claude Continuity)

Task: 落地 Phase 3（Claude Code 连续会话接入）并完成可用性实验

## 1) plan-eng-review

Status: `DONE`

Decisions:

- Claude 连续会话采用官方参数：`--session-id`（创建） + `--resume`（续聊）。
- `SessionManager` 统一管理 codex/claude 的 link 状态机：`READY` / `BROKEN`。
- resume 失败时可用性优先：标记 `BROKEN` 并回退到新会话。

## 2) build

Status: `DONE`

Executed:

- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`

Result:

- All passed.

## 3) qa

Status: `DONE`

Executed:

- `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43999 pnpm evals`
- Claude CLI direct experiments:
  1. `claude -p --output-format json --session-id <sid> ...`
  2. `claude -p --output-format json --resume <sid> ...`
- Bridge e2e experiment via `/sessions/:id/messages` with `adapter=claude` (two rounds)

Result:

- `evals`: `4/4 passed`
- Direct CLI continuity: second round correctly recalled previous token (`BRAVO-42`).
- Bridge e2e continuity: second assistant response returned `DELTA-77`.
- DB link verification: `agent_session_links` persisted `provider=claude`, `synced_seq=4`, `state=READY`.

## 4) review

Status: `DONE`

Review checklist:

- Claude adapter新增 JSON result 解析，显式读取 `result` 与 `session_id`。
- `SessionManager` 支持 claude 分支（resume -> broken -> recreate）。
- `/sessions/:id/messages` 在 assistant 落库后统一更新 link 的 `synced_seq`。
- 非 codex/claude 适配器保持原行为，不引入回归。

## 5) report

Status: `DONE`

Artifacts:

- `apps/bridge/src/agents/claude-adapter.ts`
- `apps/bridge/src/core/session-manager.ts`
- `apps/bridge/src/index.ts`
- `docs/BACKEND_SESSION_MODE.md`
- `docs/PLAN.md`
