# Phase UI-7 Harness Plan: Extension Refactor CDP Smoke

Status: DONE
Date: 2026-05-31

## Goal

Expand the existing extension CDP harness before the extension UI refactor so that structural changes to popup, settings, and sidepanel can be validated quickly without changing UI or behavior.

The first phase is smoke-level coverage only. The purpose is to catch broken imports, blank pages, storage/theme synchronization regressions, route/hash regressions, and obvious Chrome extension API wiring issues before and during refactoring.

## Decisions

- Keep this phase limited to structure-preserving refactor safety.
- Do not change product UI, interaction semantics, API contracts, storage keys, or visual design.
- Reuse the current CDP-based harness in `apps/extension/e2e/standalone-smoke.mjs`.
- Do not introduce Playwright, Vitest, React Testing Library, or new browser automation dependencies in this phase.
- Keep the current sidepanel standalone smoke as the primary high-value behavior path.
- Add smoke coverage for settings and popup, not full settings CRUD coverage.

## Current Harness Baseline

The current extension E2E harness:

- Builds against the real MV3 extension output in `apps/extension/dist`.
- Launches Chromium with a temporary user data directory.
- Discovers the loaded unpacked extension ID.
- Opens the sidepanel standalone route at `chrome-extension://<id>/src/ui/sidepanel/index.html`.
- Starts an in-process fake bridge server.
- Seeds `chrome.storage.local` with deterministic connection, locale, adapter, theme, and sidebar preferences.
- Exercises sidepanel load, message send, streamed answer, reload replay, approval request, approval decision, post-approval continuation, approval replay, and dark theme persistence.
- Captures a failure screenshot on assertion failure.

This is already a real extension harness, not a Vite-only React page test. It should remain the core safety net.

## Scope

### In Scope

- Extend `apps/extension/e2e/standalone-smoke.mjs` with additional smoke scenarios.
- Add reusable harness helpers only where needed to avoid fragile duplication.
- Cover settings page smoke at `src/ui/settings/index.html`.
- Cover popup page smoke at `src/ui/popup/index.html`.
- Preserve the existing sidepanel smoke path.
- Add or reuse deterministic fake bridge responses for settings smoke where needed.
- Update harness documentation after implementation.

### Out of Scope

- No full settings CRUD automation.
- No real Chrome side panel surface automation.
- No visual regression screenshot approval system.
- No dependency additions unless a later phase explicitly chooses them.
- No bridge runtime API changes.
- No shared contract changes.
- No changes to extension UI behavior or visual design.

## Smoke Coverage Matrix

| Surface | Setup | Smoke Assertions | Explicitly Not Covered |
| --- | --- | --- | --- |
| Sidepanel standalone | Open `src/ui/sidepanel/index.html` with seeded storage and fake bridge | Existing assertions continue to pass: page load, sessions, empty state, send message, stream answer, reload replay, approval, theme persistence | Uploads, TTS, cancel, rename, delete, star, real sidepanel shell |
| Settings page | Open `src/ui/settings/index.html` with seeded storage and fake bridge | Page renders, expected settings sections are present, default section resolves, hash/section switching works, active connection from storage is visible, theme class responds to storage | Add/edit/delete connection, save model edits, confirm/reject/delete memories, error-state matrix |
| Popup page | Open `src/ui/popup/index.html` as an extension page | Page renders, command buttons are present, standalone/settings buttons target the expected extension URLs where feasible, dark theme storage does not break layout/rendering | Real browser action popup compositor behavior, real side panel shell opening reliability |
| Shared storage/theme | Seed `chrome.storage.local` and reload pages | Locale/theme/sidebar/connection seeds do not crash affected entrypoints; `document.documentElement.classList` reflects dark theme where expected | Full cross-tab storage event race testing |

## Implementation Plan

1. Record a baseline run with the existing command sequence:
   - `pnpm --filter @surf-ai/extension typecheck`
   - `pnpm --filter @surf-ai/extension build`
   - `pnpm e2e:extension`
2. Split the current E2E flow into named scenario functions only if it makes the new smoke paths easier to read:
   - `runSidepanelSmoke`
   - `runSettingsSmoke`
   - `runPopupSmoke`
3. Keep the current fake bridge fixture as the single deterministic backend source for all scenarios.
4. Ensure the fake bridge has minimal responses needed by settings smoke:
   - `/health`
   - `/capabilities`
   - `/models`
   - `/memories?limit=100`
