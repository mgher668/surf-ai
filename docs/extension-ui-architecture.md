# Extension UI Architecture

Last verified: 2026-06-01

This document is the starting map for agents and developers changing the Surf AI browser extension UI. It explains where the major surfaces live, which modules own which responsibilities, and how to validate changes without rediscovering the project from scratch.

Use this document for orientation. Use Codegraph or Serena to verify current symbol relationships before editing, because source code is the final truth.

## Start Here

Primary package:

- `apps/extension`

Primary verification commands:

```bash
pnpm --filter @surf-ai/extension typecheck
pnpm --filter @surf-ai/extension build
pnpm e2e:extension
```

Notes:

- `pnpm e2e:extension` launches Chromium through CDP and may need elevated execution in sandboxed environments.
- Build chunk warnings are not automatically behavior failures. See `docs/harness/phase-ui-8-extension-bundle-chunk-optimization.md`.

## Entrypoints

| Surface | Entrypoint | Main responsibility |
| --- | --- | --- |
| Manifest | `apps/extension/src/manifest.ts` | MV3 declaration, popup, options page, side panel, background worker, content script, permissions, commands. |
| Background service worker | `apps/extension/src/background/index.ts` | Context menus, keyboard commands, side panel opening, pending selection payloads, active-tab extraction relay, extension badge. |
| Content script | `apps/extension/src/content/index.ts` | Selection handle/menu injected into web pages, selection action messages to background, page content extraction listener. |
| Content extraction | `apps/extension/src/content/extract.ts` | Current page content extraction and readability-oriented payload construction. |
| Popup UI | `apps/extension/src/ui/popup/main.tsx` and `App.tsx` | Compact launcher for side panel, standalone sidepanel page, and settings. |
| Settings UI | `apps/extension/src/ui/settings/main.tsx` and `App.tsx` | Connection, locale/theme/sidebar, default adapter, model, and memory settings. |
| Sidepanel UI | `apps/extension/src/ui/sidepanel/main.tsx` and `App.tsx` | Main chat/runtime UI, also used by standalone extension page. |
| E2E harness | `apps/extension/e2e/standalone-smoke.mjs` | Real built extension smoke through CDP with fake bridge fixture. |

## Extension Boundaries

The extension has three runtime zones:

1. Chrome extension shell
   - `manifest.ts`
   - `background/index.ts`
   - `content/*`
   - Owns Chrome APIs, commands, context menus, side panel opening, and page selection/extraction messaging.

2. React UI surfaces
   - `ui/popup`
   - `ui/settings`
   - `ui/sidepanel`
   - Own rendering, interaction state, and user-facing workflows.

3. Local extension support libraries
   - `lib/storage.ts`
   - `lib/db.ts`
   - `lib/bridge-sse.ts`
   - Own browser-local persistence helpers and bridge stream plumbing.

Shared contracts come from:

- `packages/shared`

Do not redefine shared contract types inside the extension. Import them from `@surf-ai/shared`.

## Storage Model

`chrome.storage.local` stores settings, connection configuration, UI preferences, and light client cache indexes through `apps/extension/src/lib/storage.ts`.

Current storage helper responsibilities:

- Connections and active connection.
- Active session id.
- Cached session list.
- Locale.
- Default adapter.
- Theme mode.
- Sidebar mode and collapsed state.
- Storage change subscription.

IndexedDB stores browser-local cached messages through `apps/extension/src/lib/db.ts`.

Backend SQLite is still the source of truth for sessions, messages, runs, approvals, and audit state when backend session mode is available. The extension cache must not be treated as final truth.

## Bridge Integration

Sidepanel bridge API wrappers are split by concern:

- `apps/extension/src/ui/sidepanel/api/sessionApi.ts`
  - Session list, message load, session create/rename/star/delete, adapter updates.
  - Reports runtime alerts and preserves backend/local fallback behavior.

- `apps/extension/src/ui/sidepanel/api/bridgeApi.ts`
  - Run list, latest run, run approvals, run events, generic JSON bridge fetch.

- `apps/extension/src/lib/bridge-sse.ts`
  - Streaming run events from `/sessions/:sessionId/runs/:runId/stream`.

Settings has its own small bridge helpers:

- `apps/extension/src/ui/settings/utils/bridgeApi.ts`
  - Settings-oriented bridge headers and model normalization.

Do not casually merge settings and sidepanel bridge helpers. They serve different call sites and error handling needs.

## UI Common Layer

Shared UI primitives and cross-surface helpers live under:

- `apps/extension/src/ui/components/ui`
- `apps/extension/src/ui/common`

Current common responsibilities:

