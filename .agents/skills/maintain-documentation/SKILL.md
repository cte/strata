---
name: maintain-documentation
description: Keep Strata roadmap, status, plan, onboarding, and handoff documentation aligned with code changes. Use this skill whenever a change affects the core roadmap path, milestone sequencing, package boundaries, runtime architecture, agent-loop behavior, tool architecture, connector architecture, web/TUI/CLI interface architecture, or any other load-bearing design decision; also use before finishing if docs/status no longer reflect what was implemented or what should happen next.
---

# Maintain Documentation

Use this skill to keep Strata's docs reliable as an agent handoff mechanism.

## 1. Classify The Change

Decide the smallest documentation scope that preserves the truth:

- Product or milestone sequencing changed: update `docs/roadmap.md`.
- Current implementation state changed: update `docs/status.md`.
- Next concrete task changed: update `docs/status.md` `## Resume Here`.
- Implementation direction changed inside an area: update that area's detailed plan.
- Future agents need different onboarding or invariants: update `AGENTS.md`.
- A new project concept or architecture summary is needed for fast onboarding: update `docs/app-overview.md`.

Prefer one source of truth. Do not duplicate long explanations across multiple docs. Link from top-level docs to detailed plans.

## 2. Read The Relevant Docs

Always inspect:

1. `AGENTS.md`
2. `docs/app-overview.md`
3. `docs/roadmap.md`
4. `docs/status.md`

Then inspect affected detailed plans as needed:

- Wiki/source structure: `docs/wiki-plan.md`
- Agent loop/tools/learning/maintenance: `docs/agent-harness-plan.md`
- TUI behavior: `docs/tui-plan.md`
- Browser chat: `docs/web-chat-plan.md`
- Connector web UI/control plane: `docs/web-control-plane-plan.md`
- Slack connector specifics: `docs/slack-connector.md`

Use code inspection to verify docs match reality before editing. Do not update docs from memory alone.

## 3. Update The Right Layer

Use this layering:

- `AGENTS.md`: durable instructions and invariants for all future agents.
- `docs/app-overview.md`: concise architecture/product onboarding.
- `docs/roadmap.md`: top-level product definition, system layers, sequencing, and plan map.
- `docs/status.md`: current implementation snapshot, roadmap status table, immediate milestone, and resume handoff.
- Detailed plans: implementation strategy, acceptance criteria, sequencing, and open design notes for a specific area.

Rules:

- If plans conflict, update `docs/roadmap.md` first, then reconcile `docs/status.md` and detailed plans.
- If implementation advances, update `docs/status.md` even when roadmap does not change.
- If only code internals changed without roadmap or handoff impact, no docs change is required.
- If unsure whether a change is load-bearing, update `docs/status.md` with a short note rather than leaving a stale handoff.

## 4. Preserve Handoff Quality

`docs/status.md` should let a fresh agent resume without conversation history.

Keep these sections useful:

- `## Current Snapshot`: one compact paragraph describing actual repo state.
- `## Roadmap Status`: table rows should distinguish present work from next work.
- `## Immediate Next Milestone`: active milestone, ordered by execution priority.
- `## Resume Here`: the first concrete implementation task with files/packages to inspect.

When completing a task, rewrite `## Resume Here` so it points to the next task, not the task just finished.

## 5. Validate

Before finishing:

- Run `rg -n "Cortex|cortex|TODO|planned but not implemented|Resume Here" AGENTS.md docs .agents/skills` when relevant to catch stale wording.
- Check markdown links when adding or renaming docs.
- Review the diff for duplicated or contradictory status claims.
- Report docs changed and any validation run in the final response.