5. Add a settings smoke scenario:
   - Open the settings extension URL.
   - Seed storage with one enabled bridge connection, active connection ID, locale, default adapter, sidebar mode, and theme.
   - Reload after storage seed.
   - Assert the settings page title and known section labels are present.
   - Switch sections through hash updates or UI clicks.
   - Assert the page does not lose the active connection or section content after reload.
   - Assert dark theme class is applied after setting `surf.theme=dark`.
6. Add a popup smoke scenario:
   - Open the popup extension URL as a normal extension page.
   - Seed locale/theme storage.
   - Assert popup title and primary commands are present.
   - Click or evaluate standalone/settings actions only when target tracking is reliable.
   - Verify created tab targets point to `src/ui/sidepanel/index.html` and `src/ui/settings/index.html` where feasible.
   - Treat real `chrome.sidePanel.open` shell behavior as out of scope for this phase.
7. Improve failure diagnostics if needed:
   - Include scenario name in step labels.
   - Capture screenshots with the active scenario and step name.
   - Include body text snapshot on assertion failures when cheap.
8. Keep assertions stable:
   - Prefer deterministic English locale for text assertions.
   - Prefer route/hash/theme/storage invariants over fragile styling details.
   - Avoid asserting exact layout dimensions unless required for a known popup regression.
9. Run validation:
   - `pnpm --filter @surf-ai/extension typecheck`
   - `pnpm --filter @surf-ai/extension build`
   - `pnpm e2e:extension`
   - Optional visual debug: `SURF_AI_E2E_HEADLESS=0 SURF_AI_E2E_STEP_DELAY_MS=1000 pnpm e2e:extension`
10. Document final coverage and residual risks in this file after implementation.

## Agent Execution Brief

This section is the concrete handoff spec for an implementation agent.

### Primary File

- Edit: `apps/extension/e2e/standalone-smoke.mjs`
- Update after implementation: this document's `Validation Report` section.

### Do Not Edit

- Do not change `apps/extension/src/ui/popup/App.tsx`.
- Do not change `apps/extension/src/ui/settings/App.tsx`.
- Do not change `apps/extension/src/ui/sidepanel/App.tsx`.
- Do not change shared contracts in `packages/shared`.
- Do not change bridge runtime behavior in `apps/bridge`.
- Do not add dependencies.
- Do not add Playwright, Vitest, Jest, Testing Library, jsdom, or happy-dom.
- Do not add full settings CRUD coverage in this phase.

### Expected Diff Shape

- Keep the existing sidepanel assertions semantically unchanged.
- Refactor harness code only as much as needed to add scenarios cleanly.
- Prefer named scenario functions:
  - `runSidepanelSmoke`
  - `runSettingsSmoke`
  - `runPopupSmoke`
- Prefer small harness helpers over duplicated CDP snippets:
  - `openExtensionPage`
  - `waitForTargetUrl`
  - `waitForBodyText`
  - `waitForDarkTheme`
  - `setLocationHash`
- Keep the fake bridge in the same script for this phase.

### Scenario Order

Run all scenarios in one Chromium launch and one fixture server session:

1. Launch Chromium with the built extension.
2. Discover the extension ID.
3. Run sidepanel smoke first to preserve the current primary path.
4. Run settings smoke.
5. Run popup smoke.
6. Verify fixture summary still includes the existing sidepanel expectations.
7. Clean up CDP clients, Chromium, fixture server, and temporary user data directory.

If target isolation becomes flaky, opening a fresh extension page per scenario is preferred over reusing the same target.

## Concrete Smoke Assertions

Use deterministic `en-US` locale for text assertions unless a scenario explicitly checks locale switching.

### Shared Setup Assertions

- Seed storage with:
  - `surf.connections`: one enabled connection named `E2E Bridge`
  - `surf.activeConnectionId`: `e2e-local`
  - `surf.locale`: `en-US`
  - `surf.defaultAdapter`: `mock`
  - `surf.theme`: `light` or `dark`, depending on the scenario
  - `surf.sidebarMode`: `docked`
  - `surf.sidebarCollapsed`: `false`
- Reload after storage seed.
- Assert no page-level blank state by checking `document.body.innerText.trim().length > 0`.

### Sidepanel Smoke

Preserve the current sidepanel checks:

- Open `chrome-extension://<id>/src/ui/sidepanel/index.html`.
- Assert body text includes `Surf AI`.
- Assert body text includes `Sessions`.
- Assert body text includes `No messages yet`.
- Type `Phase 6B fixture smoke`.
- Click `Send`.
- Assert body text includes `Fixture answer`.
- Assert at least two `[data-message-id]` elements exist.
- Reload.
- Assert body text includes `Fixture answer`.
- Assert body text includes `Intermediate Commentary`.
- Send `please request approval`.
- Assert body text includes `Fixture approval`.
- Click `Allow once`.
- Assert body text includes `Approved`.
- Assert body text includes `Approved fixture answer`.
- Reload.
- Assert approval card and approved answer replay.
- Set `surf.theme` to `dark`, reload, and assert `document.documentElement.classList.contains("dark")`.

### Settings Smoke

Add a settings scenario with these exact target behaviors:

- Open `chrome-extension://<id>/src/ui/settings/index.html`.
- Configure extension storage using the same fixture base URL.
- Reload.
- Assert body text includes `Settings`.
- Assert body text includes `Manage connections, default adapter, theme, and UI language.`
- Assert body text includes `General`.
- Assert body text includes `Connections`.
- Assert body text includes `Models`.
- Assert body text includes `Memory`.
- Assert `window.location.hash` becomes `#general` after the default section effect settles.
- Switch to `#connections` by setting `window.location.hash = "#connections"` or clicking the nav item.
- Assert body text includes `Current Connection`.
- Assert body text includes `E2E Bridge`.
- Switch to `#models`.
- Assert body text includes `Models`.
- Assert at least one model input contains `codex-fixture` or `Codex Fixture`.
- Switch to `#memories`.
- Assert body text includes `Memory`.
- Assert body text includes `No memories yet` when the fake bridge returns an empty memory list.
- Set `surf.theme` to `dark`, reload, and assert `document.documentElement.classList.contains("dark")`.

Do not submit forms, save models, or invoke memory confirm/reject/delete actions in this phase.

### Popup Smoke

Add a popup scenario with these exact target behaviors:

- Open `chrome-extension://<id>/src/ui/popup/index.html` as a normal extension page.
- Configure extension storage with `surf.locale=en-US` and `surf.theme=dark`.
- Reload.
- Assert body text includes `Surf AI`.
- Assert body text includes `Open Side Panel`.
- Assert body text includes `Open Standalone`.
- Assert body text includes `Open Settings`.
- Assert `document.documentElement.classList.contains("dark")`.
- Click `Open Standalone` if target tracking is reliable.
- Assert a Chrome target appears whose URL ends with `/src/ui/sidepanel/index.html`.
- Click `Open Settings` if target tracking is reliable.
- Assert a Chrome target appears whose URL ends with `/src/ui/settings/index.html`.

Do not require the `Open Side Panel` button to open the real Chrome side panel shell. The real side panel surface remains out of scope.

## Harness Helper Guidance

Reuse existing helpers where possible:

- `configureExtensionStorage`
- `setChromeStorage`
- `typeComposer`
- `clickButtonByText`
- `waitFor`
- `openTarget`
- `waitForPageLoad`
- `waitForExtensionId`
- `waitForCdp`
- `captureFailureScreenshot`

Add only the helpers needed to make settings and popup smoke clear:

- `openExtensionPage(cdpPort, extensionId, relativePath)`
  - Builds `chrome-extension://<id>/<relativePath>` and delegates to `openTarget`.
- `waitForBodyText(client, text, label)`
  - Wraps `waitFor(client, () => document.body.innerText.includes(text), label)`.
- `waitForDarkTheme(client)`
  - Wraps `waitFor(client, () => document.documentElement.classList.contains("dark"), "dark theme")`.
- `setLocationHash(client, hash)`
  - Uses `Runtime.evaluate` to assign `window.location.hash`.
- `waitForTargetUrl(cdpPort, predicate, label, timeoutMs = 5000)`
  - Polls Chrome's `/json` targets and resolves when a target URL matches.

Keep helper names descriptive. Avoid introducing a broad test framework abstraction.

## Minimal Fixture Requirements

The fake bridge already has most required endpoints. Ensure the following read-only endpoints exist for smoke:

- `GET /health`
  - Returns `{ ok: true, version: "e2e-fixture", adapters: ["mock"], now: "<iso>" }`.
- `GET /capabilities`
  - Returns a mock-enabled chat capability and the existing tool list.
