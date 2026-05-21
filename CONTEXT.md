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
A staged change to a Learning artifact or the wiki, created when a Run identifies a risky update that should be human-reviewed before applying. Stored under `.strata/proposals/<sessionId>/<kind>/<title>.md`. `LearningProposalKind = "memory" | "skill" | "schema" | "wiki"`; status starts `pending`. Apply/reject is a separate (planned) review flow.
_Avoid_: suggestion, change request.

## Relationships

- A **Session** contains many **Runs** in chronological order.
- A **Run** writes **Messages** and **Events** back to the **Session** it belongs to.
- A **Web chat run** wraps exactly one **Run** and stores its event stream durably for browser reconnects.
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
- **`LearningProposalKind = "schema"`** is undefined territory in this glossary — the type exists in `proposalStore.ts` but no producer in the codebase emits a schema proposal yet. Likely refers to wiki-entity schema changes (matching the `docs/wiki-plan.md` schema discussion) but worth pinning the moment a real schema proposal gets created.
