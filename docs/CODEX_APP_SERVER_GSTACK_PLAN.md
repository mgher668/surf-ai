# Codex App Server 改造实施规划（gstack + subagent 协作版）

日期：2026-04-09
状态：Ready for Implementation

## 1. Goal / Scope / Acceptance / Out of Scope

### Goal
- 将 Surf 的 `codex` 适配路径从 `codex exec` 迁移到 **Codex App Server**。
- 将运行态与审批态从轮询改为 **SSE 实时推送**。
- 审批在 sidepanel 消息流内联展示，由用户前端决策。
- 代码分层保持 provider-neutral，后续接 OpenAI API 等非本地 runtime 不冲突。

### Scope
- 仅改 `codex` runtime 路径。
- `claude/mock` 保持现状。
- Bridge 增加运行时抽象、SSE、审批生命周期与审计。
- Extension sidepanel 改造成 SSE 流式消费与审批内联卡片。

### Acceptance
- 同一用户可并发最多 10 个 active run，超过直接拒绝。
- 审批默认 `ask`，超时 600s 自动 `deny`。
- 审批按钮按服务端 `availableDecisions` 动态渲染。
- Bridge 重启后，运行中/待审批任务统一标记失败并写审计。
- `1 surf session = 1 codex threadId`。
- `codex` 不再回退到 `exec`。

### Out of Scope
- Claude App Server 化。
- 云端账号体系与跨设备同步。
- 非 codex runtime 的实现（仅保留接口与扩展位）。

---

## 2. 锁定决策（已确认）

- 默认审批模式：`ask`。
- 审批超时：`600s`，超时行为：`deny`。
- 审批 UI 位置：消息流内联卡片。
- 决策按钮：按 `availableDecisions` 动态渲染，不做 Surf 二次限制。
- 运行策略：每用户 1 个 App Server runtime。
- 启动策略：首次请求懒启动，断线自动重连（2s 间隔，最多 5 次）。
- 并发上限：每用户 10，超限直接报错。
- 重启策略：pending/running 统一置失败并审计。
- 映射策略：1 surf session = 1 codex threadId。
- 降级策略：不降级到 `codex exec`。
- 错误展示：前端普通错误文本。
- 审计：新增独立表 `approval_events`，记录全量字段。

---

## 3. 目标架构（模块化、可抽离）

## 3.1 Runtime 抽象层

新增 provider-neutral 接口：
- `AgentRuntime`：`startRun`, `steerRun`, `cancelRun`, `submitApprovalDecision`, `subscribe`。
- `RuntimeEvent`：统一事件 envelope（assistant delta、reasoning delta、command output、approval、status、error）。

本期实现：
- `CodexAppServerRuntime`。

后续扩展：
- `OpenAIRuntime` / `AnthropicRuntime` 复用同一接口与事件模型。

## 3.2 运行管理层

新增 `RuntimeManager`（user-scoped）：
- 按 `userId` 维护 runtime 实例（每用户一个）。
- 懒启动/健康检查/重连控制。
- 并发计数（active turns）与上限拒绝。

## 3.3 审批管理层

新增 `ApprovalService`：
- 接收 runtime 抛出的审批请求并入库。
- 管理超时任务（600s -> timeout_deny）。
- 校验并提交用户决策。
- 产出审批更新事件并记录审计。

## 3.4 事件通道

- 写操作：HTTP（创建 run、提交审批决策、取消 run）。
- 读操作：SSE（run 流、审批流、状态流）。
- 前端不再依赖轮询读取 run 过程。

---

## 4. 数据模型与迁移

## 4.1 新表 `approval_events`

建议字段：
- `id` TEXT PK
- `user_id` TEXT NOT NULL
- `session_id` TEXT NOT NULL
- `run_id` TEXT NOT NULL
- `adapter` TEXT NOT NULL
- `thread_id` TEXT
- `turn_id` TEXT
- `approval_request_id` TEXT NOT NULL
- `kind` TEXT NOT NULL
- `title` TEXT
- `payload_json` TEXT NOT NULL
- `available_decisions_json` TEXT NOT NULL
- `status` TEXT NOT NULL (`PENDING|APPROVED|DENIED|CANCELLED|TIMEOUT|FAILED`)
- `decision` TEXT
- `decided_by` TEXT
- `decision_reason` TEXT
- `requested_at` INTEGER NOT NULL
- `decided_at` INTEGER
- `expires_at` INTEGER NOT NULL
- `created_at` INTEGER NOT NULL
- `updated_at` INTEGER NOT NULL

