# Strata Routines Plan

Status: planned on 2026-05-29.

This plan defines Strata's local-first version of routines. It is inspired by Anthropic Claude Code routines: saved autonomous agent configurations that can run on a schedule, through an API trigger, or from source events. Anthropic's current docs describe routines as research-preview cloud sessions built from a prompt, repositories, connectors, and triggers. Strata should adapt the useful product shape while keeping Strata local, trace-backed, schema-driven, and integrated with the existing `@strata/jobs`, agent loop, skills, connector workflows, and wiki/action system.

The first serious use case is a daily TODO routine over Granola meeting notes. That use case should validate the primitive without reintroducing a bespoke action-extraction pipeline.

## Product Goal

A Routine is a reusable, named automation that can run an agent session with explicit inputs, capabilities, preparation steps, required skills, and structured outputs.

Routines should answer:

- What automation exists?
- What triggers it?
- What can it read or write?
- What prompt and skills does it use?
- What structured input did this run receive?
- What structured output did it produce?
- Which Session trace explains the result?
- Did the infrastructure run complete, and did the task itself succeed?

The key design difference from the current `agent.prompt` schedule is that routines have a durable contract. A scheduled prompt is just text plus a tool profile. A Routine is text plus schema, capability policy, source preparation, artifacts, and publication rules.

## Core Concepts

### Routine

A saved local definition:

- `id`: stable local id, such as `routine_granola_daily_todos`.
- `name` and `description`.
- `status`: `enabled | disabled | archived`.
- `prompt`: self-contained agent instructions.
- `inputSchema`: JSON Schema for run input.
- `defaultInput`: optional default JSON input.
- `outputSchema`: JSON Schema for the required structured output.
- `outputMode`: `required | optional | none`.
- `toolProfile`: `read-only | maintenance | learning | dangerous`.
- `requiredSkills`: skill names the run should load or require the agent to read.
- `preRunSteps`: deterministic local Jobs to execute before the agent run, such as `connector.pull` or `raw.index`.
- `publicationPolicy`: what may be written automatically versus staged for review.
- `createdAt` / `updatedAt` / `version`.

Routines are local runtime configuration, not wiki pages. They should live in `.strata/state.sqlite` through a shared store, with import/export later if useful.

### Routine Trigger

> **Superseded by [ADR-0002](adr/0002-collapse-schedules-into-routines.md) / [schedules-to-routines-plan.md](schedules-to-routines-plan.md).** The original design below scheduled a Routine via a generic `job_schedules` row whose job was `routine.run`. That has landed in a reshaped form: the Schedule concept was removed and `job_schedules` became **`routine_triggers`** — a row with an FK to a Routine and no `jobName` (it always fires `routine.run`). The shared `@strata/jobs` scheduler is repointed at `routine_triggers` (it is not a parallel scheduler). Connector sync, index refresh, and prompt cadences are now Routines with triggers, not standalone schedules; `agent.prompt` was removed.

A way to start a Routine with input:

- `manual`: run now from CLI/web.
- `schedule`: persisted through the **`routine_triggers`** table (FK to the Routine); the scheduler fires `routine.run` for the bound Routine.
- `api`: local HTTP/tRPC trigger for other local tools.
- `source_event`: later, trigger when a connector writes new source documents.

Do not create a parallel scheduler. A Routine trigger is claimed by the existing `@strata/jobs` scheduler, which fires `routine.run` for the trigger's Routine.

### Routine Run

One execution of a Routine:

- Creates a trace-backed Job Session for `routine.run`.
- May create child Job Sessions for pre-run steps.
- Creates one agent Session for the prompt-driven part.
- Records routine lifecycle Events and links all child Session ids.
- Stores structured artifacts emitted by the run.

The infrastructure status is distinct from the task result. A run can complete without producing useful artifacts, and the UI must show that clearly.

### Routine Artifact

A schema-validated output object from a Routine Run.

Artifacts are generic. TODO candidates are one artifact type, not a special action-extraction store. Each artifact should record:

- `id`
- `routineId`
- `routineRunId`
- `schemaName` / `schemaVersion`
- `payload`
- `validationStatus`
- `taskStatus`: `succeeded | needs_review | failed | no_op`
- `dedupeKey`
- `sourceRefs`
- `createdAt`
- `sessionId`

Artifacts are the bridge between autonomous runs and review/publish surfaces. For action items, a routine artifact can later feed `/actions` review without making `/actions` depend on routine internals.

## Package Shape

Add a new first-party package:

```text
packages/routines/
  src/
    index.ts
    types.ts
    store.ts
    runner.ts
    outputTool.ts
    schemas.ts
    builtins/
      granolaDailyTodos.ts
```

Package responsibilities:

- Define Routine, RoutineRun, Trigger, and Artifact types.
- Persist routine definitions and artifacts.
- Validate input and output JSON against schemas.
- Build the agent prompt envelope.
- Register the `routine.output.submit` tool for routine agent runs.
- Execute pre-run Jobs through `@strata/jobs`.
- Start the shared agent loop through `@strata/agent`.
- Emit durable routine Events through `SessionStore`.

`@strata/jobs` should own only the `routine.run` JobDefinition wrapper. It should call `@strata/routines` rather than knowing routine internals.

`packages/web-api` should expose routine procedures through service modules, keeping SQLite/filesystem code out of `trpc.ts`.

`apps/web` should eventually gain a `/routines` route. The current scheduled agent prompt composer can be replaced or folded into this route.

## Storage

Use SQLite through `SessionStore` and add migration-backed tables:

```text
routines
  id text primary key
  name text not null
  description text not null
  status text not null
  prompt text not null
  input_schema_json text not null
  default_input_json text
  output_schema_json text
  output_mode text not null
  tool_profile text not null
  required_skills_json text not null
  pre_run_steps_json text not null
  publication_policy_json text not null
  version integer not null
  created_at text not null
  updated_at text not null

routine_runs
  id text primary key
  routine_id text not null
  routine_version integer not null
  input_json text not null
  status text not null
  task_status text
  job_session_id text
  agent_session_id text
  child_session_ids_json text not null
  output_artifact_ids_json text not null
  error text
  started_at text not null
  finished_at text

routine_artifacts
  id text primary key
  routine_run_id text not null
  routine_id text not null
  schema_name text not null
  schema_version text not null
  payload_json text not null
  validation_status text not null
  task_status text not null
  dedupe_key text
  source_refs_json text not null
  session_id text not null
  created_at text not null
```

Keep the schedule relationship in `job_schedules`. A scheduled routine is:

```json
{
  "jobName": "routine.run",
  "input": {
    "routineId": "routine_granola_daily_todos",
    "input": {
      "window": "today"
    }
  }
}
```

## Structured Input

Every run receives JSON input:

- Manual/web/API triggers provide explicit JSON.
- Schedule triggers provide fixed JSON plus small runtime variables later.
- `defaultInput` fills omitted optional values.

The runner validates the merged input before any pre-run step executes. Invalid input fails the Routine Run with a useful error and does not start the agent.

Do not start with a full templating language. If runtime variables are needed, add a small explicit set later:

- `now`
- `today`
- `yesterday`
- `lastSuccessfulRunAt`
- `scheduleId`

## Structured Output

The agent should not be asked to place important data only in final prose.

Routine runs should register a temporary tool:

```text
routine.output.submit
```

The tool input is the Routine's output object. The tool validates it against `outputSchema`, persists a Routine Artifact, and returns a structured result to the model. If `outputMode` is `required`, the runner marks the task as `needs_review` or `failed` when no valid output artifact was submitted.

This gives Strata:

- A stable test surface.
- A clean place to enforce schema validation.
- A trace-backed record of what the model claimed.
- A generic artifact store usable by TODOs, summaries, hygiene reports, or future workflows.

Final assistant text remains useful as a human summary but is not the source of truth for routine outputs.

## Capability Policy

Each Routine declares:

- Tool profile.
- Required skills.
- Optional pre-run Jobs.
- Publication policy.

Initial rules:

- `read-only` routines cannot publish artifacts into wiki pages directly.
- `maintenance` routines may create Proposals and routine artifacts.
- `learning` routines may use learning tools according to the existing profile rules.
- `dangerous` routines are allowed only through explicit creation/edit UI and should display stronger warnings.

Publication policy should be explicit:

```ts
type RoutinePublicationPolicy =
  | { mode: "artifact_only" }
  | { mode: "proposal"; proposalKind: "wiki" | "schema" | "skill" | "memory" }
  | { mode: "auto_publish"; target: string; minConfidence?: number };
```

The Granola TODO routine should start as `artifact_only` or `proposal`, not `auto_publish`.

## Agent Prompt Envelope

The runner should build a predictable prompt envelope:

1. Routine name, version, and objective.
2. Structured input JSON.
3. Output schema and instruction to call `routine.output.submit`.
4. Required skills and whether the agent must read them.
5. Publication policy.
6. The user's Routine prompt.

This envelope should be generated by `@strata/routines`, not duplicated in CLI/web/jobs code.

## Granola Daily TODO Routine

This is the first validation routine.

### Routine Definition

Name:

`Granola daily TODO discovery`

Trigger:

Hourly or every two hours during the workday. The schedule invokes `routine.run`.

Input schema:

```json
{
  "type": "object",
  "properties": {
    "date": { "type": "string", "description": "YYYY-MM-DD, defaults to today" },
    "lookbackHours": { "type": "number", "default": 24 },
    "maxMeetings": { "type": "number", "default": 20 },
    "source": { "type": "string", "enum": ["granola"], "default": "granola" }
  }
}
```

