# Strata

Strata is a local agent that helps the user remember, understand, and maintain their work context by operating on a Markdown wiki with safe tools and durable learning loops. This glossary defines the load-bearing terms used across the codebase, AGENTS.md, and the plan documents under `docs/`.

## Language

### Sessions and runs

**Session**:
The durable conversation/task record persisted in `.strata/state.sqlite`, identified by `sessionId`, with a `kind` and a `status`. Survives across many runs.
_Avoid_: thread, conversation, "chat" when meaning the persistent record.

**Run**:
One invocation of `runAgentLoopEvents()` against a Session — a single forward iteration of the model/tool loop, identified by `runId`. A Session contains many Runs over time as the user continues it.
_Avoid_: turn, iteration, execution.

**Web chat run**:
The server-side job persisted in `ChatRunStore` (`packages/web-api/src/chatRunStore.ts`) that wraps a Run on behalf of a browser SSE client, allowing reconnect and event replay independent of the browser request lifetime.
_Avoid_: "stream" or "request" when meaning the persisted job record.

**Job**:
A registered local operation that Strata can run outside the model loop, such as `connector.pull`, `raw.index`, `wiki.search-index.refresh`, `wiki.hygiene`, `maintenance.run`, or the orchestrating `routine.run`. Jobs live behind the `@strata/jobs` registry/runner interface, persist an enclosing `kind = "job"` Session, and may call lower-level connector, raw-to-wiki, search-index, or maintenance modules that create their own domain-specific Sessions. Deterministic Jobs are invoked **by Routines** — guaranteed via `preRunSteps` or at agent discretion via the `job.run` Tool — not scheduled directly.
_Avoid_: cron task, background command, automation when meaning the registered operation.

**Schedule** _(removed)_:
Formerly a persisted record binding any Job to an interval/cron trigger. Removed per [ADR-0002](docs/adr/0002-collapse-schedules-into-routines.md): the `job_schedules` table was reshaped into `routine_triggers`, the `agent.prompt` Job and `/schedules` surface were deleted, and the only thing put on a timer is now a **Routine** via its **Routine triggers**. Use "Routine trigger," not "Schedule."

**Routine**:
The single local automation primitive: a reusable definition that runs an agent workflow with structured input, structured output, a prompt, required Skills, a Tool Profile, optional pre-run Jobs, its own Routine triggers, and a publication policy. A Routine always runs the agent (`routine.run` → pre-run Jobs → agent loop); the agent does deterministic ops by calling Jobs via the `preRunSteps` field (guaranteed, before the agent) and the `job.run` Tool (agent discretion). A Routine can be triggered manually, by a Routine trigger, by API, or later by source events.
_Avoid_: scheduled prompt, extraction pipeline when meaning the durable Routine definition. (A Routine *is* the unit of automation, so "automation" is no longer a term to avoid here.)

**Routine trigger**:
A persisted `.strata/state.sqlite` record in `routine_triggers` (FK to a Routine, no `jobName`) that binds JSON input plus an interval or cron cadence to a Routine. The scheduler worker claims due triggers and fires `routine.run` for the bound Routine, so results are trace-backed. Triggers are local-only and enabled/disabled independently of the Routine. Many triggers may target one Routine.
_Avoid_: crontab entry, Schedule when meaning Strata's first-party recurring-trigger record.

**Routine run**:
One execution of a Routine. A Routine run is trace-backed, creates or links a `routine.run` Job Session, may create child Job Sessions for pre-run work, starts one shared-loop agent Session for the model/tool part, and records structured artifacts. Its infrastructure status is distinct from the task status.
_Avoid_: run when the distinction from an agent Run or Job Session matters.

**Routine artifact**:
A schema-validated structured output produced by a Routine run, persisted with provenance, source refs, validation status, task status, dedupe key, and linked Session ids. TODO candidates from a Granola daily TODO Routine are Routine artifacts until reviewed and published into `wiki/actions/`.
_Avoid_: final answer, action item, extraction candidate when the artifact has not been accepted into a downstream surface.

**Ingest activity**:
The normalized, browser-safe view of connector, raw-to-wiki, and Job Sessions that answers what source content was pulled, skipped, indexed, failed, and which trace explains it. Built from `SessionStore` Events through `@strata/ingest/activity`; not parsed from `wiki/log.md`.
_Avoid_: wiki log, audit log when meaning the normalized DTO surface.