建议索引：
- `(user_id, session_id, requested_at DESC)`
- `(run_id, requested_at ASC)`
- `(user_id, status, expires_at ASC)`

## 4.2 现有表关系

- `agent_session_links`：`provider='codex'` 的 `provider_session_id` 存 `threadId`。
- `session_runs`：继续作为 run 主状态，必要时补 `provider_turn_id` 元数据字段。
- `audit_events`：保留高层事件；审批细节落 `approval_events`。

## 4.3 重启恢复语义

- 服务启动时扫描：`PENDING` 审批 + `QUEUED/RUNNING` run。
- 统一标记终态失败，并写审计事件：`bridge_restarted_abort_run` / `bridge_restarted_abort_approval`。

---

## 5. Bridge API / SSE 协议草案

## 5.1 新增 API

- `GET /sessions/:sessionId/runs/:runId/stream`
  - `text/event-stream`
  - 返回 run 生命周期与审批事件。

- `POST /sessions/:sessionId/runs/:runId/approvals/:approvalRequestId/decision`
  - body: `{ decision: string, reason?: string }`
  - 决策值必须在 `availableDecisions` 中。

- `GET /sessions/:sessionId/runs/:runId/approvals?status=pending|all`
  - reconnect 后补齐审批卡片状态。

## 5.2 现有 API 行为变更

- `POST /sessions/:id/runs`
  - codex 路径改走 App Server。
  - 并发超限返回结构化错误：`too_many_concurrent_turns`。

- `POST /sessions/:id/runs/:runId/cancel`
  - 同时取消 pending approval wait 与 active turn。

## 5.3 SSE 事件（统一 envelope）

```json
{
  "eventId": "evt_xxx",
  "sessionId": "...",
  "runId": "...",
  "type": "run.status",
  "ts": 1770000000000,
  "data": {}
}
```

事件类型：
- `run.started`
- `run.status`
- `assistant.delta`
- `assistant.completed`
- `reasoning.summary.delta`
- `reasoning.text.delta`（模型支持时）
- `command.output.delta`
- `file.change`
- `approval.requested`
- `approval.updated`
- `error`
- `heartbeat`

---

## 6. 前端交互与展示规范（sidepanel）

## 6.1 消息流内联块

- Assistant 文本：增量拼接。
- Reasoning 摘要：可折叠。
- Reasoning 明文：可折叠，默认折叠。
- Command/Tool 输出：可折叠日志块。
- Approval 卡片：动态按钮（`availableDecisions`）。

## 6.2 审批状态图标

- `accept`：绿色单勾。
- `acceptForSession`：绿色双勾。
- `decline/cancel/timeout_deny`：红色错误图标。

## 6.3 连接与恢复

- SSE 断线自动重连。
- 重连后先拉 `approvals` 补状态，再续流。
- run 终态后自动停止订阅。

---

## 7. subagent 分工（gstack 无冲突 ownership）

> 规则：同一时刻只有一个 owner 写同一文件；跨 track 通过接口/类型对齐。

## Track A - Runtime Core（Owner: Subagent-A）

