# gstack Workflow Report (2026-04-05, Phase 5 Retrieval Step 1)

Task: 落地 Phase 5 第一步（关键词/BM25 检索 + 低置信扩窗）并完成中英检索实验

## 1) plan-eng-review

Status: `DONE`

Decisions:

- 先落地会话内关键词/BM25 检索，不引入外部向量依赖。
- 检索结果必须带 `seq` 证据并绑定到 handoff `evidence_refs`。
- 增加内部调试接口 `/sessions/:id/context`，便于可观测验证。

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
- Retrieval experiment A (English): query references old token `PHASE5-ALPHA`
- Retrieval experiment B (Chinese): query `上次提到的结论是什么？`

Result:

- `evals`: `4/4 passed`
- Experiment A:
  - `triggered=true`
  - top hit seq=1 snippet contains `PHASE5-ALPHA`
- Experiment B:
  - `triggered=true`
  - top hit seq=1 snippet contains `结论：蓝色方案优先，预算10万。`

## 4) review

Status: `DONE`

Review checklist:

- 检索严格使用当前 `session` 消息，不跨用户/会话。
- 对 handoff 最近窗口做排除，避免重复喂入相同上下文。
- 低置信场景支持邻域补召回（neighbor expansion）。
- 调试接口返回 `topScore` / `lowConfidence` / `expanded` 可用于线上调参。

## 5) report

Status: `DONE`

Artifacts:

- `apps/bridge/src/core/retrieval.ts`
- `apps/bridge/src/core/session-manager.ts`
- `apps/bridge/src/index.ts`
- `docs/bridge-api.md`
- `docs/BACKEND_SESSION_MODE.md`
