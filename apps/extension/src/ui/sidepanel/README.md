# Sidepanel UI Structure

Last verified: 2026-06-01

This guide explains the current sidepanel module boundaries after the extension UI refactor. Use it before changing the sidepanel, standalone chat page, message rendering, runtime stream handling, or session behavior.

The sidepanel route is the main Surf AI chat/runtime UI and is also opened as the standalone extension page:

```text
src/ui/sidepanel/index.html
```

## High Level Rule

`App.tsx` is the composition root. It should wire state, hooks, layout, and components together. Do not keep adding feature-specific business logic to `App.tsx` when the logic has a clear owner in `hooks`, `api`, `components`, or `utils`.

## Directory Map

| Path | Responsibility |
| --- | --- |
| `App.tsx` | Sidepanel composition root, storage/bootstrap orchestration, state wiring, layout assembly. |
| `main.tsx` | React root, global CSS imports, sidepanel entry bootstrapping. |
| `components/` | Focused UI components and dialogs. |
| `hooks/` | Stateful feature logic extracted from `App.tsx`. |
| `api/` | Sidepanel-specific bridge HTTP helpers. |
| `utils/sidepanel-helpers.ts` | Pure helpers for timeline/message/image/run/context transformation. |
| `styles.ts` | Shared inline style constants used by sidepanel components. |
| `MarkdownMessage.tsx` | Markdown, KaTeX, and Mermaid rendering. |
| `markdown-message.css` | Markdown-rendered content styles. |

## App Responsibilities

`App.tsx` currently owns:

- Top-level UI state wiring.
- Storage bootstrap and storage change subscriptions.
- Active connection/session selection state.
- Theme/sidebar state.
- Backend/local session mode switching.
- Hook composition.
- Layout composition.
- Passing callbacks/data into components.

Prefer extracting from `App.tsx` when adding:

- A new async bridge flow.
- A new state machine.
- A new dialog with internal state.
- A new repeated view.
- A new pure transformation or formatting helper.

## Hooks

| Hook | Owner of |
| --- | --- |
| `useSidepanelModels.ts` | Capabilities, model list, adapter/model selection, TTS readiness derived from capabilities. |
| `useSidepanelRuns.ts` | Active run state, run stream lifecycle, timeline process state, approvals, cancel, stream replay. |
| `useSidepanelSend.ts` | Composer send flow, backend draft session creation, uploads, chat request construction, local fallback send path. |
| `useSessionActions.ts` | New session, rename, delete, star, per-session adapter memory. |
| `usePageContext.ts` | Selection payloads, page extraction, page context include/clear flow, TTS request integration. |
| `useComposerAttachments.ts` | Attachment selection, paste/drop handling, validation, drag overlay state. |
| `useConversationPreview.ts` | Focused message preview dialog, preview navigation, raw view state for previewed messages. |
| `useKeyboardScroll.ts` | Press-and-hold keyboard scrolling for scroll containers. |
| `useSidepanelTts.ts` | Read-aloud request helper against the active bridge. |
| `useRuntimeAlert.ts` | Runtime alert state, recent audit event state, extension badge reporting. |

When adding sidepanel feature logic, first decide whether it belongs in an existing hook. Add a new hook only when it has a distinct lifecycle or state boundary.

## API Modules

`api/sessionApi.ts` owns session/message mutation and loading calls:

- Fetch sessions.
- Load messages.
- Create session.
- Rename session.
- Star session.
- Delete session.
- Update session adapter.
- Report/clear runtime alerts around backend failures.

`api/bridgeApi.ts` owns run/process read helpers:

- Fetch latest run.
- Fetch session runs.
- Fetch run approvals.
- Fetch run events.
- Shared `fetchBridgeJson` helper for sidepanel runtime reads.

Streaming is not in `api/bridgeApi.ts`; it lives in:

- `apps/extension/src/lib/bridge-sse.ts`

## Components

