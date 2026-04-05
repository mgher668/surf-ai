# gstack Workflow Report (2026-04-05)

Task: Phase 1 落地后端会话真相源（SQLite + `/sessions/*`）并让 sidepanel 优先走后端

## 1) plan-eng-review

Status: `DONE`

Scope reviewed:

- Shared contracts: 会话/消息后端 API 类型
- Bridge: SQLite 存储层、会话 API、多用户 header 认证
- Extension: sidepanel 会话/消息链路切换为后端优先，保留本地 fallback

Key decisions:

- 采用 Node 内建 `node:sqlite`，避免额外依赖。
- 后端会话模式认证头为 `x-surf-user-id` + `x-surf-token`。
- sidepanel 在 bridge 不支持会话 API 时回退本地存储逻辑。

## 2) build

Status: `DONE`

Executed:

- `pnpm typecheck`
- `pnpm build`

Result:

- All passed.

## 3) qa

Status: `DONE`

Executed:

- `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43999 pnpm evals`（临时 bridge）
- 手工 API smoke test：`POST /sessions` -> `POST /sessions/:id/messages` -> `GET /sessions/:id/messages`

Result:

- `evals`: `4/4 passed`
- 手工链路：会话创建、消息写入、assistant 回包、消息回读均通过。

## 4) review

Status: `DONE`

Review checklist:

- 数据边界：所有会话 API 按 `user_id` 作用域访问。
- 兼容性：保留 `/chat` 旧链路；sidepanel 有 fallback。
- 数据完整性：消息 `seq` 递增，session `updatedAt/lastActiveAt` 同步更新。
- 风险：当前 `SURF_AI_USERS_JSON` 未配置时使用默认 `local` 用户（开发便利，生产需显式配置）。

## 5) report

Status: `DONE`

Artifacts:

- Bridge store: `apps/bridge/src/core/store.ts`
- Bridge API updates: `apps/bridge/src/index.ts`
- Extension backend session mode: `apps/extension/src/ui/sidepanel/App.tsx`
- Shared contracts: `packages/shared/src/index.ts`
- Docs sync: `docs/bridge-api.md`, `README.md`, `RUNBOOK.md`
