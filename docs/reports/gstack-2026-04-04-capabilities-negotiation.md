# gstack Workflow Report (2026-04-04)

Task: bridge `/capabilities` + sidepanel 动态能力协商

## 1) plan-eng-review

Status: `DONE`

Scope reviewed:

- Bridge: 新增 `GET /capabilities`
- Shared: 新增 capabilities 契约类型
- Extension sidepanel: 适配器列表改为服务端能力驱动
- Backward compatibility: `/capabilities` 不可用时降级 `/models`

Key decisions:

- 本地 Agent 优先策略不变（`mock/codex/claude` 为 native）。
- `openai-compatible/anthropic/gemini` 继续作为 compatibility 占位，并显式返回 `routedTo`。
- TTS 通过 `tts.minimax.configured` 暴露配置状态；未配置时 sidepanel 不发起朗读请求。

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

- `pnpm evals`
- 因沙箱端口限制（`EPERM 127.0.0.1:43127`），通过提权临时拉起 bridge 后执行。

Result:

- `PASS sum-1`
- `PASS trans-1`
- `PASS qa-1`
- `Summary: 3/3 passed`

## 4) review

Status: `DONE`

Review checklist:

- API contract consistency (`shared` / `bridge` / `extension`)：通过。
- 向后兼容：旧 bridge 无 `/capabilities` 时降级 `/models`：通过。
- 数据边界：未新增跨域放宽、未引入额外权限申请：通过。
- TTS 退化路径：未配置时 UI 不主动请求 `/tts`，避免噪声错误：通过。

## 5) report

Status: `DONE`

Artifacts:

- 本报告：`docs/reports/gstack-2026-04-04-capabilities-negotiation.md`
- API 文档更新：`docs/bridge-api.md`
- 规划基线更新：`docs/PLAN.md`
