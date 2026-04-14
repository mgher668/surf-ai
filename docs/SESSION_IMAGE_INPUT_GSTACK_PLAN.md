# 会话图片输入实施规划（gstack）

日期：2026-04-14  
状态：Ready for Implementation

## 1. 锁定决策（已确认）

1. 统一消息结构预留给所有适配器；本期先打通 `codex`。
2. 一条消息允许“文本 + 多图”，图片首期统一附在消息末尾。
3. 图片需要持久化（历史消息可回显）。
4. 限制：单张最大 `10MB`，每条消息最多 `10` 张。
5. 首期原图直传，不做压缩/EXIF 清理。
6. 模型不支持图片时，自动忽略图片，仅发送文本。
7. UI 必须支持：粘贴、拖拽、文件选择；拖拽热区覆盖整个会话区域。

---

## 2. Goal / Scope / Acceptance / Out of Scope

### 2.1 Goal

- 在 Sidepanel 中支持图片粘贴/拖拽/上传，并随用户消息发送到 Codex。
- 会话历史可稳定回显图片（刷新后仍可见）。
- 与现有 run/SSE 流程兼容，不破坏当前会话状态机。

### 2.2 Scope

- `packages/shared`：扩展消息与 run 请求的类型契约。
- `apps/bridge`：上传、存储、鉴权下载、run 入参扩展、Codex App Server 输入拼装。
- `apps/extension`：输入区图片选择体验、拖拽热区、发送前预览与删除、历史渲染。

### 2.3 Acceptance（硬性）

1. 用户可通过粘贴、拖拽、文件选择加入图片，并在发送前看到缩略图。
2. 每条消息最多 10 张，超限或超 10MB 被拒绝并有明确错误提示。
3. 发送成功后图片与消息绑定，刷新页面后仍可渲染。
4. `codex` run 使用 app-server `turn/start.input` 传入 `localImage` 项。
5. 模型不支持图片时，不报错中断；自动仅发送文本并提示“已忽略图片”。
6. 现有纯文本消息行为不变，旧数据不需要迁移脚本也可正常读写。

### 2.4 Out of Scope（本期不做）

- 文本编辑器内任意位置插图（富文本排版）。
- 图片压缩、裁剪、标注、OCR。
- `claude/mock` 真正消费图片（先保持忽略策略）。

---

## 3. 现状与缺口

1. 当前消息模型为纯文本：`content: string`。  
2. 当前 `/sessions/:id/runs` 仅接收 `content` 文本。  
3. 当前 `codex` app-server 调用 `turn/start.input` 仅发送 `text`。  
4. Bridge 尚无文件上传与鉴权下载能力。

备注：Codex app-server 官方协议支持 `text` / `image` / `localImage` 输入项，本期使用 `localImage`（本地绝对路径）。

---

## 4. 目标架构

## 4.1 统一消息结构（向后兼容）

- 新增 `MessagePart`：
  - `text`：`{ type: "text"; text: string }`
  - `image`：`{ type: "image"; attachmentId: string; mimeType: string; sizeBytes: number; name?: string }`
- `ChatMessage` 保留 `content: string`（兼容旧代码与检索）；新增 `parts?: MessagePart[]`。
- 规则：若有图片，`parts` 顺序固定为“文本 part + N 个图片 part（末尾追加）”。

## 4.2 上传与持久化

- 新增上传入口：`POST /uploads`（multipart/form-data，鉴权）。
- Bridge 落盘目录：`apps/bridge/data/uploads/<userId>/<yyyy>/<mm>/<uuid>.<ext>`。
- DB 新增：
  - `attachments`：存文件元数据与路径。
  - `message_attachments`：消息与附件的有序关联。
- 历史渲染通过 `GET /uploads/:id`（鉴权 + 所有权校验）获取图片。

## 4.3 运行链路

- `/sessions/:id/runs` 入参新增 `attachmentIds?: string[]`。
- 创建 `userMessage` 时将附件绑定到该消息。
- `codex` 路径在 `turn/start.input` 拼接：
  - `[{type:"text", text: ...}, ...{type:"localImage", path: absPath}]`
- 不支持图片模型时，过滤 `localImage` 输入项并记录 warning 事件。

---

## 5. 数据模型与迁移

## 5.1 新表

### `attachments`

- `id` TEXT PK
- `user_id` TEXT NOT NULL
- `session_id` TEXT
- `storage_path` TEXT NOT NULL
- `mime_type` TEXT NOT NULL
- `file_name` TEXT
- `byte_size` INTEGER NOT NULL
- `sha256` TEXT
- `created_at` INTEGER NOT NULL
- `updated_at` INTEGER NOT NULL
- `deleted_at` INTEGER

