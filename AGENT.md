# AGENT.md

本文件定义本仓库的 Agent 协作约束（Harness Engineering）。

## 1. 任务输入模板

每次开始实现前必须明确：

- `Goal`：要交付什么用户可见结果。
- `Scope`：本次改动边界（文件/模块/接口）。
- `Acceptance`：可验证验收条件。
- `Out of Scope`：明确不做的内容。

## 2. 执行循环（必须遵守）

1. 先写最小实现方案（不超过 10 行）。
2. 切成小步提交，每步可运行、可验证。
3. 每步后执行对应验证（构建/测试/手工检查）。
4. 失败先定位根因再改，不盲改。
5. 完成后更新 README/变更说明。

## 3. 角色分工（可并行）

- `Planner`：拆解任务、定义验收、识别风险。
- `Builder`：实现代码与迁移。
- `Evaluator`：做代码审查与回归验证。

同一时刻必须只有一个角色对同一文件做写入。

大型阶段必须优先使用 subagent，但必须按职责拆分，避免共享核心文件冲突：

- `Read-only Analysis`：只读分析当前代码路径、数据流、耦合点、未知风险。
- `Test Supplement`：只负责测试/eval，写入范围必须限定到测试或评估文件。
- `UI QA`：默认只读，验证浏览器插件/sidepanel/独立页真实路径并报告问题。
- `Risk Review`：只读，审查数据隔离、提示注入、工具审批、迁移、回滚风险。

主 agent 必须负责架构决策、核心代码修改、结果整合与最终收口。不得让多个 agent 同时编辑 `SessionManager`、store/schema、runtime manager、shared event types 等核心共享模块。

## 4. 扩展开发硬约束

- 使用 Manifest V3。
- 权限最小化：优先 `activeTab` + 精确 `host_permissions`。
- 禁止远程托管代码注入扩展执行环境。
- Service Worker 视为短生命周期，不保存关键内存状态。
- 涉及用户数据的变更必须说明存储位置与生命周期。

## 5. 本地 Bridge 硬约束

- 必须有鉴权（配对令牌或等价机制）。
- 默认仅监听 `127.0.0.1`。
- 所有接口返回结构化错误码与可读错误信息。
- 统一流式协议（SSE 或 WebSocket 二选一，不混用）。

## 6. 数据与会话约束

- 后端 SQLite 是 sessions/messages/runs/approvals/audit 的真相源。
- `chrome.storage.local`：设置、连接配置、客户端偏好、轻量缓存索引。
- `IndexedDB`：仅作为浏览器端缓存或大字段临时缓存，不作为最终真相源。
- 多窗口同步必须基于后端刷新、SSE/run timeline、`storage.onChanged` 或等价事件。
- 任何会话/消息持久化策略变更都必须说明后端表、客户端缓存、同步/失效规则。

## 7. 交付输出规范

每次任务结束输出：

- 修改文件清单。
- 验证结果（通过/失败 + 原因）。
- 剩余风险与下一步建议（最多 3 条）。

## 8. gstack 强制流程（新增，必须遵守）

从现在开始，所有开发任务默认必须走完以下 gstack 流程：

1. `plan-eng-review`：实现前先做工程评审（架构、边界、风险、验收口径）。
2. `build`：完成实现并通过本地类型/构建校验。
3. `qa`：至少执行 Quick 级别验证；涉及 UI、交互、数据链路时默认 Standard。
4. `review`：提交前做差异审查（含 adversarial/cross-model 检查）。
5. `report`：输出本次 gate 结果（DONE / DONE_WITH_CONCERNS / BLOCKED）。

执行细则：

- gstack 使用仓库内安装：`.agents/skills/gstack`。
- 失败不得跳过：任何 gate 失败必须先修复或显式标记 `BLOCKED`。
- 未通过 `qa + review` 不允许进入提交阶段。
- 如受环境限制无法执行（端口权限、网络等），必须记录阻塞原因与复现命令。

## 9. Harness 阶段记录（大型改造必须遵守）

涉及 Agent Runtime、memory、context engine、tool registry、approval runtime、event timeline、数据库结构、跨 adapter 行为的大型阶段，必须先创建阶段执行记录：

```text
docs/harness/phase-x-short-name.md
```

每份阶段记录必须包含：

- `Goal`
- `Scope`
- `Non-Goals`
- `Subagent Plan`
- `Implementation Plan`
- `Decision Log`
- `Validation Plan`
- `Validation Report`
- `Risk Review`
- `Final Status`

阶段规则：

- 没有阶段 harness 记录，不得开始核心实现。
- 阶段记录必须持续更新，不是一次性计划。
- subagent 输出只写摘要，不粘贴长原文。
- 阶段结束必须写 `Final Status: DONE / DONE_WITH_CONCERNS / BLOCKED`。
- 没有 final status，不得进入下一阶段。
- 核心代码提交前必须同步更新对应 harness 文档。
- 每个 Phase 完成后必须创建独立 commit，commit message 应包含 phase 名称或目标。
- 默认不 push；push 必须由用户明确确认。
- commit 前必须检查无关脏改、数据库、`temp/`、日志、密钥没有混入。

总体路线图见 `docs/AGENT_RUNTIME_EVOLUTION_PLAN.md`。Hermes Agent 只作为架构思想输入，不复制其内部实现，不引入代码依赖。