- `GET /models`
  - Returns at least one default-visible `codex` model and one `mock` model:
    - `{ id: "codex-fixture", label: "Codex Fixture", adapter: "codex", enabled: true, isDefault: true }`
    - `{ id: "mock-fixture", label: "Mock Fixture Model", adapter: "mock", enabled: true, isDefault: true }`
- `GET /memories`
  - Returns `{ memories: [] }`.

Do not add write endpoints for settings smoke unless the UI performs unavoidable reads that require them. Full model save and memory action flows are out of scope.

## Implementation Checklist

[x] Run the baseline validation commands and note any pre-existing failures before editing.
[x] Add scenario functions without reducing current sidepanel assertions.
[x] Add `openExtensionPage`, `waitForBodyText`, `waitForDarkTheme`, `setLocationHash`, and `waitForTargetUrl` only if needed.
[x] Add `GET /memories` to the fake bridge fixture if missing.
[x] Add settings smoke with the exact assertions listed above.
[x] Add popup smoke with the exact assertions listed above.
[x] Ensure failure screenshots include the active scenario or step label.
[x] Run extension typecheck.
[x] Run extension build.
[x] Run `pnpm e2e:extension`.
[x] Update the `Validation Report` section below with command results and residual risk notes.

## Acceptance Criteria

- Existing sidepanel smoke still passes without reduced coverage.
- Settings smoke passes in headless Chromium using only fake bridge data.
- Popup smoke passes in headless Chromium without requiring the real browser action popup surface.
- The harness remains deterministic and does not require real bridge credentials, local SQLite data, Codex, Claude, OpenAI, or MiniMax configuration.
- Failures identify the scenario and step that failed.
- The final validation report records exact commands run and outcomes.

## Risk Review

- Popup opened as `chrome-extension://.../src/ui/popup/index.html` is not identical to Chrome's real browser action popup surface. This catches React/storage/route regressions, not compositor sizing issues.
- Settings smoke intentionally does not prove full connection/model/memory CRUD. It only proves that the page loads, sections resolve, seeded state is visible, and basic fixture-backed reads do not break.
- Text-based assertions can become brittle if locale defaults or copy change. Use a deterministic locale seed and prefer stable structural assertions where practical.
- CDP target discovery can be flaky if multiple extension pages open at once. Scenario steps should close or isolate opened targets when possible.
- Keeping all harness code in one script may eventually become hard to maintain. This phase should only extract helpers when doing so lowers immediate duplication.
- Fake bridge fixtures can hide real backend integration bugs. This is acceptable for refactor safety because the goal is UI structure preservation, not runtime quality validation.

## Follow-Up Phases

- Add targeted pure logic tests for extracted helpers after the refactor creates testable boundaries.
- Add full settings interaction coverage only if settings behavior changes or starts regressing.
- Consider Playwright or component testing only if CDP harness maintenance cost becomes higher than dependency cost.
- Consider real sidepanel automation in a later browser QA phase if Chrome side panel shell behavior becomes a product risk.

## Validation Report

Status: PASS

Commands:

- `node --check apps/extension/e2e/standalone-smoke.mjs`: PASS
- `pnpm --filter @surf-ai/extension typecheck`: PASS
- `pnpm --filter @surf-ai/extension build`: PASS
  - Existing large chunk warnings remain from Mermaid/KaTeX-related bundles.
- `pnpm e2e:extension`: PASS
  - Plain sandboxed run initially failed with `listen EPERM: operation not permitted 127.0.0.1`.
  - Re-run with local loopback/Chromium permission passed.
  - Fixture summary: `sessions=1`, `runs=2`, `decisions=1`.

Coverage added:

- Settings smoke: PASS
  - Opens `src/ui/settings/index.html`.
  - Seeds deterministic extension storage.
  - Verifies settings title, description, section nav labels, default `#general` hash, active connection, models section, fixture model input value, memories empty state, and dark theme persistence.
- Popup smoke: PASS
  - Opens `src/ui/popup/index.html`.
  - Seeds deterministic extension storage.
  - Verifies popup title, command labels, dark theme persistence, standalone target URL, and settings target URL.
- Sidepanel smoke preserved: PASS
  - Existing page load, session sidebar, message send, stream answer, reload replay, approval flow, approval replay, and theme persistence assertions still pass.

Residual risks:

- Real Chrome side panel shell remains out of scope.
- Full settings CRUD remains out of scope.
- Popup browser action compositor behavior remains out of scope.
