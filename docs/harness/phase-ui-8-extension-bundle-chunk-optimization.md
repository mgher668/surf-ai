# Phase UI-8 Plan: Extension Bundle Chunk Optimization

Status: READY
Date: 2026-05-31

## Goal

Reduce the current Vite large chunk warnings for the extension without changing product UI, message rendering semantics, storage contracts, bridge APIs, or the extension E2E behavior.

This phase is a packaging and loading optimization pass. The main target is the sidepanel entry chunk, which currently pulls in Markdown, math, and preview-related dependencies earlier than necessary. Mermaid-specific chunks may remain large because Mermaid itself is large; this plan separates real initial-load reduction from warning-threshold policy.

## Background

The production build currently succeeds but emits large chunk warnings. Vite/Rollup warns when a generated JavaScript chunk exceeds the default 500 KB minified threshold.

Observed large assets in `apps/extension/dist/assets`:

| Asset pattern | Approx size | Why it exists |
| --- | ---: | --- |
| `index.html-*.js` | 548 KB | Sidepanel entry imports the message rendering path and related UI/runtime code. |
| `mermaid.core-*.js` | 595 KB | `MarkdownMessage` dynamically imports `mermaid` for fenced `language-mermaid` blocks. |
| `wardley-*.js` | 505 KB | Mermaid sub-diagram implementation emitted as an async chunk. |
| `cytoscape.esm-*.js` | 433 KB | Mermaid graph dependency. |

Relevant source paths:

- `apps/extension/vite.config.ts`
- `apps/extension/src/ui/sidepanel/MarkdownMessage.tsx`
- `apps/extension/src/ui/sidepanel/components/ConversationMessage.tsx`
- `apps/extension/src/ui/sidepanel/components/MessagePreviewDialog.tsx`
- `apps/extension/src/ui/sidepanel/main.tsx`

Current build config has no manual chunk policy:

```ts
build: {
  outDir: "dist",
  emptyOutDir: true
}
```

Current `MarkdownMessage` imports these packages at module evaluation time:

- `react-markdown`
- `remark-gfm`
- `remark-math`
- `rehype-katex`
- `katex/dist/katex.min.css`

It also dynamically imports `mermaid` only when rendering a fenced Mermaid code block:

```ts
import("mermaid").then((module) => module.default)
```

The dynamic Mermaid import already prevents Mermaid from being part of the initial sidepanel entry, but Rollup still emits Mermaid async chunks and still applies the 500 KB warning to those async chunks.

## Decisions

- Keep the scope to bundle/loading optimization only.
- Do not change rendered Markdown, Mermaid, KaTeX, image preview, sidepanel storage, or bridge behavior.
- Do not remove Mermaid support in this phase.
- Do not add dependencies.
- Prefer reducing actual initial-load cost before changing `chunkSizeWarningLimit`.
- Treat a remaining Mermaid async chunk warning as a separate decision, not a failed refactor.

## Scope

### In Scope

- Lazy-load the sidepanel Markdown renderer from the message surfaces that need it.
- Keep raw-message rendering synchronous.
- Keep Mermaid support behind the existing dynamic import.
- Add a small Rollup `manualChunks` policy for predictable dependency grouping.
- Rebuild and compare chunk output before and after the change.
- Run extension typecheck, production build, and CDP smoke E2E.
- Record final validation and residual warnings in this document.

### Out of Scope

- No UI redesign.
- No copy changes.
- No Markdown feature changes.
- No Mermaid feature removal.
- No replacement of `react-markdown`, `katex`, or `mermaid`.
- No new bundler plugins.
- No visual regression infrastructure.
- No changes to popup/settings unless the build analysis proves they are directly involved.

## Expected Implementation Shape

### 1. Add A Lazy Markdown Boundary

Create a small wrapper component, for example:

- `apps/extension/src/ui/sidepanel/components/LazyMarkdownMessage.tsx`

Expected responsibilities:

- Use `React.lazy` to import `../MarkdownMessage`.
- Use `Suspense` around the lazy component.
- Keep the public prop shape identical to `MarkdownMessage`.
- Use a minimal fallback that does not introduce visible new UI states.

Recommended shape:

```tsx
import { lazy, Suspense } from "react";
import type { MarkdownMessageProps } from "../MarkdownMessage";

const MarkdownMessage = lazy(() =>
  import("../MarkdownMessage").then((module) => ({ default: module.MarkdownMessage }))
);

export function LazyMarkdownMessage(props: MarkdownMessageProps): JSX.Element {
  return (
    <Suspense fallback={<div className="surf-md" aria-busy="true" />}>
      <MarkdownMessage {...props} />
    </Suspense>
  );
}
```

Implementation notes:

- Export `MarkdownMessageProps` from `MarkdownMessage.tsx`.
- Keep `MarkdownMessage.tsx` otherwise behavior-identical.
- Keep `markdown-message.css` imported by `MarkdownMessage.tsx`, unless build output proves CSS movement is necessary.
- Do not move Mermaid rendering logic yet; it is already dynamically imported by content type.

### 2. Replace Direct Markdown Imports

Update message surfaces to import the lazy wrapper:

- `apps/extension/src/ui/sidepanel/components/ConversationMessage.tsx`
- `apps/extension/src/ui/sidepanel/components/MessagePreviewDialog.tsx`

Expected diff shape:

```ts
- import { MarkdownMessage } from "../MarkdownMessage";
+ import { LazyMarkdownMessage } from "./LazyMarkdownMessage";
```

Expected JSX shape:

```tsx
- <MarkdownMessage content={msg.content} />
+ <LazyMarkdownMessage content={msg.content} />
```

For `MessagePreviewDialog.tsx`, use the same wrapper for assistant formatted mode.

Do not wrap user messages or raw mode in lazy Markdown. Those paths do not need Markdown dependencies.

### 3. Add Predictable Manual Chunks

Update `apps/extension/vite.config.ts` with `rollupOptions.output.manualChunks`.

Recommended conservative config:

```ts
build: {
  outDir: "dist",
  emptyOutDir: true,
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (!id.includes("node_modules")) {
          return undefined;
        }

        if (
          id.includes("/mermaid/") ||
          id.includes("\\mermaid\\") ||
          id.includes("/@mermaid-js/") ||
          id.includes("\\@mermaid-js\\")
        ) {
          return "vendor-mermaid";
        }

        if (
          id.includes("/react-markdown/") ||
          id.includes("\\react-markdown\\") ||
          id.includes("/remark-") ||
          id.includes("\\remark-") ||
          id.includes("/rehype-") ||
          id.includes("\\rehype-") ||
          id.includes("/micromark") ||
          id.includes("\\micromark") ||
          id.includes("/mdast-") ||
          id.includes("\\mdast-") ||
          id.includes("/hast-") ||
          id.includes("\\hast-") ||
          id.includes("/unified/") ||
          id.includes("\\unified\\")
        ) {
          return "vendor-markdown";
        }

        if (id.includes("/katex/") || id.includes("\\katex\\")) {
          return "vendor-katex";
        }

        if (id.includes("/react-photo-view/") || id.includes("\\react-photo-view\\")) {
          return "vendor-photo-view";
        }

        return undefined;
      }
    }
  }
}
```

Implementation notes:

- The Windows path checks are included to keep the config cross-platform.
- Do not add a broad `vendor` chunk unless the build output shows it improves the sidepanel entry. A broad vendor chunk can create a different large chunk and make extension caching less clear.
- Keep chunk names descriptive so future build output is easier to interpret.

### 4. Do Not Immediately Raise The Warning Limit

Do not add `chunkSizeWarningLimit` in the first implementation pass.

Only consider adding it after measuring the result, and only if:

- The sidepanel entry chunk is materially smaller.
- The only remaining warnings are known async Mermaid chunks.
- The document records that the remaining warnings are accepted as a known Mermaid cost.

If needed, a later policy-only change may use:

```ts
chunkSizeWarningLimit: 800
```

But that should be documented as warning policy, not bundle reduction.

## Measurement Plan

### Baseline Capture

Before editing, run:

```bash
pnpm --filter @surf-ai/extension build
ls -lh apps/extension/dist/assets
```

Record:

- Largest sidepanel `index.html-*.js` size.
- Largest Mermaid-related chunk size.
- Whether Vite still reports large chunk warnings.
- Total asset directory size if useful.

### After Lazy Markdown

Run:

```bash
pnpm --filter @surf-ai/extension build
ls -lh apps/extension/dist/assets
```

Expected result:

- Sidepanel entry `index.html-*.js` should decrease because Markdown, remark, rehype, and KaTeX are no longer statically pulled into the entry.
- A Markdown-related async chunk may appear.
- Mermaid async chunks may still exceed 500 KB.

### After Manual Chunks

Run the same build and asset listing again.

Expected result:

- Chunk names should be easier to attribute, for example `vendor-markdown`, `vendor-katex`, `vendor-mermaid`, or similar.
- The sidepanel entry should stay smaller than baseline.
- Warnings may remain for Mermaid if a Mermaid chunk is still above 500 KB.

## Validation Plan

Run the standard extension verification sequence:

```bash
git diff --check -- apps/extension
pnpm --filter @surf-ai/extension typecheck
pnpm --filter @surf-ai/extension build
pnpm e2e:extension
```