索引建议：
- `(user_id, created_at DESC)`
- `(session_id, created_at DESC)`
- `(sha256)`

### `message_attachments`

- `message_id` TEXT NOT NULL
- `attachment_id` TEXT NOT NULL
- `ord` INTEGER NOT NULL
- `created_at` INTEGER NOT NULL
- `PRIMARY KEY(message_id, attachment_id)`

索引建议：
- `(message_id, ord ASC)`
- `(attachment_id)`

## 5.2 现有表最小改动

- `messages` 新增可选列：`parts_json TEXT`（保留 `content`）。
- 旧行默认 `parts_json = NULL`，读时回退为纯文本。

## 5.3 生命周期

- 会话删除时，由消息级联删除 `message_attachments`，并触发附件清理任务（文件删除）。
- 未绑定消息的附件（上传后未发送）按 TTL（建议 24h）后台清理。

---

## 6. Bridge API 设计

## 6.1 新增

- `POST /uploads`
  - 入参：`multipart/form-data`（单文件）。
  - 校验：MIME、扩展名、魔数、`<=10MB`。
  - 出参：`{ attachment }`（id, mimeType, sizeBytes, url, ...）。

- `GET /uploads/:id`
  - 鉴权后返回文件流。
  - 校验 `attachment.user_id == currentUser`。

## 6.2 变更

- `POST /sessions/:id/runs`
  - body 新增：`attachmentIds?: string[]`（最大 10）。
  - 发送时与 `content` 一起创建 `userMessage(parts_json)`。
  - 响应中的 `userMessage` 带 `parts` 与附件元数据。

- `GET /sessions/:id/messages`
  - 返回 `parts` 与附件展示字段，前端直接渲染。

## 6.3 错误码（新增）

- `image_count_exceeded`
- `image_too_large`
- `image_type_not_allowed`
- `attachment_not_found`
- `attachment_not_owned`
- `attachment_not_bound`

---

## 7. 前端交互方案（Sidepanel）

## 7.1 输入区

- 新增本地状态 `pendingAttachments`（最多 10）。
- 三种入口：
  1. `paste`：读取剪贴板图片。
  2. `drop`：会话主区域全局热区，拖入时显示 overlay 高亮。
  3. 文件选择：按钮触发 `<input type="file" accept="image/*" multiple>`。

## 7.2 发送前体验

- 输入框上方显示缩略图条带（文件名、大小、删除按钮）。
- 超限/超大文件即时拒绝并给出 toast/hint。

## 7.3 发送逻辑

1. 批量上传 `pendingAttachments` -> 得到 `attachmentIds`。
2. 调用 `POST /sessions/:id/runs` 携带 `content + attachmentIds`。
3. 成功后清空 `pendingAttachments`。

## 7.4 历史渲染

- user/assistant 消息均按 `parts` 渲染。
- `text` 用现有渲染流程，`image` 用 `<img src="/uploads/:id">`。
- 点击图片可放大预览（复用当前消息预览弹层即可）。

---

## 8. Codex Runtime 方案（App Server）

## 8.1 turn/start 输入拼装

- 保持首项文本输入：`{ type: "text", text: turnInput }`。
- 追加图片输入：`{ type: "localImage", path: absolutePath }`。
- 维持当前 thread/resume 语义不变。

## 8.2 模型能力判定与降级

- 判定来源优先级：
  1. app-server `model/list` 的 `inputModalities`（若已接入）
  2. 本地 allowlist（临时兜底）
- 若不支持 image：过滤图片输入，仅发送文本；写入 run 事件与前端提示。

---

## 9. 适配器策略（统一结构，分阶段消费）

1. 所有 adapter 统一接受 `parts`。
2. `codex`：本期完整消费图片。
3. `claude/mock`：本期忽略图片，仅消费文本，不报错。
4. `openai-compatible/anthropic/gemini`：由于当前是 fallback 路由，本期行为随目标本地适配器。

---

## 10. 安全与工程约束

1. 严格校验 MIME 与文件头，拒绝伪装文件。
2. 文件名不参与真实路径，统一 UUID 命名，避免路径穿越。
3. 下载接口必须鉴权，禁止匿名访问本地文件。
4. 写入目录限定在 `apps/bridge/data/uploads`，避免任意路径写。
5. 审计上传失败与越权访问事件到 `audit_events`。

