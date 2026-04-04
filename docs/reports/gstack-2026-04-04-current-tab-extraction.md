# gstack Workflow Report (2026-04-04)

Task: 当前标签页全文提取（Readability + fallback）链路落地与安全加固

## 1) plan-eng-review

Status: `DONE`

Scope reviewed:

- Extension: `content -> background -> sidepanel` 消息链路
- Shared contract: `UiToExtensionMessage/Response`, `BridgeChatRequest.context`
- Bridge: `chat` schema + prompt 拼装

Key decisions:

- 全文提取默认截断 `60,000` 字符，bridge prompt 侧再裁剪到 `24,000`。
- `extract_active_tab_content` 不再广播给所有 extension context，改为仅返回请求方。
- 发送消息时默认不自动附带全文，改为用户显式勾选。

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

- `pnpm typecheck`
- `pnpm build`
- `pnpm evals`（通过提权临时拉起 bridge）

Result:

- `evals`: `3/3 passed`
- 端口受限场景（沙箱 `EPERM 127.0.0.1:43127`）通过提权执行解决。

## 4) review (含 adversarial/cross-model)

Status: `DONE`

Executed:

- 多轮 codex adversarial review（read-only）

Findings and fixes:

- Prompt injection boundary:
  - Fix: 不再使用 markdown code fence 包装原文，改为 JSON 字符串 + safety instructions。
- Page content broadcast leakage:
  - Fix: 移除 `extract_active_tab_content` 的全局 runtime 广播。
- Stale context leakage:
  - Fix: 会话切换/选区注入/发送后/提取失败均清理 `pageContent`。
- Unintentional full-page exfiltration:
  - Fix: 新增 UI 显式勾选 `includePageContext`，默认关闭。
- Readability main-thread risk:
  - Fix: 增加 `READABILITY_MAX_NODE_COUNT` 保护，超阈值走 fallback。

Final cross-model verdict:

- `CLEAN`

## 5) workflow policy update

Status: `DONE`

- Updated `AGENT.md` section `8. gstack 强制流程`:
  - 强制 `plan-eng-review -> build -> qa -> review -> report`
  - `qa + review` 未通过不得提交
  - 环境阻塞需明确记录