**Ingest taxonomy**:
The local workspace vocabulary used by raw-to-wiki indexing, loaded from `.strata/ingest/taxonomy.json` by `@strata/ingest/ingest-taxonomy`. It contains user/workspace-specific aliases such as canonical project names, self-name ownership hints, and Slack materiality/ignore patterns. The product code should keep generic source parsing and extraction grammar; subject-matter vocabulary belongs in the Ingest taxonomy or reviewed schema Proposals. It is read/written only at `taxonomy.json` (the legacy `profile.json` path has been removed).
_Avoid_: hard-coded classifier rules, built-in project aliases, workspace vocabulary in TypeScript.

**Classification correction**:
A typed reviewer verdict on a raw-to-wiki classification outcome — confirm, wrong project, noise, or unrecognized project — captured as durable feedback that seeds taxonomy schema Proposals and serves as eval ground truth for the taxonomy-suggestion loop.
_Avoid_: flag, thumbs-down, correction note when the typed verdict and its provenance matter.

**Extraction**:
The evidence-backed process that turns wiki/source material into reviewable artifacts such as TODOs. The previous `daily.todo` implementation was removed after poor quality results. Future action extraction should be implemented through Routine artifacts after the action schema and write-back contract are redesigned.
_Avoid_: one-off parser, hidden classifier, browser-only detection logic.

**Evidence span**:
A bounded source excerpt considered by an Extraction, with source path, source kind/type, date, line/message bounds, speaker metadata when available, and enough surrounding context to review the decision without mutating raw material.
_Avoid_: snippet when the source location and provenance matter.

**Extraction candidate**:
A normalized artifact proposed by an Extraction from one or more Evidence spans, before reviewer publication. Future TODO candidates should usually be Routine artifacts first, carrying owner, due-date, confidence, rationale, source refs, publication state, and stable dedupe keys.
_Avoid_: action item when the candidate has not yet been accepted into `wiki/actions/`.

**Extraction run**:
A trace-backed execution of one Extraction over a specific source scope. This is historical vocabulary after the extraction reset; new automated TODO discovery should use Routine runs and Routine artifacts instead of restoring the old `daily.todo` run model.
_Avoid_: backfill when meaning the individual recorded run.

**Wiki hygiene**:
The scheduled-safe maintenance path that keeps curated wiki entities and retrieval quality healthy without silently rewriting pages. `wiki.entities` produces structured duplicate/over-specific project findings and deduplicated pending wiki Proposals; `wiki.hygiene` runs that proposal pass and refreshes the local search index.
_Avoid_: auto-merge when meaning proposal-backed hygiene.

### Messages, events, and traces

**Message**:
One row in the persisted conversation transcript for a Session: `role ∈ {system, user, assistant, tool}`, content, tool calls, attachments. The subset of Session activity that participates in model context.
_Avoid_: turn, entry.

**Event**:
One row in the canonical per-Session activity log in `.strata/state.sqlite` — a typed structured record of anything that happened during a Run that isn't itself a Message. Examples: `session.started`, `agent.loop.completed`, `model.request`, `model.response`, `tool.call`, `tool.result`, `file.changed`, `proposal.created`.
_Avoid_: log entry, trace entry.

**Trace**:
The per-Session JSONL file at `.strata/traces/<sessionId>.jsonl` that mirrors every Event for offline inspection and replay. Derived from the SQLite events table; SQLite is the system of record.
_Avoid_: log file, history.

**`AgentRunEvent`** (and its browser-safe subset `ChatStreamEvent`):
The streaming event types yielded *in process* by `runAgentLoopEvents()` and forwarded to clients. Distinct from persisted **Events**: the streaming type is the live notification surface; the persisted Event is the durable record. They correspond but aren't the same shape.

### Tools

**Tool**:
A named, auditable capability the agent can invoke (e.g. `wiki.search`, `fs.edit`, `shell.run`). Identified by a dotted name. The agent never side-effects without going through one.
_Avoid_: action, function, command.

**ToolDefinition**:
The full registration object for a Tool — name, description, JSON-schema input, mode, optional `maxResultChars`, and the handler function. Held in the `ToolRegistry`; never sent to the browser because the handler isn't browser-safe.
_Avoid_: tool spec, tool config.

