# Phase 0 Harness: Repositioning And Architecture Contract

Status: DONE
Date: 2026-05-20

## Goal

Reposition Surf AI documentation from "Chrome AI Web Assistant" to "general-purpose AI Agent Runtime with a browser extension as the first client" without changing code, database schema, or runtime behavior.

## Scope

- Update product positioning in `README.md`.
- Update planning baseline in `docs/PLAN.md`.
- Clarify API terminology in `docs/bridge-api.md`.
- Update long-lived agent rules in `AGENT.md` where old storage assumptions conflict with backend source-of-truth.
- Update operational/security docs when they contain old persistence or Codex execution assumptions.
- Preserve local-first, self-hosted, backend-source-of-truth, and browser-extension-client decisions.
- Keep Phase 0 documentation-only.

## Non-Goals

- No code changes.
- No API changes.
- No database schema changes.
- No UI changes.
- No memory implementation.
- No context engine implementation.
- No provider/runtime adapter changes.

## Subagent Plan

- Read-only analysis subagent: inspect docs and identify inconsistent positioning language.
- Risk review subagent: inspect docs for misleading scope, source-of-truth, security, and data-boundary risks.
- Test supplement subagent: not used in Phase 0 because this is documentation-only and no behavior changes.
- UI QA subagent: not used in Phase 0 because no UI behavior changes.

Main agent owns the actual documentation edits and final status.

Subagent summaries:

- Read-only analysis found stale Codex continuity docs that still referenced `codex exec resume`, stale `/chat` canonical-path wording, current-vs-planned terminology blur for tools/artifacts, old browser-storage persistence language in operational docs, and the need to close this harness before marking Phase 0 done.
- Risk review found scope-overclaim risk around "general-purpose runtime", source-of-truth contradictions between browser storage and backend SQLite, auth/security overclaim risk for tokenless local mode, current-vs-planned entity blur, prompt/data-boundary overclaim risk, and Phase 0 scope that was too narrow for authoritative docs.

## Implementation Plan

1. Update `README.md` title/description and current capabilities to present Surf AI as an Agent Runtime.
2. Update `docs/PLAN.md` to make the general runtime direction the current baseline rather than a later side note.
3. Update `docs/bridge-api.md` to describe the bridge API as the runtime API used by the extension and future clients.
4. Add a short terminology contract for runtime-owned entities.
5. Record validation and risk review in this harness file.
6. Update `AGENT.md`, `RUNBOOK.md`, `SECURITY_CHECKLIST.md`, and `docs/BACKEND_SESSION_MODE.md` where they conflict with the backend-source-of-truth and Codex App Server direction.

## Decision Log

- 2026-05-20: Phase 0 remains documentation-only.
- 2026-05-20: Browser extension remains the first client, not the product boundary.
- 2026-05-20: Hermes Agent is a formal architecture input by concept only; no dependency or code copying.
- 2026-05-20: Subagent use is limited to read-only analysis and risk review for this phase.
- 2026-05-20: Phase 0 scope expanded to include long-lived agent, runbook, security, and backend session docs because read-only/risk review found authoritative stale assumptions there.
- 2026-05-20: `/sessions/:id/runs` is documented as the canonical Codex App Server runtime execution path; `/chat` remains a compatibility endpoint.
- 2026-05-20: Documentation distinguishes currently implemented runtime entities from target vocabulary such as generic tools, artifacts, and future clients.

## Validation Plan

- Check updated docs for terminology consistency.
- Verify no implementation files are intentionally modified by Phase 0.
- Verify the docs still describe current local-first behavior accurately.
- No typecheck/build required unless implementation files change.

## Validation Report

Completed:

- Updated `README.md` to describe Surf AI as a local-first AI Agent Runtime with the Chrome extension as the shipped first client.
- Updated `docs/PLAN.md` to make runtime ownership, current entities, target vocabulary, canonical Codex App Server run path, and harness execution rules explicit.
- Updated `docs/bridge-api.md` to describe the bridge as runtime API, clarify tokenless local mode vs secured deployments, and mark `/chat` as compatibility.
- Updated `AGENT.md` to make backend SQLite the source of truth and browser storage cache/settings only.
- Updated `docs/BACKEND_SESSION_MODE.md` to replace stale Codex CLI resume wording with App Server/thread continuity wording.
- Updated `RUNBOOK.md` and `SECURITY_CHECKLIST.md` to remove old IndexedDB-as-source and Codex CLI resume assumptions.
- Updated `docs/AGENT_RUNTIME_EVOLUTION_PLAN.md` Phase 0 scope to reflect the actual authoritative docs touched.
- Ran documentation consistency searches for stale `codex exec resume`, browser-storage persistence, `/chat` canonical wording, and old product positioning.

Not run:

- `pnpm typecheck`, `pnpm build`, and UI QA were not run because Phase 0 is documentation-only and intentionally changed no runtime behavior.

## Risk Review

Resolved:

- Avoided overclaiming that non-extension clients already exist by wording Surf as "evolving into" a runtime and stating the Chrome extension is the shipped client.
- Split current runtime-owned entities from future target vocabulary so `tool`, `artifact`, and future `client` concepts are not presented as fully implemented.
- Clarified that default local self-use can be tokenless, while exposed or multi-user deployments require tokens, strict CORS, HTTPS, and trusted network placement.
- Clarified that bridge SQLite is the source of truth and extension storage is cache/settings only.
- Clarified Codex App Server as canonical runtime path while preserving `/chat` as compatibility.

Remaining concerns:

- Some older historical progress notes still mention the earlier phase dates and implementation sequence. They are retained as history, not current execution instructions.
- `docs/HERMES_AGENT_ARCHITECTURE.md` is referenced as architecture input but remains a separate untracked document in the current worktree.
- `apps/bridge/src/runtimes/codex-app-server-runtime.ts` is modified in the worktree but was not touched by Phase 0; it should be treated as unrelated pre-existing code change.

## Final Status

DONE
