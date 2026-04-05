# Backend Session Mode (Planned)

目标：支持“一个后端服务 + 多个浏览器插件客户端”共享同一套会话与消息。

## 0) 已确认决策（2026-04-05）

1. 持久层：先用 SQLite。
2. 鉴权：直接做多用户账号隔离（非匿名写接口）。
3. 摘要执行器：使用“当前可用本地 Agent”做一次性摘要调用。
4. 文档策略：本方案文档纳入仓库并持续更新。

## 1) 大白话架构

- 后端是唯一真相源（Source of Truth）：
  - 会话列表、消息正文、收藏状态都存在后端。
- 插件本地是缓存层：
  - 用于加速显示和短时离线，不作为最终真相。
- Agent 连续会话靠后端维护：
  - `surfSessionId + adapter -> providerSessionId`。

## 2) 会话模型：主会话 + 子会话

1. 主会话（Surf Session）
- 用户视角会话，保存完整消息历史（全量不丢）。

2. 子会话（Agent Session Link）
- 每个 adapter 各有自己的 provider 会话 id（例如 codex/claude）。
- 不能跨 provider 复用同一个会话 id。

3. 同步游标（关键）
- 每个子会话维护 `synced_seq`：
  - 表示该子会话已同步到主会话的哪条消息。
- 切换 adapter 时，只补 `synced_seq` 之后的增量消息。

## 3) `IDLE` 状态定义

- `ACTIVE`：最近有消息写入。
- `IDLE`：超过阈值时间无新消息（建议默认 30 分钟，可配置）。
- `CLOSED`：用户显式关闭。

说明：
- `IDLE` 不是删除，不会丢历史。
- `IDLE` 只影响调度策略（例如不保持热状态）。

## 4) Handoff（交接包）策略

## 4.1 核心原则

1. 不做“固定 8 条硬编码”。
2. 使用自适应窗口 + 摘要 + 关键事实。
3. 完整历史始终保留在后端，不因 handoff 丢失。

## 4.2 交接包内容（建议）

1. `latest_user_request`：最新用户问题原文（必带）。
2. `delta_summary`：从目标子会话 `synced_seq` 到当前的增量摘要。
3. `recent_verbatim`：最近原文窗口（动态 8~20 条，按 token 预算调节）。
4. `pinned_facts`：固定事实/约束/偏好。
5. `open_todos`：未完成事项。
6. `evidence_refs`：引用消息 `seq/id`，便于追溯。

## 4.3 摘要如何生成

- 由当前可用本地 Agent 执行“一次性摘要调用”。
- 不是新建长期摘要会话，只是短任务。
- 摘要产物落库，供后续切换复用。

## 5) 按需检索老消息（On-demand Retrieval）

## 5.1 触发条件

1. 当前问题引用“更早历史”（例如“上周那个结论”）。
2. 当前 handoff 置信度不足（信息缺失）。
3. 模型回答出现“无法定位历史依据”信号。

## 5.2 检索流程

1. 在 `user_id + session_id` 范围内检索（硬隔离）。
2. 召回候选：
  - Phase 1：关键词/BM25（先做）。
  - Phase 2：关键词 + 向量混合召回（后做）。
3. 时间邻域扩展：命中消息前后各扩 1~2 条（保持语义连续）。
4. 重排：按 query 相关度 + 新鲜度 + 角色权重排序。
5. 在 token 预算内选 topK 并加入 `evidence_refs`。

## 5.3 正确性保障（工程口径）

1. 不跨用户、不跨会话检索（硬约束）。
2. 所有检索结果带消息证据 `seq/id`（可追溯）。
3. 低置信度自动扩窗（例如 topK 扩大 3 倍后重排）。
4. 仍不确定时回退到“更大原文窗口”策略。

说明：
- 无法承诺 100% 语义命中，但以上机制可显著降低漏召和串召。

## 6) 数据模型（最小可用）

1. `users`
- `id`, `name`, `token_hash`, `created_at`

2. `clients`
- `id`, `user_id`, `name`, `last_seen_at`

3. `sessions`
- `id`, `user_id`, `title`, `starred`
- `status` (`ACTIVE` | `IDLE` | `CLOSED`)
- `created_at`, `updated_at`, `last_active_at`

4. `messages`
- `id`, `session_id`, `role`, `content`, `created_at`, `seq`

5. `agent_session_links`
- `session_id`, `provider`, `provider_session_id`
- `synced_seq`
- `state` (`READY` | `BROKEN` | `CLOSED`)
- `last_error`, `updated_at`

6. `session_memories`（建议新增）
- `session_id`, `kind` (`summary` | `facts` | `todos`)
- `content`, `source_seq_start`, `source_seq_end`, `updated_at`

## 7) API 设计（建议）