**ToolMetadata**:
The browser-safe subset of a `ToolDefinition` (name, description, mode, schema, `maxResultChars`). Used to send the tool catalog to model adapters and frontends.
_Avoid_: tool info.

**Mode**:
The capability classification of a Tool — `read | write | learning | dangerous`. Declared on each `ToolDefinition`. Drives Profile filtering and signals risk class.
_Avoid_: kind, type when meaning a tool's classification.

**Profile**:
A runtime filter applied to the `ToolRegistry` that exposes a subset of registered Tools to the agent — `read-only | maintenance | learning | dangerous`. Each Profile is a set of allowed Modes. Different call sites (CLI subcommand, ingest job, web chat, scheduled maintenance) pick different Profiles so the same registry can yield different capability budgets without re-registration.
_Avoid_: permission set, scope.

**ToolCall**:
A model-emitted invocation of a Tool inside a Run — id, name, argumentsText (the JSON string the model produced). Persisted in the assistant Message that emitted it and replayed into the registry.
_Avoid_: tool invocation, tool use.

**ToolExecutionResult**:
The structured outcome returned by the registry after running a ToolCall — either `{ ok: true, result, truncated }` or `{ ok: false, error: { code, message } }`. The agent loop converts this into a `tool` Message and a `tool.result` Event.
_Avoid_: tool output, tool response.