Pre-run steps:

1. `connector.pull` for Granola with a bounded lookback.
2. `raw.index` for Granola or connector pull with `index: true`.
3. Optional `wiki.search-index.refresh`.

Required skill:

`granola-todo-extraction`

Tool profile:

Start with `maintenance`, because it needs wiki/source reads and may create routine artifacts or proposals. It should not directly rewrite action ledgers in the first slice.

Output schema:

```json
{
  "type": "object",
  "required": ["date", "candidates"],
  "properties": {
    "date": { "type": "string" },
    "summary": { "type": "string" },
    "candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title", "owner", "sourceRefs", "confidence", "rationale", "dedupeKey"],
        "properties": {
          "title": { "type": "string" },
          "owner": { "type": "string", "enum": ["me", "others", "unknown"] },
          "counterparty": { "type": "string" },
          "dueDate": { "type": "string" },
          "reviewDate": { "type": "string" },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["path", "quote"],
              "properties": {
                "path": { "type": "string" },
                "lineStart": { "type": "number" },
                "lineEnd": { "type": "number" },
                "quote": { "type": "string" }
              }
            }
          },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "rationale": { "type": "string" },
          "dedupeKey": { "type": "string" },
          "suggestedLedger": { "type": "string", "enum": ["mine", "theirs", "unknown"] }
        }
      }
    }
  }
}
```

Publication policy:

Start with `artifact_only`. Later, add a review UI that can accept an artifact candidate into `wiki/actions/mine.md` or `wiki/actions/theirs.md` using `@strata/core/wiki-actions`.

### Skill Responsibilities

The `granola-todo-extraction` skill should teach the agent to:

- Prefer explicit commitments, requests, and agreed follow-ups.
- Ignore meeting logistics, status narration, and generic discussion.
- Distinguish what the user owes from what others owe the user.
- Preserve source evidence with a short quote.
- Mark uncertainty instead of inventing ownership.
- Use stable dedupe keys based on source path plus normalized title/owner.
- Avoid creating action items from vague intent unless a concrete next step exists.

The skill should not know how to write Markdown action ledgers. That belongs to the publication path.

## Web UX

Add `/routines` once the store and runner exist.

Initial views:

- Routine list: status, trigger summary, last run, last task status, latest artifact count.
- Routine detail: prompt, schemas, skills, pre-run steps, publication policy, triggers, run history.
- Run now dialog: JSON input editor with defaults and schema validation.
- Artifact panel: structured output, validation status, source refs, linked Session trace.
- Schedule controls: create/edit/pause schedule triggers by wrapping `job_schedules`.

The existing `/schedules` page should continue to show low-level schedules, but user-facing scheduled agent prompt workflows should migrate toward `/routines`.

## CLI UX

Add:

```bash
strata routines list
strata routines show <id>
strata routines create --file routine.json
strata routines update <id> --file routine.json
strata routines enable <id>
strata routines disable <id>
strata routines run <id> [--input-json JSON]
strata routines runs <id>
strata routines artifacts <id>
```

Keep `strata schedules ...` as the low-level schedule control. It should be possible to schedule a routine by creating a `routine.run` schedule.

## Implementation Slices

### Slice 1: Routine Types And Store

Status: complete.

- Add `packages/routines`.
- Add SQLite migrations for `routines`, `routine_runs`, and `routine_artifacts`.
- Implement CRUD/list/read helpers.
- Validate JSON object boundaries and enum fields.
- Export package subpaths.
- Tests: store round-trip, invalid definitions rejected, archived routines not runnable by default.

### Slice 2: `routine.run` Job

Status: complete.

- Add `routine.run` to `@strata/jobs`.
- Validate routine input against `inputSchema`.
- Execute `preRunSteps` through the job runner with child Session ids recorded.
- Start the shared agent loop with the prompt envelope.
- Record Routine Run status, child sessions, and agent session id.
- Tests: successful no-output routine, pre-run failure stops before agent, schedule input merges defaults.

### Slice 3: Structured Output Tool

Status: complete.

- Add temporary per-run `routine.output.submit`.
- Validate submitted output against `outputSchema`.
- Persist Routine Artifacts.
- Enforce `outputMode: required`.
- Tests: valid artifact stored, invalid output returns a structured tool error, missing required output marks task as `needs_review` or `failed`.

### Slice 4: CLI And Web API

Status: complete.

- Add CLI routine commands for list/show/run and definition import.
- Add tRPC procedures for routines list/get/run/runs/artifacts.
- Keep implementation in service modules.
- Tests: tRPC procedures return browser-safe DTOs and do not expose secrets.

### Slice 5: Web Routine UI

Status: complete.

