# Session 分支 + 重试/重新生成实施规划（gstack）

日期：2026-04-13  
状态：Ready for Implementation

## 1. 目标 / 范围 / 验收 / 非目标

### 1.1 目标
- 支持失败消息 `重试`（Retry）。
- 支持成功消息 `重新生成`（Regenerate）。
- 支持“历史消息重新生成 -> 新分支”能力。
- 保证 **记录不乱**（历史可追溯、不可被静默覆盖）和 **上下文不乱**（Surf 显示路径与真实 Agent 线程一致）。

### 1.2 范围
- Bridge：数据模型、API、run/attempt 生命周期、上下文组装规则。
- Extension（sidepanel + 独立页）：重试/重新生成交互、分支切换、时间线展示。
- Provider：先覆盖 codex app-server runtime；claude/runtime 复用同一抽象。

### 1.3 验收标准（硬性）
1. 点击失败消息 `重试` 后，UI 先隐藏旧错误并进入新 attempt 流；旧 attempt 可追溯。
2. 点击成功消息 `重新生成` 不会物理删除旧消息。
3. 对历史位置重新生成时，自动创建子分支，主线不被破坏。
4. `1 surf branch + 1 adapter = 1 provider session`（thread 一一对应）。
5. 刷新页面后，分支、attempt、审批/工具过程可完整回显。
6. 重放同一会话时，Surf 发送给 Agent 的上下文与当前活动分支严格一致。

### 1.4 非目标（本期不做）
- 跨会话合并分支。
- 多窗口实时协同冲突解决。
- 自动“最优分支”推荐。

---

## 2. 产品语义（先锁规则，避免后续歧义）

## 2.1 Retry（失败消息）
- 触发对象：失败的 assistant attempt。
- 行为：新建同 turn 的 `attempt+1`，不新增 user message。
- UI：当前卡片错误文案先清空，展示“重试中”；最终仅显示新 attempt 的结果。

## 2.2 Regenerate（成功消息）
- 最新 assistant：在当前分支同 turn 新建 `attempt+1`。
- 历史 assistant（后面已有后续对话）：
  - 不回写主线；
  - 创建子分支并切过去，在子分支生成新 attempt。

## 2.3 删除策略
- 默认不做物理删除（immutable history）。
- “隐藏旧版本”只影响展示层（active attempt pointer），不删审计数据。

---

## 3. 一致性原则（记录不乱 / 上下文不乱）

## 3.1 记录不乱（Data Integrity）
1. 消息、run、attempt、事件均不可变追加（append-only）。
2. 展示采用指针（active branch / active attempt），而非覆盖旧记录。
3. 任一 UI 展示都能追溯到 `run_id` + `attempt_id` + `provider_session_id`。

## 3.2 上下文不乱（Context Integrity）
1. 后端组装上下文只基于当前 `active_branch_id` 的可见路径。
2. Provider 会话链接必须带 `branch_id` 维度，禁止跨分支复用同一 provider session。
3. 分支切换后首次调用，必须先做该分支增量同步（handoff）再发用户请求。

## 3.3 可观测性
- 每次运行记录：
  - `context_message_ids`（本次送入上下文的消息 IDs）
  - `branch_id`
  - `provider_session_id`
  - `attempt_no`
- 用于排查“UI 显示路径和真实上下文不一致”问题。

---

## 4. 数据模型（建议迁移）

## 4.1 新增表

### `session_branches`
- `id` TEXT PK
- `session_id` TEXT NOT NULL
- `parent_branch_id` TEXT NULL
- `fork_from_turn_id` TEXT NULL
- `name` TEXT NOT NULL
- `created_by` TEXT NOT NULL
- `created_at` INTEGER NOT NULL
- `updated_at` INTEGER NOT NULL

索引：
- `(session_id, updated_at DESC)`
- `(session_id, parent_branch_id, created_at ASC)`

### `session_turns`
- `id` TEXT PK
- `session_id` TEXT NOT NULL
- `branch_id` TEXT NOT NULL
- `user_message_id` TEXT NOT NULL
- `turn_seq` INTEGER NOT NULL
- `active_attempt_id` TEXT NULL
- `created_at` INTEGER NOT NULL

索引：
- `(session_id, branch_id, turn_seq ASC)`

### `turn_attempts`
- `id` TEXT PK
- `turn_id` TEXT NOT NULL
- `run_id` TEXT NOT NULL
- `attempt_no` INTEGER NOT NULL
- `status` TEXT NOT NULL (`RUNNING|SUCCEEDED|FAILED|CANCELLED`)
- `adapter` TEXT NOT NULL
- `model` TEXT NULL
- `reasoning_effort` TEXT NULL
- `assistant_message_id` TEXT NULL
- `error_text` TEXT NULL
- `created_at` INTEGER NOT NULL
- `completed_at` INTEGER NULL

索引：
- `(turn_id, attempt_no DESC)`
- `(run_id)`

## 4.2 现有表调整

### `agent_session_links`
新增 `branch_id`（NOT NULL）并扩展唯一键：
- `UNIQUE(user_id, session_id, branch_id, provider)`