**Tool pack**:
An integration package that discovers or defines external capabilities (e.g. a hosted MCP server's tools) and registers them as ordinary `ToolDefinition`s in the shared `ToolRegistry`. The agent loop stays protocol-agnostic; provider-specific SDKs live only inside the pack. Distinct from a Connector. Planned in [docs/tool-packs-mcp-plan.md](docs/tool-packs-mcp-plan.md); not yet a code concept.
_Avoid_: plugin, integration (used alone).

### Learning artifacts

**Learning artifact**:
A durable local record carried across Runs that improves future Runs. The four types are Memory, Skill, Todo, and Proposal entries. Distinct from Tools (capabilities the agent invokes) and Sessions (per-Run history). Read into run context (Memory, Todo, Skill index) or applied to it via review (Proposal). Pi has no equivalent — Pi is a coding agent without a memory-backed operating model; Strata's Learning artifact concept is Hermes-inspired.
_Avoid_: knowledge base entry (that's the wiki), state.

**Memory**:
Durable facts about the user or the operating environment, stored under `.strata/memory/` as Markdown documents (`USER.md` and `OPERATIONS.md`). `MemoryTarget = "user" | "operations"`. Read on every Run via run context. Mutated directly via `memory.write` / `memory.append` tools, or staged via a Memory Proposal during Reflection.
_Avoid_: notes, profile, context.

**Skill**:
A reusable procedural-knowledge entry — a Markdown document at `.strata/skills/<name>/SKILL.md` (Strata-owned) or `.agents/skills/<name>/SKILL.md` (project-shared), with frontmatter declaring `name`, `description`, and optional `disable-model-invocation`. The compact skill index is injected into run context; the body is read on demand via `skills.read` or invoked as a `/skill:<name>` command. Mirrors Pi's Skill spec; Strata adds `source: "strata" | "agents"` and prioritizes `.strata` on name collisions.
_Avoid_: routine, recipe, playbook.

**Todo**:
An open commitment entry stored in `.strata/todos.json` with `status ∈ {open, in_progress, blocked, done, cancelled}` and `priority ∈ {low, normal, high}`. Active (non-completed) Todos are injected into run context. Mutated via `todo.add` / `todo.update` / `todo.remove` tools.
_Avoid_: task, action item (those are wiki concepts under `wiki/actions/`).

**Proposal**:
A staged change to a Learning artifact or the wiki, created when a Run identifies a risky update that should be human-reviewed before applying. Stored as Markdown under `.strata/proposals/`. `LearningProposalKind = "memory" | "skill" | "schema" | "wiki"`; status starts `pending`; producers may attach a `dedupe_key` so recurring maintenance reuses an existing pending proposal instead of creating duplicates. Apply/reject is a separate (planned) review flow.
_Avoid_: suggestion, change request.

## Relationships

- A **Session** contains many **Runs** in chronological order.
- A **Run** writes **Messages** and **Events** back to the **Session** it belongs to.
- A **Web chat run** wraps exactly one **Run** and stores its event stream durably for browser reconnects.
- A **Job** creates a trace-backed **Session** of kind `job`; domain adapters under the Job may create additional ingest or maintenance Sessions. Deterministic Jobs are invoked by Routines (via `preRunSteps`/`job.run`), not scheduled directly.
- A **Routine** owns many **Routine triggers**; each trigger fires `routine.run` for its Routine on a cadence. A Routine can also be run manually or by API.
- A **Routine run** links the enclosing `routine.run` **Job** Session, any child pre-run **Job** Sessions, the agent **Session**, and any produced **Routine artifacts**.
- **Ingest activity** is derived from **Events** across Job and ingest Sessions, with parent/child links inferred from job output and Routine trigger metadata.
- A future **Extraction** may read **Evidence spans** and produce reviewed **Routine artifacts** or other candidates before publishing into wiki artifacts such as `wiki/actions/`; raw source material remains immutable.
- Every **Event** is mirrored to the **Trace** file for the same Session; SQLite is canonical, the Trace file is derived.
- An **`AgentRunEvent`** is emitted in process as work happens; it may correspond to a persisted **Event** but is a separate type.
- A **Tool** is declared as a **ToolDefinition** and held in the **ToolRegistry**.
- A **Profile** is a set of allowed **Modes**; it filters which Tools a given call site sees.
- A **ToolCall** executed by the registry yields a **ToolExecutionResult**, which becomes a `tool` **Message** plus a `tool.result` **Event**.
- A **Tool pack** registers many **ToolDefinitions** without changing the agent loop.
- A **Memory** entry is created either by direct tool call (`memory.write`/`memory.append`) or by an applied **Memory Proposal**.
- A **Proposal** has `kind ∈ {memory, skill, schema, wiki}` indicating which artifact type its target change affects.
- Active **Todos**, **Memory** content, and the compact **Skill** index ride in run context; **Proposals** do not (they are for human review, not model context).

## Example dialogue

> **Dev:** "If a user sends a follow-up message in the same chat, is that a new Session?"
> **Domain expert:** "No — same Session, new Run. The Session id is stable across follow-ups; only the Run id changes."

## Flagged ambiguities

- **"Run"** is currently used both for the in-process agent-loop invocation (`Run`) and for the persisted browser-job wrapper (`Web chat run`). The two share an id by convention, but they are different concerns. Open question: should the persisted wrapper be renamed in code (e.g. `ChatStreamJob`) to remove the overload, or kept as `Web chat run` because the convention is already in flight in tRPC procedures and SSE event names?
- **`SessionKind = "trace"`** is dead vocabulary — no producer creates one, and Pi (the design reference) has no `kind` discriminator at all. Slated for removal from `SessionKind` in `packages/core/src/types.ts`.
- **Messages and Events as separate tables** is a Strata-local choice; Pi keeps a single typed entry stream per session. Open question for a future ADR: should Strata collapse the two into a unified entry stream, or keep them split for SQL queryability (FTS, joins for session search)?
- **Mode and Profile share two values (`learning`, `dangerous`)** but they are different enums. `Mode` classifies a Tool; `Profile` filters which Tools a registry exposes (a Profile is a set of allowed Modes). At a glance the names look interchangeable; they aren't. Pi has no equivalent concept — Strata's Mode/Profile layering exists because one Strata process serves multiple capability budgets (CLI, ingest, web chat, scheduled maintenance) from a shared registry. The decision is to document the distinction here rather than rename the enums.
- **`LearningProposalKind = "schema"`** now covers reviewed local-schema changes such as `ingest.taxonomy.*` operations. These are durable runtime-configuration changes, not wiki-page edits.
- **Schedule vs Routine** was resolved by unification, not coexistence, and has now landed. [ADR-0002](docs/adr/0002-collapse-schedules-into-routines.md) deleted **Schedule** as a concept: `job_schedules` became `routine_triggers` (FK to a Routine, no `jobName`), `agent.prompt` was removed, deterministic Jobs survive only as `preRunSteps`/`job.run` targets, and the `/schedules` page + `strata schedules` CLI were removed in favor of the Routines Triggers surface (`strata routines trigger …`). Accepted trade-off: every automation now runs the agent, so cadence'd infra (connector sync, index refresh) gains a model dependency.