- `common/base.css`: global UI tokens and shared styling baseline.
- `common/i18n.ts`: locale resolution and translation lookup.
- `common/theme.ts`: theme application and system-theme listener.
- `common/hooks/useLocaleThemePreferences.ts`: lightweight popup/shared locale/theme preferences.
- `components/ui/*`: shadcn-style UI primitives used by extension surfaces.

Avoid adding surface-specific business logic to the common layer. Common code should be reusable by at least two surfaces or be a primitive.

## Sidepanel Structure

The sidepanel is the main runtime UI. It also powers the standalone extension page at:

```text
chrome-extension://<id>/src/ui/sidepanel/index.html
```

Local structure:

- `apps/extension/src/ui/sidepanel/App.tsx`
  - Composition root and orchestration.
  - Wires state, hooks, storage bootstrap, and layout together.
  - Should not accumulate new feature-specific business logic when a hook/component/api module is a better owner.

- `apps/extension/src/ui/sidepanel/hooks`
  - Stateful sidepanel feature logic.

- `apps/extension/src/ui/sidepanel/api`
  - Bridge HTTP helpers specific to sidepanel runtime flows.

- `apps/extension/src/ui/sidepanel/components`
  - Presentational and focused interactive components.

- `apps/extension/src/ui/sidepanel/utils/sidepanel-helpers.ts`
  - Pure helpers for timeline construction, message/image extraction, bridge headers, sidebar normalization, and run artifacts.

- `apps/extension/src/ui/sidepanel/styles.ts`
  - Inline style constants that are shared across sidepanel components.

- `apps/extension/src/ui/sidepanel/MarkdownMessage.tsx`
  - Markdown, KaTeX, and Mermaid rendering.

See the local guide for sidepanel-specific ownership rules:

- `apps/extension/src/ui/sidepanel/README.md`

## Settings Structure

Settings owns configuration workflows and should not mutate sidepanel runtime state directly except through shared storage and bridge APIs.

Primary files:

- `apps/extension/src/ui/settings/App.tsx`
  - Settings composition root, storage bootstrap, hash section routing, and high-level handlers.

- `apps/extension/src/ui/settings/components`
  - `SettingsHeader`
  - `SettingsNav`
  - `GeneralSection`
  - `ConnectionsSection`
  - `ModelsSection`
  - `ModelsEditableTable`
  - `MemoriesSection`

- `apps/extension/src/ui/settings/hooks`
  - `useSettingsModels`: load/edit/save model settings.
  - `useSettingsMemories`: load/confirm/reject/delete memories.

- `apps/extension/src/ui/settings/utils`
  - `settingsSections.ts`: section ids, nav metadata, hash resolution.
  - `bridgeApi.ts`: settings-oriented bridge helpers.

Change guidance:

- General preference changes usually belong in `GeneralSection` plus `lib/storage.ts`.
- Connection changes usually belong in `ConnectionsSection` and `settings/App.tsx` handlers.
- Model behavior changes usually start in `useSettingsModels`.
- Memory settings behavior changes usually start in `useSettingsMemories`.

## Popup Structure

Popup is intentionally small. It should stay a launcher and should not become a second runtime UI.

Primary files:

- `apps/extension/src/ui/popup/App.tsx`
- `apps/extension/src/ui/popup/main.tsx`
- `apps/extension/src/ui/popup/popup.css`
- `apps/extension/src/ui/popup/index.html`

Popup responsibilities:

- Open Chrome side panel.
- Open standalone sidepanel page.
- Open settings page.
- Reflect locale/theme enough to avoid shell inconsistency.

Avoid adding chat, settings editing, or bridge runtime behavior to popup.

## Background And Content Messaging

Background owns extension shell actions:

- Builds context menus on install.
- Handles context menu actions.
- Handles keyboard commands.
- Opens side panel.
- Stores pending selection payloads by tab until sidepanel consumes them.
- Relays active-tab extraction requests.
- Sets extension badge state.

Content script owns page-local selection UI:

- Injects the selection handle/menu.
- Sends `open_sidepanel_with_selection` messages.
- Responds to `extract_active_tab_content`.
- Calls `extractCurrentPageContent`.

Shared message types should come from `@surf-ai/shared`.

## Feature To File Map

