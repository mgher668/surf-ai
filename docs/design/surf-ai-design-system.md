# Surf AI Design System

Version: 0.1

## 1. Product UI Direction

Surf AI is a general-purpose AI agent runtime with a browser extension frontend. The UI should feel like a calm, premium agent cockpit: compact enough for sidepanel work, spacious enough for standalone use, and explicit about what the agent is doing.

The interface must optimize for:

- trust in agent actions
- readable long conversations
- visible tool approvals and process events
- fast switching between sessions
- clear bridge/runtime status
- bilingual Chinese/English use

It must not look like a generic AI chat template.

## 2. Atmosphere

- Density: medium. Sidepanel is compact; standalone gets more breathing room.
- Variance: restrained asymmetry. Avoid decorative chaos, but do not rely on generic centered cards.
- Motion: functional CSS motion only. Streaming, approvals, collapses, and status transitions may move; static content should stay calm.
- Material: layered surfaces, fine borders, subtle texture, no heavy glow.

Design keywords:

- agent cockpit
- quiet command center
- precise timeline
- premium productivity tool
- local-first control surface

## 3. Color Palette

Use one neutral family and one accent family. Do not mix random warm and cool grays.

### Light Theme

- Canvas Mist `#F4F7F5`: app background.
- Surface White `#FFFFFF`: primary panels and message cards.
- Surface Zinc `#EEF2EF`: secondary panels, inactive controls.
- Ink Charcoal `#18211F`: primary text.
- Muted Slate `#64706C`: secondary text and descriptions.
- Hairline Sage `#D9E2DD`: borders and dividers.
- Accent Teal `#0F766E`: primary action, active state, focus ring.
- Accent Teal Soft `#DDF3EE`: selected rows and subtle highlights.
- Danger Clay `#B24A43`: destructive actions and hard errors.
- Warning Ochre `#956515`: warnings and degraded states.

### Dark Theme

- Canvas Charcoal `#101715`: app background.
- Surface Charcoal `#17211F`: primary panels and message cards.
- Surface Graphite `#1E2A27`: secondary panels and controls.
- Ink Mist `#EEF5F1`: primary text.
- Muted Steel `#9AA8A2`: secondary text.
- Hairline Graphite `#2D3B37`: borders and dividers.
- Accent Teal `#4DB6A8`: primary action, active state, focus ring.
- Accent Teal Soft `#173A35`: selected rows and subtle highlights.
- Danger Coral `#E07A73`: destructive actions and hard errors.
- Warning Sand `#D4A84F`: warnings and degraded states.

Rules:

- No purple/blue AI neon gradients.
- No pure black `#000000`.
- No outer neon glow.
- Use accent only for action, active, focus, and status emphasis.
- Metadata should use muted colors, not accent colors.

## 4. Typography

Chrome extension UI must work offline and under extension CSP. Remote web fonts are not allowed by default.

Recommended CSS stacks:

```css
--font-sans: "Geist", "Satoshi", "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
--font-mono: "Geist Mono", "JetBrains Mono", "SFMono-Regular", "Cascadia Code", monospace;
```

Implementation rule:

- If local font files are added later, they must be packaged with the extension.
- Do not use remote Google Fonts or CDN fonts.
- Do not use Inter, Roboto, Arial, or default browser stacks as the intentional design identity.

Hierarchy:

- App title: 15-16px, 650 weight, tight tracking.
- Section title: 13-14px, 650 weight.
- Body: 13-14px, 450-500 weight, comfortable line-height.
- Metadata: 11-12px, mono, muted, tabular numbers.
- Code/tool names: mono, compact, high contrast.
- Long assistant answers: readable line-height, max width in standalone mode.

## 5. Layout

### Shared Shell

The sidepanel and standalone page share the same UI entry, but they should adapt by container width:

- Narrow sidepanel: compact sidebar, dense message timeline, sticky composer.
- Wide standalone: max-width content, calmer spacing, more visible session list, better message line length.

Rules:

- Use CSS Grid for shell layout.
- Use `min-height: 100dvh`, not `h-screen`, in new layout code.
- Avoid horizontal scroll.
- Maintain minimum 44px touch target for primary controls.
- Keep runtime status visible but not dominant.

### Sidebar

Sidebar should feel like a session switcher, not a generic nav drawer.

- Active session uses a subtle filled row and a left accent mark or status dot.
- Running/error states must be visible at row level.
- Session actions stay available but visually quiet.
- Connection status belongs at the bottom or header as a compact system block.

### Header

Header should be compact and informational:

- left: sidebar/menu controls
- center: current session title or app identity
- right: adapter/model/status, standalone/settings actions

Avoid large branding in the chat workspace.

### Composer

Composer should feel like a command console:

- clear model/adapter controls
- visible attachment/page-context state
- multiline input with strong focus ring
- primary send button with tactile active state
- stop/cancel state while running

The composer must not hide critical context flags such as attached page text.

## 6. Message Timeline

The timeline is the core product surface.

Message types:

- User message: compact, right or strong self-owned alignment, clear attachments/context chips.
- Assistant final answer: readable primary content block, Markdown-first.
- Commentary/process event: secondary but persistent execution log.
- Reasoning summary: collapsible and visually distinct from final answer.
- Tool approval: high-priority inline decision card.
- Tool result: collapsible output block with status.
- Runtime error: direct, recoverable error block with retry if supported.

Rules:

- Preserve chronological order.
- Do not place process events permanently below final answers if their timestamp is earlier.
- Do not collapse tool approval pending state by default.
- Successful approvals should remain visible but compact.
- Errors should include adapter/model/run status when available.
- Adapter and model metadata should be visible but low-noise.

## 7. Process And Tool UI

Tool execution is part of the product, not debug noise.

Tool approval card:

- tool server and tool name in mono
- plain-language request text
- decision buttons generated from server-provided options
- approved/denied/session-allowed state after decision
- timestamp and run identity available in details

Process event block:

- compact left rail or icon marker
- event type label
- short visible content
- optional details expander for raw content

Reasoning/commentary:

- append events, do not overwrite earlier entries
- render separate process items as separate paragraphs or rows
- long content should be collapsible

## 8. Settings UI

Settings is the control plane.

Sections:

- General: theme, language, default adapter.
- Connections: bridge baseURL, user identity, token.
- Models: adapter-specific model list and defaults.
- Runtime policy: approval mode and global/session permission behavior.
- Memory: confirmed/rejected/deleted memories.

Rules:

- Settings should use a two-column layout on wide windows and single-column on narrow windows.
- Forms must use label above input, helper text below when needed, error text below input.
- Model rows must support dense editing without feeling like a spreadsheet dump.
- Destructive actions require clear confirmation.

## 9. Components

### Buttons

- Rounded but not pill-shaped everywhere.
- Primary: accent fill, strong contrast.
- Secondary: neutral surface.
- Ghost: only for low-risk actions.
- Destructive: danger color, not just red text.
- Active state: `transform: translateY(1px)` or `scale(0.98)`.
- Focus ring: accent color, visible.

### Surfaces

- Major panels use layered surface and subtle border.
- Use shadow sparingly. Prefer hairline borders and contrast.
- No generic `shadow-md` look.
- Major containers may use double-bezel style only when it improves hierarchy.

### Badges

- Use badges for statuses, not decoration.
- Status badge colors:
  - running: accent
  - queued: muted
  - failed: danger
  - cancelled: muted
  - approval pending: warning

### Inputs

- Label above.
- Helper/error text below.
- Strong focus ring.
- No floating labels.
- Textarea resize behavior must not break sidepanel layout.

### Empty State

An empty conversation should guide the user:

- start a new question
- extract current page
- use selected text
- configure bridge if disconnected

Avoid plain "No data" messages.

## 10. Motion

Allowed:

- CSS transition for hover/active/focus.
- CSS keyframe pulse for running status.
- skeleton shimmer for loading.
- opacity/translate reveal for timeline insertions.
- smooth collapse/expand for details.

Avoid:

- Framer Motion or GSAP unless explicitly approved.
- continuous large backdrop blur.
- animation of width/height/top/left for frequent interactions.
- decorative motion that does not explain state.

Timing:

- UI hover: 120-180ms.
- panel/dialog transition: 180-260ms.
- timeline insertion: 180-240ms.
- collapse/expand: 160-220ms.

Easing:

```css
--ease-surf: cubic-bezier(0.22, 1, 0.36, 1);
```

## 11. Accessibility

- Every icon-only button needs `aria-label`.
- Focus-visible must be obvious.
- Color cannot be the only status indicator.
- Tool approval buttons must be keyboard reachable.
- Dialogs and sheets must preserve Radix accessibility behavior.
- Long process logs should not trap keyboard navigation.
- Message actions should not appear only on hover for keyboard users.

## 12. Implementation Rules

- Preserve React + Tailwind v3 + shadcn-style + Iconify offline.
- Do not introduce remote code, remote fonts, or remote icons.
- Do not add animation libraries for the first redesign pass.
- Move visual styles from inline objects to reusable classes/components gradually.
- Do not refactor data flow while changing visual styles.
- Keep sidepanel and standalone using the same component path.
- Maintain bilingual UI copy.

## 13. Anti-Patterns

Never ship:

- generic centered AI chat template
- purple/blue neon AI gradient
- default shadcn look with no Surf-specific tokens
- process events hidden as debug text
- tool approval UI that disappears after completion
- unreadable long Markdown line length
- remote fonts in extension runtime
- icon library mix without reason
- huge rewrite of `App.tsx` in one phase
- decorative motion that makes streaming/tool approvals harder to follow

## 14. Acceptance Criteria For UI Redesign

A redesign phase is acceptable only if:

- sidepanel still works in narrow width
- standalone page works in wider windows
- session list, message send, streaming, tool approval, and settings navigation still work
- messages and process events stay in chronological order
- tool approvals are visible before and after decision
- typecheck and build pass
- extension E2E passes
- no database, temp files, logs, or secrets are committed