| Component | Responsibility |
| --- | --- |
| `SidepanelTopbar.tsx` | Header controls, connection/runtime status, standalone/settings actions, model controls. |
| `SessionSidebar.tsx` | Session list, active session selection, session action buttons. |
| `ConversationMessage.tsx` | User/assistant message rendering, raw toggle, message images. |
| `LazyMarkdownMessage.tsx` | Lazy boundary for Markdown renderer to keep Markdown dependencies out of the initial entry chunk. |
| `MessagePreviewDialog.tsx` | Large focused message preview with raw/markdown rendering and image preview actions. |
| `ProcessTimelineEntry.tsx` | Run event/approval/process timeline item rendering. |
| `RunStatusBanner.tsx` | Active run status and cancel affordance. |
| `PageContextBanner.tsx` | Current page/selection context display and clear/include actions. |
| `ComposerAttachmentPreview.tsx` | Composer attachment thumbnail grid and removal/open actions. |
| `ImagePreviewSliders.tsx` | Photo viewer integration for message/composer image galleries. |
| `RenameSessionDialog.tsx` | Rename session dialog UI. |

Components should not own bridge fetch logic unless it is strictly local UI plumbing. Put runtime behavior in hooks/api modules.

## Utility Module

`utils/sidepanel-helpers.ts` is the pure transformation module.

Current responsibilities include:

- Stream assistant phase state helpers.
- Session gallery image keys and image list construction.
- Composer gallery image construction.
- Message image extraction and URL resolution.
- User message text resolution.
- Sidebar mode normalization.
- Session list merge/equality helpers.
- Model list normalization.
- Assistant stream phase normalization and content merge.
- Run artifact and process timeline construction.
- Conversation timeline construction.
- Display assistant text selection.
- Run in-flight status detection.
- Run status formatting.
- Message list equality.
- Approval upsert and decision key stabilization.
- Bridge header construction.
- Chat context construction.

Do not add React state, effects, or browser side effects to this file.

## Markdown Boundary

Markdown rendering is intentionally isolated:

- `MarkdownMessage.tsx` owns `react-markdown`, remark/rehype plugins, KaTeX, Mermaid block rendering, and markdown CSS.
- `LazyMarkdownMessage.tsx` owns the `React.lazy`/`Suspense` boundary.
- `ConversationMessage.tsx` and `MessagePreviewDialog.tsx` should use the lazy wrapper for formatted assistant messages.

Mermaid remains dynamically imported inside `MarkdownMessage.tsx` for fenced `language-mermaid` blocks. Do not move Mermaid into the initial sidepanel entry unless there is a deliberate performance decision.

## Main Flows

### Send Message

1. `App.tsx` passes composer state into `useSidepanelSend`.
2. `useSidepanelSend` validates input/attachments and active run state.
3. Backend mode creates a backend session when the draft session is active.
4. Attachments are uploaded when required.
5. The hook posts the chat/run request to the bridge.
6. The created run is handed to `useSidepanelRuns`.
7. `useSidepanelRuns` opens the SSE stream through `lib/bridge-sse.ts`.
8. Stream events update assistant text, run process state, approvals, and persisted messages.

Start in `useSidepanelSend.ts` for send bugs. Move to `useSidepanelRuns.ts` for stream, approval, or replay bugs.

### Load Session

1. `App.tsx` tracks `activeSessionId`.
2. Backend mode loads sessions through `api/sessionApi.ts`.
3. Message loading uses `loadMessagesFromBackend`.
4. Loaded messages are cached in IndexedDB via `lib/db.ts`.
5. Run history and process state are loaded by `useSidepanelRuns`.

Start in `App.tsx` only to understand wiring. Put fixes in `api/sessionApi.ts`, `useSidepanelRuns.ts`, or storage/cache helpers when possible.

### Page Context

1. Content script exposes selection actions and page extraction.
2. Background opens sidepanel and stores pending selection payloads by tab.
3. `usePageContext` consumes pending payloads and active-tab extraction results.
4. `buildChatContext` in `sidepanel-helpers.ts` injects selected/page context into chat requests.