### `session_runs`
建议新增字段：
- `branch_id` TEXT NOT NULL
- `turn_id` TEXT NULL
- `attempt_id` TEXT NULL
- `run_kind` TEXT NOT NULL (`normal|retry|regenerate`)
- `source_attempt_id` TEXT NULL
- `context_message_ids_json` TEXT NULL

---

## 5. API 规划（Bridge）

## 5.1 分支接口
- `GET /sessions/:id/branches`
- `POST /sessions/:id/branches`（从 `forkFromTurnId` 创建）
- `POST /sessions/:id/branches/:branchId/activate`

## 5.2 attempt 操作
- `POST /sessions/:id/turns/:turnId/retry`
- `POST /sessions/:id/turns/:turnId/regenerate`
  - 支持参数：`mode=current_branch|new_branch`
  - 默认：若 turn 非分支尾部，则 `new_branch`

## 5.3 查询接口
- `GET /sessions/:id/timeline?branchId=...`
  - 返回单分支可见时间线（包含 active attempt）。
- `GET /sessions/:id/turns/:turnId/attempts`
  - 返回该 turn 历史 attempt 列表。

## 5.4 流式事件（SSE）
新增事件：
- `branch.created`
- `branch.activated`
- `attempt.started`
- `attempt.updated`
- `attempt.completed`

---

## 6. UI/UX 规划（sidepanel + 独立页）

## 6.1 必做（V1）
1. 消息卡片操作：`重试` / `重新生成`。
2. Turn 级“版本切换器”：查看历史 attempts。
3. 分支切换器：下拉 + 简单树列表（先不强制图谱）。
4. 时间线按单一时间轴渲染：审批、工具调用、思考、最终答案都按时间排序。

## 6.2 可选（V2）
- 独立页增加“分支图视图”（React Flow + Dagre 自动布局）。
- sidepanel 保持轻量树列表，不放复杂图。

---

## 7. Context 组装与 handoff 规则

## 7.1 当前分支上下文构建
1. 读取活动分支的可见 turns（含祖先分支共享前缀）。
2. 每个 turn 只取 `active_attempt_id` 对应 assistant 内容。
3. 若 adapter 切换或 provider thread 缺失：
  - 生成 handoff（summary + evidence refs + recent verbatim）；
  - 创建/恢复该 `branch_id + adapter` 的 provider session。

## 7.2 Retry / Regenerate 的上下文差异
- Retry：沿用同 turn 的上下文窗口，不加入失败 attempt 的 error 文案。
- Regenerate：沿用同 turn 之前上下文，替换该 turn 的 assistant 候选输出。
- 历史 regenerate（新分支）：以上下文“截断点”作为新分支起点，后续在新分支延展。

---

## 8. gstack 执行计划（Phase + Gate）

## Phase 0 - plan-eng-review（设计冻结）
交付：
- 本文档冻结为实施基线。
- 关键接口、表结构、状态机评审通过。

Gate：
- `run_kind / branch_id / turn_id / attempt_id` 全链路语义无冲突。

## Phase 1 - 数据层与迁移
交付：
- 新表 + 迁移脚本。
- 现有会话迁移为默认 `main` 分支。

Gate：
- 旧数据零丢失；迁移可回滚。

## Phase 2 - Bridge 读写链路
交付：
- 分支 API、retry/regenerate API、timeline API。
- run/attempt 生命周期打通。

Gate：
- 单元测试覆盖状态机：失败重试、成功重生、历史分叉。

## Phase 3 - Runtime 与 session link
交付：
- `agent_session_links` 支持 branch 维度。
- codex runtime 在 branch 级别正确 resume/create。

Gate：
- 任意分支切换后，provider thread 不串线。

## Phase 4 - 前端交互
交付：
- 卡片按钮、版本切换器、分支切换器、时间线统一排序。

Gate：
- 刷新页面后历史 process/attempt 不丢。

## Phase 5 - QA（gstack qa + review）
用例最小集：
1. 失败 attempt 连续重试 3 次，最终成功。
2. 最新消息重新生成 2 次，版本切换可回看。
3. 历史消息重新生成产生新分支，主线保持不变。
4. 分支切换 + adapter 切换后上下文正确。
5. Bridge 重启后状态恢复与可回显正确。

Gate：
- 全用例通过，且无“上下文串线”事件。

## Phase 6 - 文档与发布
交付：
- 更新 `docs/bridge-api.md`、`docs/PLAN.md`、`README.md`。
- 增加排障手册（如何检查 run/attempt/branch/provider session）。

---

## 9. 风险与对策

1. 风险：分支可见路径查询复杂，性能下降。  
对策：引入缓存字段（active path snapshot）+ 索引 + 分页。

2. 风险：Provider thread 与 branch 链接错配。  
对策：数据库唯一约束 + runtime 启动时一致性校验。

3. 风险：UI 时间线重复或乱序。  
对策：统一排序键 `event_ts + run_id + seq`，并做去重键。

4. 风险：历史 attempt 太多影响渲染。  
对策：默认只渲染 active attempt，历史懒加载。

---

## 10. 结论（执行建议）

- 这件事应当做，且要按“不可变历史 + 分支化 + attempt 指针”落地。  
- V1 先做树形分支和版本切换，不强制上图谱。  
- 图谱视图放独立插件页作为增强能力（V2）。  
- 先保证上下文与记录严格一致，再做高级可视化。