Notes:

- `pnpm e2e:extension` launches Chromium/CDP and may require elevated execution in the current sandbox.
- Do not treat a Vite warning as a test failure unless the implementation goal explicitly requires zero warnings.
- If the E2E fails around message text visibility, inspect whether the lazy Markdown fallback or load timing changed the smoke assertion timing.

## Acceptance Criteria

This phase is complete when all of the following are true:

- `ConversationMessage.tsx` no longer statically imports `MarkdownMessage`.
- `MessagePreviewDialog.tsx` no longer statically imports `MarkdownMessage`.
- Markdown rendering remains available for assistant formatted messages.
- Raw view still bypasses Markdown rendering.
- Mermaid diagrams still render through the existing dynamic Mermaid path.
- The sidepanel entry chunk is smaller than the baseline 548 KB asset.
- Typecheck passes.
- Production build passes.
- Extension CDP smoke passes.
- Final residual warnings, if any, are recorded in this document.

## Residual Risk Policy

Acceptable residual risks:

- Mermaid async chunks may remain above 500 KB.
- First formatted assistant message may load a separate Markdown chunk.
- The first Mermaid diagram may still load Mermaid-specific chunks on demand.

Unacceptable regressions:

- Blank message body after formatted assistant messages load.
- Raw view stops working.
- Mermaid code block falls back for valid diagrams that previously rendered.
- KaTeX math rendering disappears.
- E2E smoke becomes timing-flaky due to lazy loading.
- Popup or settings chunks grow unexpectedly because of an overly broad manual chunk rule.

## Agent Execution Brief

This section is the handoff spec for an implementation agent.

### Primary Files

- Edit: `apps/extension/src/ui/sidepanel/MarkdownMessage.tsx`
- Add: `apps/extension/src/ui/sidepanel/components/LazyMarkdownMessage.tsx`
- Edit: `apps/extension/src/ui/sidepanel/components/ConversationMessage.tsx`
- Edit: `apps/extension/src/ui/sidepanel/components/MessagePreviewDialog.tsx`
- Edit: `apps/extension/vite.config.ts`
- Update after implementation: this document's `Validation Report` section.

### Do Not Edit

- Do not change `apps/extension/src/ui/sidepanel/App.tsx`.
- Do not change `apps/extension/src/ui/popup/App.tsx`.
- Do not change `apps/extension/src/ui/settings/App.tsx`.
- Do not change bridge APIs.
- Do not change shared contracts in `packages/shared`.
- Do not change storage keys.
- Do not add dependencies.
- Do not remove Mermaid, KaTeX, or Markdown support.

### Implementation Order

1. Capture baseline build output and asset sizes.
2. Export `MarkdownMessageProps` from `MarkdownMessage.tsx`.
3. Add `LazyMarkdownMessage.tsx`.
4. Replace direct `MarkdownMessage` imports in conversation and preview components.
5. Run typecheck.
6. Run build and compare chunk sizes.
7. Add manual chunk config in `vite.config.ts`.
8. Run typecheck and build again.
9. Run extension CDP smoke.
10. Update `Validation Report`.
11. Commit as one checkpoint if the diff is small and cohesive.

### Suggested Commit Message

```text
perf(extension): lazy load sidepanel markdown bundle
```

## Validation Report

Implementation completed 2026-06-01.

- Baseline build: `pnpm --filter @surf-ai/extension build` — success, 4 chunks >500 KB
- Baseline largest sidepanel entry: `index.html-DFCyfz7X.js` = **557 KB** (gzip: 170 KB)
- Baseline large warning chunks: mermaid.core (609 KB), wardley (517 KB), cytoscape.esm (442 KB), sidepanel entry (557 KB)
- Final build: `pnpm --filter @surf-ai/extension build` — success, 2 chunks >500 KB
- Final largest sidepanel entry: `index.html-LCkMpebl.js` = **108 KB** (gzip: 33 KB) ↓**81%**
- Final residual warning chunks: mermaid.core (610 KB, async), wardley (517 KB, async) — both are Mermaid async chunks, accepted per residual risk policy
- New lazy-loaded chunks: vendor-markdown (172 KB), vendor-katex (256 KB), vendor-photo-view (160 KB)
- `git diff --check -- apps/extension`: **PASS** (no whitespace errors)
- `pnpm --filter @surf-ai/extension typecheck`: **PASS** (no errors)
- `pnpm --filter @surf-ai/extension build`: **PASS** (warnings reduced from 4→2, remaining are async Mermaid)
- `pnpm e2e:extension`: **PASS** (`ok: true`, 1 session, 2 runs, 1 decision — all sidepanel/settings/popup tests passed)

## Final Status

COMPLETED.