写入边界：
- `apps/bridge/src/runtimes/types.ts`（new）
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts`（new）
- `apps/bridge/src/core/runtime-manager.ts`（new）
- `apps/bridge/src/core/codex-app-server-client.ts`（new）

交付：
- App Server 进程管理、懒启动、2s*5 重连、并发控制钩子。

## Track B - Approval + Store（Owner: Subagent-B）

写入边界：
- `apps/bridge/src/core/approval-service.ts`（new）
- `apps/bridge/src/core/store.ts`（仅 approval migration/CRUD 段）
- `apps/bridge/src/core/approval-types.ts`（new）

交付：
- `approval_events` 迁移、超时 deny、决策校验、审计写入。

## Track C - Bridge API + SSE（Owner: Subagent-C）

写入边界：
- `apps/bridge/src/index.ts`
- `apps/bridge/src/core/session-manager.ts`
- `packages/shared/src/index.ts`（API DTO）

交付：
- `/stream`、`/approvals/*`、run/cancel 与 runtime 对接。

## Track D - Extension UI（Owner: Subagent-D）

写入边界：
- `apps/extension/src/ui/sidepanel/App.tsx`
- `apps/extension/src/ui/sidepanel/components/*`（new）
- `apps/extension/src/lib/bridge-sse.ts`（new）
- `apps/extension/src/ui/common/i18n.ts`

交付：
- SSE 客户端、内联审批卡片、可折叠输出块、状态图标。

## Track E - QA + Docs（Owner: Subagent-E）

写入边界：
- `docs/bridge-api.md`
- `docs/PLAN.md`
- `README.md`
- `evals/**`

交付：
- 文档更新、测试矩阵落地、eval 回归用例。

---

## 8. gstack Gate 计划（Phase + Gate + Evidence + Risks + Next）

## Phase 0 - Contract Freeze

Gate
- 本文档冻结并获确认。
- API 事件字典冻结。

Evidence
- 文档 commit + 评审结论。

Risks
- 中途变更导致返工。

Next
- 进入数据层与 runtime skeleton。

## Phase 1 - Schema + Store + ApprovalService

Gate
- `approval_events` 迁移可执行。
- CRUD 与超时调度可用。

Evidence
- migration 测试通过。
- sqlite 查询样例通过。

Risks
- 老库兼容问题。

Next
- 接 RuntimeManager 与 Codex runtime。

## Phase 2 - Codex App Server Runtime 接通

Gate
- codex run 可启动与结束。
- `threadId` 正确映射到 session。

Evidence
- run smoke 日志。
- typecheck 通过。

Risks
- app-server 断连与重连竞态。

Next
- 接 SSE 事件扇出。

## Phase 3 - SSE Run Stream

Gate
- 前端可实时收到 assistant delta / status。
- 轮询路径不再承担主流程。

Evidence
- SSE 集成测试。
- 手工录屏验证。

Risks
- 事件顺序与断线重放一致性。

Next
- 接审批请求与决策闭环。

## Phase 4 - Approval End-to-End

Gate
- `approval.requested -> decision -> approval.updated` 闭环。
- 600s timeout 自动 deny 生效。

Evidence
- accept/acceptForSession/decline/timeout 四类用例通过。
- `approval_events` 全量落库验证。

Risks
- 重复决策竞争条件。

Next
- 可靠性与重启恢复。

## Phase 5 - Reliability Hardening

Gate
- 并发上限 10 生效（超限直接拒绝）。
- Bridge 重启时 pending/running 正确失败并审计。
- 自动重连 2s*5 生效。

Evidence
- 并发压测（>=12 请求）报告。
- 重启故障注入报告。

Risks
- 计数泄漏导致“假满载”。

Next
- 文档、eval、发布门禁。

## Phase 6 - QA / Review / Report（gstack 收敛）

Gate
- `qa`（至少 Standard）通过。
- `review` 通过，无阻断项。
- 文档与 API 同步完成。

Evidence
- typecheck 三包通过。
- evals 通过。
- QA 报告与审计样例。

Risks
- 文档与实现不一致。

Next
- 合并主线并启动下一阶段（OpenAI runtime 接口实现）。

---

## 9. QA 矩阵（最小必测）

单元测试：
- runtime 懒启动幂等。
- 自动重连策略（2s*5）。
- 审批超时 deny。
- 决策合法性校验。
- 并发上限计数 acquire/release。

集成测试（bridge）：
- run start -> stream -> complete。
- approval request -> accept/decline/timeout。
- cancel run 与 approval 同步终止。
- restart 后 pending/running 失败标记与审计。
- 12 并发请求时 10 通过、2 拒绝。

端到端（extension + bridge）：
- SSE 增量渲染。
- 内联审批卡片动态按钮。
- 图标状态规则正确。
- 断线重连后状态补齐。

---

## 10. 唯一待确认项

- “全局允许所有权限”开关的归属层级：
  - 方案 A：仅用户级（简单，先落地）。
  - 方案 B：用户级默认 + 会话级覆盖（更灵活，推荐）。

> 建议：先做 A（用户级），预留会话覆盖字段；后续无缝升到 B。