1. 会话
- `POST /sessions`：创建会话
- `GET /sessions`：分页列会话
- `POST /sessions/:id/star`：收藏/取消
- `POST /sessions/:id/close`：关闭会话

2. 消息
- `GET /sessions/:id/messages?afterSeq=...`：增量拉取
- `POST /sessions/:id/messages`：写入用户消息并触发 agent 回复

3. Agent 链接（内部或管理接口）
- `GET /sessions/:id/agent-link`
- `POST /sessions/:id/agent-link/reset`

4. 可选内部调试接口（后期）
- `POST /sessions/:id/handoff-preview`
- `GET /sessions/:id/context?query=...`

## 8) 分步实施（按优先级）

## Phase 1: 后端会话真相源

1. 引入 SQLite + migration。
2. 实现多用户鉴权与数据隔离。
3. extension 会话/消息迁移到后端 API。
4. extension 本地改为缓存层。

验收：
- 重装插件后，连接同一后端可恢复所有会话消息。

## Phase 2: Codex 连续会话管理

1. 新建 `SessionManager`（含 `synced_seq`）。
2. 首次消息创建 codex provider session 并落库。
3. 后续消息使用 `codex exec resume <providerSessionId>`。
4. session 失效自动重建并标记旧链接 `BROKEN`。

当前状态（2026-04-05）：

- `SessionManager` + codex `resume` + `BROKEN` 回退链路已落地。
- handoff 目前为“delta 原文窗口”版本（摘要/检索增强留在后续 Phase）。

验收：
- 同一会话连续 10+ 轮，切换窗口后仍可续聊。

## Phase 3: Claude Code 同步接入

1. 复用同一 `agent_session_links` 机制。
2. 使用 `--resume` / `--session-id` 续聊。
3. 与 codex 共用错误码与恢复流程。

当前状态（2026-04-05）：

- Claude Code 连续会话链路已落地（`--session-id` 创建 + `--resume` 续聊）。
- 续聊失败自动标记 `BROKEN` 并回退新会话。

验收：
- codex / claude 在同一主会话中可互相切换接管。

## Phase 4: Handoff 与记忆层

1. 落地 `session_memories`。
2. 实现自适应 handoff 打包。
3. 切换 adapter 时做增量同步并更新 `synced_seq`。

当前状态（2026-04-05）：

- `session_memories` 已落地（`summary` / `facts` / `todos`）。
- resume handoff 已升级为自适应结构：
  - `latest_user_request`
  - 可选 `delta_summary`
  - 动态 `recent_verbatim`（窗口与预算控制）
  - 可选 `pinned_facts` / `open_todos`
  - `evidence_refs`
- 摘要由当前可用本地 Agent 一次性生成并落库复用（小增量不强制摘要）。

验收：
- 多次切换 adapter 后，对话上下文保持连续且无明显遗失。

## Phase 5: 按需检索老消息

1. 先做关键词/BM25 检索与证据返回。
2. 再加向量召回与混合重排。
3. 加入低置信度回退策略（扩窗/扩召回）。

当前状态（2026-04-05）：

- Phase 5 第一步已落地：会话内关键词/BM25 检索 + 证据序号绑定。
- 已落地低置信度扩窗（邻域补召回）策略。
- 调试接口已提供：`GET /sessions/:id/context?query=...`。

验收：
- “引用旧结论”类问题的命中率显著提升。

## Phase 6: 生产部署与安全

1. HTTPS + CORS 白名单 + 限流。
2. 审计日志与告警。
3. 数据保留与删除策略。

当前状态（2026-04-05）：

- Phase 6 第一步已落地：
  - CORS 白名单（`SURF_AI_CORS_ALLOW_ORIGINS`，支持通配符）
  - 写接口限流（`/chat`、`/sessions/:id/messages`、`/tts`）
  - 可选 HTTPS 强制（`SURF_AI_REQUIRE_HTTPS` + `SURF_AI_TRUST_PROXY`）
- Phase 6 第二步已落地（最小审计版）：
  - `audit_events` 持久化表
  - 安全关键事件入库（`rate_limited`、`https_required_blocked`、`unauthorized_user` 等）
  - 查询接口：`GET /audit/events?limit=...&eventType=...`
- Phase 6 第三步已落地（手动维护版）：
  - retention 配置：`SURF_AI_RETENTION_SESSION_DAYS`、`SURF_AI_RETENTION_AUDIT_DAYS`
  - 清理接口：`POST /admin/maintenance/purge`（默认 `dryRun=true`）
  - 支持范围控制：`includeSessions` / `includeAudit`

验收：
- 多用户环境下不串数据，未授权访问返回 401/403。

## 9) 不做的事（当前阶段）

- 不先做复杂分组会话。
- 不先做跨 provider 自动迁移全部历史。
- 不先做大规模多租户平台能力。
