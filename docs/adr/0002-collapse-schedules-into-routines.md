---
status: accepted
date: 2026-05-30
---

# Collapse scheduling into the Routine primitive (remove Schedules)

## Context

Strata had two overlapping automation concepts. A **Schedule** binds any **Job** + JSON input to an interval/cron trigger; a **Routine** is a triggered agent workflow. A scheduled Routine was just a `job_schedules` row with `jobName = "routine.run"` — so `routines-plan.md` explicitly said *"schedule … persisted through the existing `job_schedules` table … Do not create a parallel scheduler."* In practice the user-facing **Schedules** surface (page + `strata schedules` CLI) exposed raw `jobName + cron` plumbing and overlapped confusingly with Routines, whose Triggers section does the same job better. A scheduled agent prompt (`agent.prompt`) and a Routine are the same idea.

The reviewer's intent is the most aggressive unification: **one automation primitive.** Everything triggered on a cadence is a Routine; "Schedule" disappears as a concept.

## Decision

**Make the Routine the single automation primitive and delete Schedules.**

- **Every automation is a Routine, and a Routine always runs the agent.** There is one execution path (`routine.run` → pre-run jobs → agent loop). Deterministic work is not a separate scheduled thing; the agent performs ops by calling tools.
- **A new constrained `job.run` tool** (`write` mode, `maintenance` profile) lets the agent trigger a *registered Job by name* — `job.run("connector.pull", …)` — instead of needing the `dangerous` shell. It exposes all registered jobs **except `routine.run`** (recursion guard); every call is an auditable `tool.call` Event.
- **`preRunSteps` stays** alongside `job.run`. `preRunSteps` = *guaranteed* deterministic data-prep before the agent reasons (e.g. Granola-TODO pulls + indexes first); `job.run` = ops the agent decides to do mid-run, and the mechanism for "press a button" infra Routines.
- **Triggers move onto the Routine.** `job_schedules` is reshaped into a new `routine_triggers` table: drop the redundant `jobName` (always `routine.run`), turn the loose `routineId` into a real `routine_id` FK, keep the cadence + run-state columns (`nextRunAt`, `lastRunAt`, lease, `lastStatus`). The battle-tested claim/lease/next-run scheduler logic is **repointed** at the new table, not rewritten. A Routine may have **many** triggers; trigger kinds are `interval | cron` only for now (API/source triggers remain unbuilt).
- **`agent.prompt` is removed** (a scheduled prompt is a Routine). `connector.pull`, `raw.index`, `wiki.search-index.refresh`, `wiki.hygiene`, and `maintenance.run` survive as registered Jobs, now reachable only via `preRunSteps`/`job.run`.
- **Built-in Routine templates** (Granola sync, Slack sync, Index refresh, Wiki hygiene) are instantiated via "New Routine → From template" into normal editable Routines, so the common infra automations are one click and nobody hand-authors a "pull Slack" prompt. An infra template does its real work in `preRunSteps` with a `read-only` profile and a one-line "data refreshed; no action needed" prompt, so the mandatory agent step is cheap and harmless.
- **Surface:** `/schedules` page, connector schedule cards, the connector-schedule-presets API, and `strata schedules` are deleted. The Routines page Triggers section becomes the sole scheduling UI; CLI trigger management is `strata routines trigger add|list|remove|run <id>` (triggers are run-state, not part of the version-bumped definition).
- **Migration:** existing `routine.run` schedules convert losslessly to `routine_triggers`; non-routine schedules are dropped with a one-time notice and re-created from templates (auto-fabricating Routines in a one-shot migration would bury product logic and yield uglier Routines than the templates).

## Considered options

- **Demote "Schedule" to an attribute (per-domain cadence) but keep `job_schedules` + the deterministic jobs schedulable directly.** Rejected by the reviewer in favor of full unification: one primitive, not "scheduling lives in three places."
- **Make the agent step optional so deterministic automations are agent-less Routines.** Rejected for B (always run the agent) on simplicity grounds — one execution path — knowingly accepting the costs below.
- **Keep `job_schedules` as a hidden routine-owned trigger store.** Rejected for the purist reshape into `routine_triggers`, accepting a schema migration to remove the table the user will never see.
- **Shell + CLI for agent-triggered jobs.** Rejected: it forces the `dangerous` profile (unrestricted shell) on recurring, unattended Routines fed by untrusted source content — a prompt-injection hazard. The constrained `job.run` tool gives the same capability with a far smaller blast radius.

## Consequences

- **Infra automation now depends on the model.** Because every Routine runs the agent (B), a cadence'd connector sync or index refresh fails if the model is unavailable/misbehaving — work that previously needed no model. This is an accepted trade for a single primitive; `preRunSteps` keeps *data-prep* deterministic even though *whether the automation fires usefully* is now probabilistic.
- This **reverses** `routines-plan.md`'s "schedule via `job_schedules`" decision and removes the **Schedule** glossary term; the scheduler loop is repointed, not duplicated, so the "no second scheduler" invariant still holds.
- `job.run` is a new standing capability (recursion-guarded, `maintenance`-profile, audited). Templates become the supported way to stand up infra automations.