- Added `/routines` as a master/detail route in `apps/web`.
- Routine list shows status, id, version, output mode, tool profile, latest task status, and artifact count.
- Routine detail shows description, prompt, input/output schemas, default input, required skills, pre-run jobs, publication policy, run history, and an expandable artifact list with payload, validation status, source refs, and session ids.
- Added a Run Now dialog that submits JSON input through the existing `routines.run` procedure, refreshes list/detail/runs/artifacts, and reports run status, task status, session ids, and artifact count.
- Added routine authoring in the browser: a New routine button and per-routine Edit/Enable-Disable/Delete controls, backed by new `routines.create`, `routines.update`, `routines.setStatus`, and `routines.delete` tRPC procedures and `routineServices` helpers. The editor is a tabbed structured form (name, id, prompt-first with guidance, description, status; tool profile, output mode, required skills; JSON input/output schema, default input, pre-run steps, publication policy) with inline per-field JSON validation; the store re-validates with the same rules as the CLI, so invalid definitions surface as errors instead of being persisted.
- Triggers are surfaced on the routine: a Triggers section lists the `routine.run` `job_schedules` bound to the routine (cadence, next/last run, status) with Run/Pause/Resume/Delete controls and a Schedule dialog (cadence presets or custom cron) that creates a `routine.run` schedule. The routine list shows a scheduled/paused indicator. `/schedules` remains the low-level view; routines now own their trigger UI.
- Capability blast radius is visible: the `dangerous` tool profile renders in red with an `AlertTriangle` and shows a caution callout on the detail page, in the editor, and in the Run Now dialog; `learning` is toned as a warning. (Plan commitment: "dangerous routines… should display stronger warnings.")
- Run history distinguishes infrastructure status from task outcome with a legend and per-badge tooltips, mirroring Anthropic's "green ≠ success" guidance.
- The empty list state explains what a routine is and offers New routine instead of a bare "none found" message.
- Agent/session ids link to the chat session trace where available.
- Routine SQLite/store access stays out of React: the route uses the typed `@/lib/api` helpers (`listRoutines`, `getRoutine`, `createRoutine`, `updateRoutine`, `setRoutineStatus`, `deleteRoutine`, `runRoutine`, `listRoutineRuns`, `listRoutineArtifacts`) plus the existing schedule helpers (`listSchedules`, `createSchedule`, `updateSchedule`, `runScheduleNow`, `deleteSchedule`) over the tRPC procedures.
- `/schedules` remains the low-level schedule control; scheduled routines are still `routine.run` schedules, now created and managed from the routine detail page as well.

### Slice 6: Granola TODO Routine And Skill

Status: next.

- Add a built-in or seedable Routine definition for Granola daily TODO discovery.
- Add `.agents/skills/granola-todo-extraction/SKILL.md` or a Strata-owned skill under `.strata/skills` if it should remain user-local.
- Run against recent local Granola snapshots.
- Store TODO candidates as routine artifacts only.
- Tests: fixture Granola notes produce precise candidates and ignore logistics/status chatter.

### Slice 7: Action Review And Write-Back

- Extend `/actions` to optionally show routine-produced TODO candidate artifacts.
- Accept candidate into `wiki/actions/mine.md` or `wiki/actions/theirs.md`.
- Preserve evidence/provenance in hidden action context metadata.
- Mark artifact as accepted/rejected/merged.
- Add write-back/provenance rules before any auto-publish mode.

### Slice 8: Trigger Expansion And Observability

- Add local API trigger tokens if needed.
- Add source-event triggers after connector events are rich enough.
- Add activity/routine filters so `/activity` can show routine runs and artifacts.
- Add stale/failed routine alerts to the overview/control plane.

## Acceptance Criteria

The routine foundation is useful when:

- A routine definition can be created, listed, edited, disabled, and run.
- A routine can be scheduled using the existing scheduler.
- A run validates structured input before doing work.
- A run can execute deterministic connector/index preparation steps.
- A run starts a normal shared-loop agent Session with configured tools and skills.
- A run can submit schema-valid structured output through `routine.output.submit`.
- The UI can distinguish infrastructure status from task status.
- Every run links to the Job Session, child Sessions, agent Session, and output artifacts.

The Granola TODO use case is useful when:

- It can run hourly from a schedule.
- It pulls/indexes recent Granola notes through shared connector jobs.
- It produces evidence-backed TODO candidates as artifacts.
- It avoids publishing directly into `wiki/actions/` until reviewed.
- Accepted candidates write through `@strata/core/wiki-actions` and keep provenance.
- Re-running over the same source does not create duplicates.

## Non-Goals

- Do not rebuild a source-specific action extractor outside routines.
- Do not make routines a second agent loop.
- Do not make schedules a second scheduler.
- Do not parse final prose as the source of truth for structured outputs.
- Do not let routine prompts silently bypass tool profiles, proposal review, or raw-source immutability.
- Do not require the browser to be open for scheduled routines.
