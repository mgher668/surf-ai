# gstack Workflow Report (2026-04-04)

Task: 统一 Agent task payload（会话 + 选区 + 全文）并补 eval

## 1) plan-eng-review

Status: `DONE`

Scope reviewed:

- Bridge: 新增内部 payload 归一化层 `buildAgentTaskPayload`
- Prompt: 统一基于 payload JSON 构造
- Mock adapter: 统一基于 payload 回应，暴露 `ctx/history` 信号便于回归
- Evals: 支持 case 传 `context`，新增上下文覆盖用例

Key decisions:

- 保持对外 API 不变（`POST /chat` 协议不改），只强化 bridge 内部输入边界。
- 采用有界截断策略，避免长会话/长全文导致 prompt 失控。
- 截断上限：24 条会话、4k 单条消息、12k 选区、24k 全文。

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

- `pnpm evals`（新增 `ctx-1` 用例）
- 为避免命中已有本机 bridge，使用临时端口 `43131` 运行本次代码：
  - `SURF_AI_PORT=43131 ... bridge`
  - `SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43131 pnpm evals`

Result:

- `PASS sum-1`
- `PASS trans-1`
- `PASS qa-1`
- `PASS ctx-1`
- `Summary: 4/4 passed`

## 4) review

Status: `DONE`

Review checklist:

- 兼容性：`/chat` 请求结构无 breaking change。
- 安全边界：page/selection 文本仍作为不可信数据，且统一经过 clip。
- 稳定性：长上下文场景可控，防止 prompt 体积无限增长。
- 回归：新增上下文用例覆盖 `context -> mock output` 路径。

## 5) report

Status: `DONE`

Artifacts:

- 本报告：`docs/reports/gstack-2026-04-04-agent-task-payload.md`
- 新增：`apps/bridge/src/agents/task-payload.ts`
- 文档更新：`docs/bridge-api.md`, `docs/PLAN.md`, `README.md`
