# gstack Workflow Report (2026-04-05, Phase 6 Security Step 1)

Task: 落地生产安全基线（CORS 白名单 + 写接口限流 + 可选 HTTPS 强制）并完成可观测实验

## 1) plan-eng-review

Status: `DONE`

Decisions:

- 不引入外部依赖，先用内置固定窗口限流器（可配置窗口与阈值）。
- CORS 使用可配置通配符模式匹配（默认仅允许 extension/localhost）。
- HTTPS 强制作为显式开关（`SURF_AI_REQUIRE_HTTPS`），兼容反向代理头 `x-forwarded-proto`。

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

- `SURF_AI_PORT=43130 ... SURF_AI_EVAL_BASE_URL=http://127.0.0.1:43130 pnpm evals`
- CORS experiment (`43131`):
  - Allowed origin: `Origin: chrome-extension://abc`
  - Denied origin: `Origin: https://evil.example`
- Rate limit experiment (`43132`):
  - `SURF_AI_RATE_LIMIT_MAX_REQUESTS=2`
  - three consecutive `POST /chat`
- HTTPS gate experiment (`43133`):
  - `SURF_AI_REQUIRE_HTTPS=1`
  - plain HTTP request
  - request with `x-forwarded-proto: https`

Result:

- `evals`: `4/4 passed`
- CORS:
  - allow case: `200` + `access-control-allow-origin: chrome-extension://abc`
  - deny case: `500` (`Origin not allowed`)
- Rate limit:
  - request codes: `200`, `200`, `429`
  - body: `{"error":"rate_limited","bucket":"chat","retryAfterMs":...}`
- HTTPS gate:
  - plain HTTP: `426` (`https_required`)
  - forwarded https header: `200`

## 4) review

Status: `DONE`

Checklist:

- 限流仅作用于写接口：`/chat`、`/sessions/:id/messages`、`/tts`。
- 限流响应带可观测头与 `retry-after`。
- HTTPS 开关关闭时不影响本地开发链路。
- 文档与 `.env.example` 已同步。

## 5) report

Status: `DONE`

Artifacts:

- `apps/bridge/src/core/config.ts`
- `apps/bridge/src/core/rate-limit.ts`
- `apps/bridge/src/index.ts`
- `apps/bridge/.env.example`
- `README.md`
- `RUNBOOK.md`
- `docs/bridge-api.md`
- `docs/BACKEND_SESSION_MODE.md`
- `docs/PLAN.md`