Start in `usePageContext.ts` for sidepanel state. Start in `background/index.ts` or `content/index.ts` for Chrome messaging issues.

### Image Attachments

1. `useComposerAttachments` handles file input, paste, drag, drop, and validation.
2. `useSidepanelSend` uploads attachments in backend mode.
3. `ConversationMessage`, `MessagePreviewDialog`, and `ImagePreviewSliders` render attached/generated images.
4. `sidepanel-helpers.ts` builds gallery image keys and resolves image URLs.

Start in `useComposerAttachments.ts` for input bugs. Start in `sidepanel-helpers.ts` for gallery/image resolution bugs.

## Change Playbooks

| Task | Modify first | Be careful with |
| --- | --- | --- |
| Add a new composer option | `App.tsx` wiring, then a focused hook/component | Storage key changes and send request payload shape. |
| Change backend chat request body | `useSidepanelSend.ts`, `sidepanel-helpers.ts` | Shared bridge request types in `@surf-ai/shared`. |
| Change approval rendering | `ProcessTimelineEntry.tsx` | Approval decision submission in `useSidepanelRuns.ts`. |
| Change run replay behavior | `useSidepanelRuns.ts`, `api/bridgeApi.ts` | Existing CDP replay assertions. |
| Change session rename/delete/star | `useSessionActions.ts`, `api/sessionApi.ts` | Backend/local parity and cached session list persistence. |
| Change Markdown rendering | `MarkdownMessage.tsx` | Bundle size, Mermaid async loading, KaTeX CSS/fonts. |
| Change message layout | `ConversationMessage.tsx`, `MessagePreviewDialog.tsx` | Raw view toggle and image rendering. |
| Change sidebar behavior | `SessionSidebar.tsx`, `App.tsx` state wiring | Sidebar mode/collapsed storage keys. |
| Change model selection | `useSidepanelModels.ts`, `SidepanelTopbar.tsx` | Default adapter and per-session adapter memory. |
| Change TTS | `useSidepanelTts.ts`, `usePageContext.ts` | Capability checks and read-aloud selection flow. |

## Validation

For normal sidepanel code changes:

```bash
pnpm --filter @surf-ai/extension typecheck
pnpm --filter @surf-ai/extension build
pnpm e2e:extension
```

For pure sidepanel docs:

```bash
git diff --check -- apps/extension/src/ui/sidepanel/README.md
```

The CDP smoke currently covers:

- Sidepanel standalone load.
- Session sidebar.
- Empty state.
- Send message.
- Streamed assistant answer.
- Message replay after reload.
- Process timeline replay.
- Approval request.
- Approval decision.
- Post-approval answer.
- Approval replay after reload.
- Dark theme persistence.

See:

- `docs/harness/phase-ui-7-extension-refactor-cdp-smoke.md`

## Tool Recipes For Agents

Use the README to choose the likely owner, then verify with tools.

Recommended Codegraph queries:

- For send flow: `codegraph_context` with `useSidepanelSend`.
- For run lifecycle: `codegraph_context` with `useSidepanelRuns`.
- For impact of a helper: `codegraph_impact` on the helper symbol.
- For page context flow: `codegraph_trace` from content/background message handling to `usePageContext` when available.

Recommended Serena workflow:

- Activate the project.
- Inspect only the target hook/component symbols first.
- Prefer symbol-level edits for whole hook/function changes.
- After editing, run TypeScript and the CDP smoke when behavior may be affected.

## Local Invariants

- Do not put new browser storage helpers in sidepanel components.
- Do not call bridge APIs directly from presentational components.
- Do not put React hooks in `sidepanel-helpers.ts`.
- Do not reduce existing E2E assertions during refactor.
- Keep raw message rendering independent from Markdown rendering.
- Keep Mermaid lazy-loaded.
- Preserve backend/local session fallback behavior unless the task explicitly changes it.
- Keep standalone page and Chrome sidepanel using the same sidepanel entry.