---

## 11. gstack 执行计划（Phase + Gate + Evidence）

## Phase 0 - plan-eng-review（冻结方案）

交付：
- 本文档冻结为实施基线，确认类型/API/存储策略。

Gate：
- Goal/Scope/Acceptance/Out of Scope 无冲突。

Evidence：
- 评审记录 + 文档链接。

## Phase 1 - Shared 契约 + Store 迁移

交付：
- `packages/shared` 增加 `MessagePart/Attachment` 类型。
- `store.ts` 增加 `attachments/message_attachments/parts_json` 迁移与 CRUD。

Gate：
- 旧消息读取不受影响；新消息可写入并回读 `parts`。

Evidence：
- `pnpm -r typecheck`

## Phase 2 - Bridge 上传与消息 API

交付：
- `POST /uploads`、`GET /uploads/:id`。
- `POST /sessions/:id/runs` 支持 `attachmentIds`。
- 错误码与鉴权逻辑落地。

Gate：
- 上传、越权、超限、超大小场景全部可测。

Evidence：
- `pnpm --filter @surf-ai/bridge typecheck`
- 手工 API 验证记录。

## Phase 3 - Sidepanel 输入与渲染

交付：
- 粘贴/拖拽/选择文件三入口。
- 全区域拖拽高亮。
- 缩略图预览 + 删除 + 发送链路。
- 历史图片渲染与放大预览。

Gate：
- 发送成功后刷新仍可见图片；失败不丢文本输入。

Evidence：
- `pnpm --filter @surf-ai/extension typecheck`
- UI QA 截图/录屏。

## Phase 4 - Codex App Server 图片透传

交付：
- `turn/start.input` 追加 `localImage`。
- 模型不支持图片时自动忽略并提示。

Gate：
- Codex 实际收到图片并能基于图片回复。

Evidence：
- run 事件日志 + 实测会话。

## Phase 5 - QA（Standard）+ Review

最小用例：
1. 粘贴 1 张图 + 文本发送成功。
2. 拖拽 10 张图发送成功。
3. 第 11 张被拒绝。
4. 单图 >10MB 被拒绝。
5. 模型不支持图片时仅文本发送成功并有提示。
6. 刷新后历史图片可见。
7. 删除会话后图片文件被清理或标记待清理。

Gate：
- `qa` + `review` 结论达到 `DONE` 或 `DONE_WITH_CONCERNS`。

Evidence：
- `pnpm -r typecheck && pnpm -r build`
- QA 报告。

## Phase 6 - Report 与文档更新

交付：
- 更新 `docs/bridge-api.md`（上传/附件/错误码）。
- 输出 gstack 报告（Phase 结果、风险、后续建议）。

Gate：
- 文档与实现一致，无悬空接口。

---

## 12. 可选 subagent 分工（非必须）

本任务可单线程完成；若需要加速，建议仅在“写入边界完全不重叠”时启用：

1. Track A（Bridge 数据层）  
文件：`apps/bridge/src/core/store.ts`, `packages/shared/src/index.ts`

2. Track B（Bridge API + Runtime）  
文件：`apps/bridge/src/index.ts`, `apps/bridge/src/runtimes/codex-app-server-runtime.ts`

3. Track C（Extension UI）  
文件：`apps/extension/src/ui/sidepanel/App.tsx` 及拆分组件

4. Track D（QA/Docs）  
文件：`docs/bridge-api.md`, `docs/reports/*`

规则：同一时刻同一文件只能有一个 owner 写入。

---

## 13. 风险与回滚

1. 风险：上传引入大文件导致 Bridge 内存压力。  
对策：流式写盘，限制单文件与总数量，拒绝超限。

2. 风险：附件路径/鉴权处理不当导致本地文件泄露。  
对策：仅允许附件 ID 访问，严格 user ownership 校验。

3. 风险：UI 拖拽热区与现有交互冲突。  
对策：仅在 `image/*` 拖入时激活 overlay，其他拖拽忽略。

4. 回滚策略：  
- 保留 `content` 主链路，附件功能可通过开关快速禁用；  
- 不删除旧字段，迁移采用增量列/增量表，回滚可“停用新接口 + 忽略 parts”。

---

## 14. 本期完成定义（DoD）

1. 文本 + 图片混合发送链路在 codex 跑通。  
2. 图片持久化与历史回显稳定。  
3. 三种输入交互完整可用。  
4. gstack `plan-eng-review -> build -> qa -> review -> report` 全部有证据。
