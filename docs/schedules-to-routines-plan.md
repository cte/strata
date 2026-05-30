# Schedules → Routines Plan

Status: complete, landed 2026-05-30. Decision: [ADR-0002](adr/0002-collapse-schedules-into-routines.md). Glossary impact tracked in [CONTEXT.md](../CONTEXT.md). All seven slices are implemented; the whole workspace typechecks and `bun test` is green.

This plan collapses the **Schedule** concept into the **Routine** primitive. After it lands there is one automation concept (the Routine), one scheduling surface (a Routine's triggers), and one way to do scheduled prompts (a Routine).

## Target model

- A **Routine** is the single automation primitive: a definition (`prompt`, schemas, `toolProfile`, `requiredSkills`, `preRunSteps`, `publicationPolicy`) plus its own **`routine_triggers`**. It always runs the agent (`routine.run` → pre-run jobs → agent loop).
- The agent does ops two ways: **`preRunSteps`** (guaranteed, deterministic, before the agent) and the new **`job.run`** Tool (agent-discretion, `maintenance` profile, all registered jobs except `routine.run`).
- **`routine_triggers`** is the reshaped `job_schedules`: drop `job_name` (always `routine.run`), add a `routine_id` FK, keep the cadence + run-state columns. The scheduler loop is **repointed** at it, not rewritten. Many triggers per routine; `interval | cron` kinds only.
- **`agent.prompt`** is removed. `connector.pull`, `raw.index`, `wiki.search-index.refresh`, `wiki.hygiene`, `maintenance.run` survive as registered Jobs reachable only via `preRunSteps` / `job.run`.
- **Built-in Routine templates** (Granola sync, Slack sync, Index refresh, Wiki hygiene) instantiate into normal editable Routines. Infra templates do their real work in `preRunSteps`, run a `read-only` profile, and carry a one-line "data refreshed; no action needed" prompt.
- **Surface:** `/schedules` page, connector schedule cards, the connector-schedule-presets API, and `strata schedules` are deleted. Routines' Triggers section is the sole scheduling UI; CLI trigger management is `strata routines trigger …`.

## Structural facts (load-bearing)

- **Dependency direction:** `@strata/jobs` depends on `@strata/tools` + `@strata/agent`. So `@strata/tools` cannot import `runJob`. The `job.run` Tool is defined in **`@strata/routines`** (next to `outputTool.ts`) and injected per-run by the runner, routing execution through the existing `RunRoutineOptions.runPreRunJob` callback — the same callback `preRunSteps` already uses. `@strata/routines` keeps not depending on `@strata/jobs`.
- **Per-run tool injection** is established: `runner.ts` already builds `createDefaultToolRegistry({ profile })` and conditionally `tools.register(createRoutineOutputSubmitTool(...))`. `job.run` is registered the same way.
- **`job_schedules` columns** (`packages/core/src/schema.ts`): `id, name, job_name, input_json, trigger_json, enabled, created_at, updated_at, next_run_at, last_run_at, last_session_id, last_status, last_error, locked_at`; indexes on `(enabled,next_run_at)` and `(job_name)`. The scheduler's claim/lease (`locked_at`) + `markRun` next-run computation live in `packages/jobs/src/scheduleStore.ts` and `scheduler.ts`.

## Slices

### Slice 1 — `job.run` Tool

- Add `packages/routines/src/jobRunTool.ts`: `createJobRunTool({ runJob })` returning a `ToolDefinition` with `mode: "write"`, name `job.run`, input `{ jobName: string, input?: object }`.
- Handler: reject `jobName === "routine.run"` (recursion guard) and any unknown job with a structured error; otherwise call the injected `runJob` (the `runPreRunJob` callback) and return `{ jobName, status, summary, errorMessage }`. If no runner was injected (manual `runRoutine` with no `runPreRunJob`), return a structured "unavailable" error rather than throwing.
- `runner.ts`: register the tool whenever a runner is available, before `runAgentLoop` (it is `write`-mode, so a `read-only` routine won't see it — intended).
- Tests: recursion guard rejects `routine.run`; unknown job errors; a known job runs through the injected runner and the result is returned; absent runner → unavailable.

### Slice 2 — `routine_triggers` table + scheduler repoint

- `schema.ts`: add `routine_triggers` (`id, routine_id` FK→`routines.id` cascade, `name?, input_json, trigger_json, enabled, created_at, updated_at, next_run_at, last_run_at, last_session_id, last_status, last_error, locked_at`; indexes on `(enabled,next_run_at)` and `(routine_id)`). Add a migration that: creates the table; copies `job_schedules` rows with `job_name='routine.run'` (read `input_json.routineId`→`routine_id`, `input_json.input`→`input_json`, carry trigger/enabled/run-state); records the count of dropped non-routine rows; drops `job_schedules`.
- Replace `packages/jobs/src/scheduleStore.ts` with a `RoutineTriggerStore` (or repoint it): `claimDue`, `markRun`, CRUD against `routine_triggers`. Keep the lease/next-run logic verbatim, keyed on the new table.
- `scheduler.ts`: `runClaimedSchedule` runs `runJob({ jobName: "routine.run", input: { routineId, input } })` built from the trigger.
- Tests: migration converts a `routine.run` schedule + drops a `connector.pull` one; `claimDue` leasing + `markRun` next-run still hold on the new table; cascade delete removes a routine's triggers.

### Slice 3 — Trigger CRUD (store + API + CLI + UI repoint)

- `RoutineStore` (or a sibling): `listTriggers(routineId)`, `createTrigger`, `updateTrigger` (enable/disable/cadence), `deleteTrigger`, `runTriggerNow`.
- web-api: `routines.triggers.list|create|update|delete|runNow` tRPC procedures + services.
- CLI: `strata routines trigger add|list|remove|run <routineId>`.
- `apps/web` Routines Triggers section: repoint from `createSchedule`/`job_schedules` to the new trigger procedures; drop the `routine.run`-schedule shaping.
- Tests: web-api trigger procedures round-trip; CLI trigger commands.

### Slice 4 — Remove `agent.prompt`

- Delete the `agent.prompt` job definition + its tests/usages. Confirm nothing else references it.

### Slice 5 — Built-in Routine templates

- `packages/routines/src/builtins/` template definitions: `granola-sync`, `slack-sync`, `index-refresh`, `wiki-hygiene` (each: `preRunSteps` doing the real job, `read-only` profile, one-line prompt, `outputMode: none`).
- web-api: `routines.templates.list` + `routines.createFromTemplate`.
- `apps/web`: "New Routine → From template" entry that instantiates an editable Routine.
- Tests: each template instantiates into a valid Routine.

### Slice 6 — Delete the Schedules surface

- Remove `apps/web/src/routes/schedules.tsx` and its router wiring/nav; remove connector schedule cards (`connector-schedule-panel`) and the `connectors.schedules.*` presets API; remove `apps/web/src/lib/queries/schedules.ts` schedule-list/mutation hooks no longer used (keep `useSchedules` only if still consumed by `/index`).
- CLI: remove `strata schedules …`.
- Tests: typecheck/build; ensure `/index` (which reads `useSchedules`) still works or is repointed at triggers.

### Slice 7 — Docs reconciliation

- `routines-plan.md`: reverse the "schedule via `job_schedules`, no parallel scheduler" trigger decision; point at this plan + ADR-0002.
- `AGENTS.md`: update the `@strata/jobs` invariant ("recurring automation goes through jobs/schedules") to "recurring automation is a Routine with `routine_triggers`; deterministic Jobs are invoked via `preRunSteps`/`job.run`, not scheduled directly."
- `CONTEXT.md`: replace the `Schedule` entry's _Status_ note with the finished state (remove the term or mark removed); rewrite `Routine` to the single-primitive definition; add `Routine trigger`; update `Job` ("invoked by Routines, not Schedules") and the relationships list.
- `status.md`: record the change and set the next Resume Here.

## Order / dependencies

- **Slice 1 (`job.run`)** is fully additive and lands green on its own. **Done.**
- **Slices 2/3/4/6 are coupled and must land together** to keep the build green: `ScheduleStore`/`job_schedules` is consumed by web-api `jobServices` + the `schedules.*` tRPC procedures + `schedules.tsx`; `agent.prompt` is referenced by that page's agent-prompt scheduler. So reshaping the store (2), repointing the API/CLI/UI to triggers (3), removing `agent.prompt` (4), and deleting the Schedules surface (6) form one landing. Build it as: introduce `RoutineTriggerStore` + `routine_triggers` and repoint the scheduler (2); add `routines.triggers.*` + `strata routines trigger` + repoint the Routines Triggers UI (3); then in the same change delete the Schedules page/API/CLI/`agent.prompt` (4+6) and run the destructive migration. `useSchedules` (used by `/index`) must be repointed to a routines/triggers read or kept as a thin job-list query.
- **Slice 5 (templates)** depends only on Slice 1 and can land independently after it.
- **Slice 7 (docs)** last.