| Change type | Start here | Then inspect |
| --- | --- | --- |
| Send message flow | `ui/sidepanel/hooks/useSidepanelSend.ts` | `api/sessionApi.ts`, `lib/db.ts`, `lib/storage.ts`, `utils/sidepanel-helpers.ts` |
| Run streaming, approvals, cancel | `ui/sidepanel/hooks/useSidepanelRuns.ts` | `lib/bridge-sse.ts`, `api/bridgeApi.ts`, `components/ProcessTimelineEntry.tsx`, `components/RunStatusBanner.tsx` |
| Session create/rename/delete/star | `ui/sidepanel/hooks/useSessionActions.ts` | `api/sessionApi.ts`, `components/SessionSidebar.tsx`, `components/RenameSessionDialog.tsx` |
| Model/capability selection in chat | `ui/sidepanel/hooks/useSidepanelModels.ts` | `api/bridgeApi.ts`, `settings/hooks/useSettingsModels.ts` |
| Page context and selection payloads | `ui/sidepanel/hooks/usePageContext.ts` | `background/index.ts`, `content/index.ts`, `content/extract.ts`, `components/PageContextBanner.tsx` |
| Attachments and image previews | `ui/sidepanel/hooks/useComposerAttachments.ts` | `components/ComposerAttachmentPreview.tsx`, `components/ImagePreviewSliders.tsx`, `utils/sidepanel-helpers.ts` |
| Markdown, math, Mermaid rendering | `ui/sidepanel/MarkdownMessage.tsx` | `components/LazyMarkdownMessage.tsx`, `components/ConversationMessage.tsx`, `components/MessagePreviewDialog.tsx` |
| TTS/read aloud | `ui/sidepanel/hooks/useSidepanelTts.ts` | `hooks/usePageContext.ts`, bridge capabilities |
| Settings connections | `ui/settings/components/ConnectionsSection.tsx` | `ui/settings/App.tsx`, `lib/storage.ts` |
| Settings model management | `ui/settings/hooks/useSettingsModels.ts` | `components/ModelsSection.tsx`, `components/ModelsEditableTable.tsx` |
| Settings memory management | `ui/settings/hooks/useSettingsMemories.ts` | `components/MemoriesSection.tsx` |
| Popup launch actions | `ui/popup/App.tsx` | `manifest.ts`, `background/index.ts` |
| Extension shell commands | `background/index.ts` | `manifest.ts`, `content/index.ts` |
| Page extraction | `content/extract.ts` | `content/index.ts`, `background/index.ts`, `hooks/usePageContext.ts` |
| E2E smoke coverage | `e2e/standalone-smoke.mjs` | `docs/harness/phase-ui-7-extension-refactor-cdp-smoke.md` |
| Bundle chunk warnings | `vite.config.ts` | `docs/harness/phase-ui-8-extension-bundle-chunk-optimization.md` |

## Invariants

Follow these unless the task explicitly changes the contract:

- Preserve MV3 constraints.
- Do not introduce remotely hosted executable code.
- Do not change shared contracts outside `packages/shared` ad hoc.
- Do not change storage keys without migration and harness updates.
- Keep backend SQLite as source of truth for durable sessions/messages/runs/approvals/audit state.
- Keep `chrome.storage.local` as settings/cache, not final session truth.
- Keep IndexedDB as local cache only.
- Keep popup as launcher, not full runtime surface.
- Keep sidepanel and standalone on the same sidepanel UI entry.
- Keep `App.tsx` files as composition roots; extract feature logic into hooks/api/components when it grows.
- Do not reduce CDP smoke coverage when refactoring.

## Tool Assisted Workflow

Use the docs for orientation, then verify with tools.

Recommended Codegraph usage:

- `codegraph_context` for a feature area before editing.
- `codegraph_callers` or `codegraph_impact` when changing a shared helper or hook.
- `codegraph_trace` for flow questions such as selection payload to sidepanel consumption or send flow to run creation.

Recommended Serena usage:

- Activate the project before code edits.
- Use symbol overview/search to inspect target files without reading unrelated large files.
- Prefer symbol-level edits when changing a whole function or hook.

Do not let the documentation override current source. If docs and Codegraph/Serena disagree, inspect the source and update the docs as part of the change.

## Validation Matrix

| Change area | Minimum validation |
| --- | --- |
| Any TypeScript change in extension | `pnpm --filter @surf-ai/extension typecheck` |
| Build/config/import changes | `pnpm --filter @surf-ai/extension build` |
| Sidepanel send/session/run/approval/settings/popup behavior | `pnpm e2e:extension` |
| Storage keys or shared contract changes | Typecheck, build, E2E, plus migration/compatibility review |
| Bundle chunk changes | Build and compare `apps/extension/dist/assets` sizes |
| Pure docs change | `git diff --check` |

## Related Documents

- `apps/extension/src/ui/sidepanel/README.md`
- `docs/harness/phase-ui-7-extension-refactor-cdp-smoke.md`
- `docs/harness/phase-ui-8-extension-bundle-chunk-optimization.md`
- `docs/design/surf-ai-design-system.md`
- `docs/AGENT_RUNTIME_EVOLUTION_PLAN.md`
