# Strata Roadmap

Status: canonical top-level planning document.

This document coordinates the lower-level plans in [wiki-plan.md](./wiki-plan.md), [extraction-framework-plan.md](./extraction-framework-plan.md), [agent-harness-plan.md](./agent-harness-plan.md), [tui-plan.md](./tui-plan.md), [web-chat-plan.md](./web-chat-plan.md), [web-feature-parity-plan.md](./web-feature-parity-plan.md), [web-control-plane-plan.md](./web-control-plane-plan.md), [ingest-activity-log-plan.md](./ingest-activity-log-plan.md), [tool-packs-mcp-plan.md](./tool-packs-mcp-plan.md), and [extensions-plan.md](./extensions-plan.md). Those documents contain implementation details. This document defines what Strata is, what we are building first, and how the pieces fit together.

Current implementation status: [status.md](./status.md).

## What Strata Is

Strata is a local, agent-maintained personal work system.

It has two tightly connected parts:

1. A Markdown work wiki that captures the user's priorities, projects, people, decisions, meetings, open threads, action items, and source material.
2. A Bun/TypeScript agentic harness that can query, maintain, improve, and locally extend that wiki through explicit tools, persistent traces, memory, skills, scheduled maintenance jobs, extensions, a TUI, a local browser chat UI, and a local web control plane for connector setup.

The wiki is the durable knowledge base. The harness is the working system that keeps the knowledge base useful.

In one sentence:

> Strata is a local Bun/TypeScript agent that helps the user remember, understand, and maintain their work context by operating on a Markdown wiki with safe tools and durable learning loops.

## The Core Product

Strata should answer six recurring user needs:

- What matters right now?
- What happened before, and where is the evidence?
- What do I owe people, and what do they owe me?
- What decisions have we made, and why?
- What content did Strata ingest, how was it organized, and why?
- What has the agent learned that should make the next session better?

The first version should feel less like a general chatbot and more like a disciplined work assistant with a memory-backed operating model.

## System Layers

### 1. Work Wiki

The wiki is user-facing Markdown stored under `wiki/`. It contains pages such as `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/actions/`.

Raw source material lives under `wiki/raw/` and is immutable. The agent may read raw sources but must not edit them.

Detailed plan: [wiki-plan.md](./wiki-plan.md).

### 2. Extraction Framework

The extraction framework is the shared path for turning wiki evidence into durable extracted artifacts such as action items, decisions, open questions, and project facts. It should replace scattered one-off extraction heuristics with a trace-backed pipeline:

`wiki corpus -> evidence spans -> deterministic candidates -> optional LLM verification -> reviewed or published artifacts`

The first target is `daily.todo`: a day-by-day re-indexer that scans wiki/raw/source content for a date, verifies possible TODOs, dedupes against prior extraction decisions and existing wiki action ledgers, and publishes only high-confidence action items to `wiki/actions/mine.md` or `wiki/actions/theirs.md`. Ambiguous candidates should remain reviewable rather than silently entering the action ledgers.

Detailed plan: [extraction-framework-plan.md](./extraction-framework-plan.md).

### 3. Agentic Harness

The harness is the runtime that calls models, exposes tools, records sessions, and maintains learning artifacts. It lives in the Bun workspace packages under `packages/`.

The harness owns:

- The model/tool loop.
- Tool registration and policy enforcement.
- Session traces and SQLite session state.
- File, wiki, shell, memory, session-search, and skill tools.
- Reflection and learning workflows.
- Registered jobs and scheduled maintenance for recurring connector pulls, wiki hygiene, retrieval refreshes, scheduled agent prompt sessions, and learning tasks.

Detailed plan: [agent-harness-plan.md](./agent-harness-plan.md).

### 4. TUI

The TUI is the primary interactive interface. It should make agent work visible: messages, tool calls, auth state, model state, sessions, and command flow.

The TUI should be implemented end-to-end in this repo, using Pi as a reference but not as a dependency.

Detailed plan: [tui-plan.md](./tui-plan.md).

### 5. Web Chat

The web chat is a local browser interface for the same agent runtime used by the CLI and TUI. It should stream events from `runAgentLoopEvents()` through `packages/web-api`, render messages and tool calls in `apps/web`, and persist sessions through the existing Strata session store.

The web chat is not a separate browser-side agent and should not shell out to the CLI for normal operation. CLI, TUI, and web chat are three frontends over the shared agent loop.

Detailed plan: [web-chat-plan.md](./web-chat-plan.md).

### 6. Web Control Plane

The web control plane is a future local browser UI for setup and operations, not a separate product and not the ingestion runtime itself. It should expose connector setup, OAuth/token status, dry-run pulls, trace-backed ingest activity history, schedules, and proposal review for sources such as Notion, Granola, and Slack.

The web app must call the same connector, scheduler, session, and proposal APIs used by the CLI and TUI. Connector logic belongs in shared packages; the web app is only another interface over those packages. The local API surface is Hono + tRPC so the React client can consume shared router types without duplicating DTO definitions.

Detailed plans: [web-control-plane-plan.md](./web-control-plane-plan.md) and [ingest-activity-log-plan.md](./ingest-activity-log-plan.md).

### 7. External Tool Packs And MCP

External third-party agent tools, including hosted MCP servers, should be packaged separately from the core harness. The agent loop should remain protocol-agnostic: integration packages discover or define external capabilities, translate them into normal Strata `ToolDefinition`s, and register them into the shared `ToolRegistry`.

The first target is a Notion MCP tool pack that reuses the current Notion MCP OAuth work, exposes selected read-oriented Notion MCP tools as `mcp.notion.*`, and keeps deterministic Notion raw snapshot ingestion separate until MCP can meet the same source-ID, retry, durability, and traceability requirements.

Detailed plan: [tool-packs-mcp-plan.md](./tool-packs-mcp-plan.md).

### 8. Extensions

Extensions are trusted local TypeScript modules that can add tools, commands, hooks, prompt/context resources, provider definitions, and eventually TUI/web UI affordances without requiring every workflow to land in core packages. Pi is the exact behavioral guide: Strata should adapt Pi's extension API shape and examples, but implement them in Strata's package boundaries over the shared `runAgentLoopEvents()`, `ToolRegistry`, and `SessionStore`.

Extensions are distinct from external tool packs: tool packs are narrow integration packages such as Notion MCP, while extensions are the broader local customization mechanism that can implement workflows such as permission gates, plan mode, subagent orchestration, prompt customizers, custom providers, and remote-execution wrappers. Extension loading must be explicit, local, trust-aware, profile-gated, and trace-backed.

Detailed plan: [extensions-plan.md](./extensions-plan.md).

## Learning Loops

Learning is not model training. In Strata, learning means improving durable local artifacts that future sessions can use.

Strata should learn through:

- Session traces: every meaningful agent run is persisted.
- Memory: durable user and project facts that prevent repeated steering.
- Skills: reusable procedural knowledge for recurring workflows.
- Reflection: post-run review that identifies what should be saved or improved.
- Curator passes: periodic cleanup of stale, duplicated, or low-quality learning artifacts.

The learning loop is central to the product, not an optional later feature.

## What We Are Not Building

Strata is not trying to be:

- A general-purpose clone of Hermes, Claude Code, Codex, or Pi.
- A cloud SaaS product.
- A multi-user team knowledge base.
- A full automation platform with arbitrary integrations enabled by default.
- A web server exposed to the public internet.
- A replacement for the user's source systems such as Slack, Notion, or Granola.
- A model fine-tuning system.

We should copy good implementation ideas from Hermes and Pi. Pi is especially relevant for clean TypeScript coding tools and TUI behavior. Hermes is especially relevant for memory, skills, session recall, delegation, and cron-style maintenance loops. The target product is still smaller and more opinionated: one user's local work context, maintained carefully.

## Design Commitments

- Local-first: the repo and `.strata/` runtime state are the system of record.
- Bun/TypeScript-first: all new first-party implementation should live in the current Bun workspace.
- Explicit tools: the agent acts through named, auditable tools, not hidden side effects.
- Shared agent runtime: CLI, TUI, and web chat should call the same agent loop and tool registry rather than implementing separate behavior.
- Integration isolation: third-party agent tools such as MCP servers should live in explicit integration/tool-pack packages that register ordinary Strata tools; the agent loop should not import provider-specific SDKs.
- Local extensibility: trusted local extensions should be able to add tools, commands, hooks, resources, providers, and UI affordances through an explicit Pi-shaped API without bypassing the shared agent loop, session store, or policy layer.
- Shared connector contracts: CLI, TUI, scheduler, and web surfaces should call the same connector APIs.
- Workspace taxonomy as local data: raw-to-wiki code should stay subject-matter agnostic. Canonical project aliases, self-name ownership hints, and source-specific materiality/ignore patterns belong in `.strata/ingest/taxonomy.json` or reviewed taxonomy proposals, not in product TypeScript.
- Evidence-backed extraction: extracted TODOs, decisions, and similar artifacts should be traceable to source spans, extractor/verifier versions, confidence, and rationale. Re-indexing historical wiki days must be resumable and idempotent.
- Safe writes: raw sources are immutable, broad writes are guarded, and risky changes should be staged for review.
- Durable traces: completed work should be inspectable and searchable later.
- Observable ingestion: source pulls and raw-to-wiki organization should be reconstructable from structured session events, with `wiki/log.md` kept as a compact human chronology rather than the machine source of truth.
- Local-only control surfaces: any web UI should bind to loopback by default and treat connector credentials as secrets.
- Scheduled upkeep: recurring local jobs should keep connectors, the wiki, agent prompt workflows, memory, skills, and indexes healthy through the shared job/schedule runner.
- Progressive capability: start with narrow useful tools, then add more powerful tools once policy and observability are solid.
- Learning-first: memory, skills, and session recall should arrive early enough to shape the rest of the system.

## Near-Term Build Focus

The immediate build focus is the agentic harness, because the wiki cannot become self-maintaining until the harness has enough tool and learning infrastructure.

The next implementation sequence is:

1. Expand the tool foundation with registry profiles and safe filesystem read/search tools. Status: complete.
2. Add guarded edit/write tools for wiki maintenance. Status: complete.
3. Add a dangerous-mode shell tool for tests, formatting, and local automation. Status: complete.
4. Add todo, memory, session-search, and skill tools. Status: basic slice complete.
5. Inject active todos, memory, and a compact skill index into agent runs. Status: complete.
6. Wire reflection so learning artifacts improve after useful sessions. Status: basic slice complete.
7. Add scheduled jobs for connector pulls, raw-to-wiki indexing, wiki hygiene, scheduled agent prompts, memory review, skill curation, stale actions, and index refreshes. Status: initial `@strata/jobs` package present with registered jobs, trace-backed `job` sessions, durable interval/cron schedules in SQLite, CLI commands, a PM2 worker, and an automation-first `/schedules` web route for source syncs, wiki upkeep, scheduled agent prompt sessions, and grouped configured schedules. `agent.prompt` starts the shared agent loop from an arbitrary scheduled prompt with an explicit tool profile, and the safe `wiki.hygiene` job runs entity-consolidation proposal generation plus curated-first search-index refresh without directly rewriting wiki pages.
8. Continue improving the TUI around the richer agent runtime.
9. Return to source ingestion and wiki automation once the harness can maintain the wiki with observable tools and learning loops. Status: Notion, Granola, and Slack raw snapshots now run through the shared connector runner; Slack also has initial checkpointed sync and Socket Mode tailing. Granola raw backfill now handles official cursor pagination/detail transcript fetches, `strata ingest granola propose` stages review proposals, and `strata ingest raw index --source all|granola|notion|slack` automatically creates curated meeting, project, source, people, decision, action, index, and log pages from supported raw snapshots. Decision/action extraction is conservative and evidence-oriented: explicit decisions and owner-attributed commitments are promoted, vague planning questions are skipped, and Slack first-person commitments are attributed to the message speaker before ownership classification. Workspace-specific classification vocabulary now loads from the local ingest taxonomy at `.strata/ingest/taxonomy.json` through `@strata/ingest/ingest-taxonomy` (with legacy profile fallback), so canonical project aliases, self names, and local Slack materiality/ignore patterns are no longer product-code constants. Raw-to-wiki item events now include structured classification reasons, and `strata ingest taxonomy ...` plus the `/ingest-taxonomy` web route can inspect, update, propose, and apply taxonomy changes. Slack raw-to-wiki dedupes snapshots, filters low-signal threads, writes material Slack snapshots to `wiki/sources/slack/` instead of bulk `wiki/threads/`, and has been applied to the current local raw Slack corpus. `strata wiki archive-generated-slack-threads` archives legacy generated Slack thread pages out of `wiki/threads`, `strata wiki compact-index` keeps `wiki/index.md` human-scale, and `strata wiki search-index refresh` builds the local curated-first SQLite FTS retrieval index over curated pages, source pages, and raw evidence. `wiki.entities` produces structured consolidation reports plus deduplicated pending proposals, emits guarded exact canonical merge patches for conservative small project duplicates, and falls back to manual review for ambiguous cases; `wiki.hygiene` makes entity proposal generation plus retrieval refresh schedulable. `--index` hooks are present on Granola, Notion, and Slack pulls.
10. Add a generalized extraction framework for evidence-backed extracted artifacts, starting with day-by-day TODO extraction. Status: Slices 1-6 plus the first deterministic quality pass are present in [extraction-framework-plan.md](./extraction-framework-plan.md), `@strata/ingest/extraction`, raw-to-wiki, `packages/web-api`, and `/actions`: shared extraction types, day-scoped wiki corpus resolution, Slack/generic evidence spans, deterministic `daily.todo` candidates, fake-verifier tests, trace events, SQLite `extraction_runs`/`extraction_candidates`, idempotent source-span/candidate-hash persistence, opt-in schema-checked model verification through `--verify [--provider P] [--model M]`, failure-to-`needs_review` handling, stored prompt/model metadata, `strata extract daily-todos --date ... --dry-run --json`, resumable `backfill --from --to --dry-run --json`, `--apply` publication of confirmed high-confidence owned candidates into Markdown action ledgers with source links and hidden extraction context metadata, browser review of unpublished daily candidates with accept/reject controls, raw-to-wiki action promotion through the same daily TODO candidate/publication path, shared suppressions for reviewed Slack/status false positives, and dedupe for repeated Slack snapshots plus raw/curated source copies. Next work validates model-verified daily TODO passes before broader publication.
11. Add a browser chat interface over the shared agent runtime so agent sessions can be driven from `apps/web` while Slack ingestion and connector validation continue in the background. Status: foundation live-verified; backend streaming/cancel endpoints, durable web chat run/event storage, replayable SSE reconnects, chat metadata procedures, and the `/chat` route are present, with tool-call rendering, session continuation, persistence, cancellation, file `@`-mention autocomplete, model/reasoning controls, slash commands, prompt history, context/token metrics, learning-tool renderers, dropped-stream reconnect/recovery behavior, and responsive mobile/tablet/narrow-desktop behavior verified in the browser. Core specialized renderers now cover wiki search/read, file read/edit, wiki patch, shell command, memory, todo, and skills tools. Maintain this surface while returning to connector/raw-to-wiki work.
12. Bring the web composer up to TUI feature parity: file `@`-mention autocomplete, model picker, slash commands, and prompt history. Status: complete in [web-feature-parity-plan.md](./web-feature-parity-plan.md); `listModels` lives in `@strata/agent`, repo file search lives in `@strata/core` as `findRepoFiles`, `chat.files.list` and `chat.models.list` expose those shared data sources through tRPC, `chat.sessions.fork` supports `/fork`, and the web composer has the shared autocomplete primitive plus file mentions, slash commands, persisted model/reasoning selection, and local prompt history.
13. Expose a trace-backed ingest activity log that shows what source content was ingested, which raw snapshots were written or skipped, how raw-to-wiki organized each item into curated pages, and which session trace explains the operation. Status: initial slice present in [ingest-activity-log-plan.md](./ingest-activity-log-plan.md); `@strata/ingest/activity` normalizes job/connector/raw-to-wiki session events, connector and raw-to-wiki sessions emit item-level events for future runs, `activity.list/get` exposes browser-safe DTOs through tRPC, `/activity` shows recent runs with source filters and expandable item timelines, and `ingest_activity_runs` materializes run summaries for database-backed list filters. No CLI activity view exists yet.
14. After connector contracts and automated source-to-wiki flows are stable, deepen the local web control plane for connector setup, dry-runs, schedules, ingest history, saved defaults, taxonomy review, action management, and proposal review. Status: skeleton present with connector list, generic connector-run operations, Notion page snapshots, Granola key setup plus bounded one-off backfill, Slack status plus checkpointed one-off sync/backfill controls, Notion MCP auth, ingest activity, wiki action management backed by `wiki/actions/`, ingest taxonomy view/edit/propose controls, proposal list/detail/accept/defer/reject controls over the shared proposal store including narrow create/patch wiki proposal apply, ingest taxonomy schema proposal apply, plus guarded exact consolidation apply, automation-first schedule controls over `@strata/jobs`, scheduled agent prompt controls backed by `agent.prompt`, connector-specific Granola/Slack schedule status/preset controls, and non-secret connector config profiles exposed through CLI, tRPC, Notion/Granola/Slack saved-default UI controls, and profile-aware connector schedule presets.
15. Add an external tool-pack layer for optional third-party agent tools, starting with Notion MCP tools. Status: planned in [tool-packs-mcp-plan.md](./tool-packs-mcp-plan.md); current code has Notion MCP OAuth/list-tools in `packages/web-api`, but no agent-facing MCP tool-pack registration yet.
16. Add a Pi-style local extension runtime after the core registry/tool-pack composition path is stable. Status: planned in [extensions-plan.md](./extensions-plan.md); no dynamic extension loader, public `ExtensionAPI`, extension command registry, extension hooks, or extension UI API exists yet.

## Reference Implementations

Strata should selectively adapt features from Pi and Hermes rather than copying either product wholesale.

Pi features to adapt:

- File read, edit, write, grep, find, list, and shell tools.
- Tool result truncation and command-output ergonomics.
- TUI interaction patterns, especially transcript display, prompt editing, auth flow, session selection, and tool-call rendering.
- Extension architecture: local TypeScript modules, `registerTool`, slash commands, lifecycle hooks, prompt/resource discovery, provider registration, UI hooks, and example workflows such as permission gates, plan mode, remote execution, and subagents.

Hermes features to adapt:

- Persistent memory and user profile storage.
- Skills as procedural memory.
- Session search across prior conversations.
- Reflection and curator loops.
- Cron-style scheduled jobs and maintenance.
- Eventually, scoped delegation and managed background processes.

Scheduled maintenance should be treated as a first-class product feature. The point is not just to answer questions on demand, but to keep the user's "brain" content fresh without requiring constant manual prompting.

## Plan Map

- [roadmap.md](./roadmap.md): canonical top-level intent and sequencing.
- [status.md](./status.md): current implementation status against the roadmap.
- [app-overview.md](./app-overview.md): concise orientation for agents joining the project.
- [wiki-plan.md](./wiki-plan.md): wiki structure, source ingestion, entity schemas, and maintenance workflows.
- [extraction-framework-plan.md](./extraction-framework-plan.md): generalized evidence-backed extraction framework and day-by-day TODO re-indexing plan.
- [agent-harness-plan.md](./agent-harness-plan.md): model loop, tools, memory, skills, traces, and learning architecture.
- [tui-plan.md](./tui-plan.md): terminal UI architecture and implementation direction.
- [web-chat-plan.md](./web-chat-plan.md): local browser chat over the shared agent loop, using `packages/web-api` streaming endpoints and AI Elements UI components.
- [web-feature-parity-plan.md](./web-feature-parity-plan.md): porting TUI composer features (file `@`-mentions, model picker, slash commands, prompt history) to the web chat by sharing data sources between the two surfaces.
- [web-control-plane-plan.md](./web-control-plane-plan.md): local web UI for connector setup, operational status, scheduling, and proposal review.
- [ingest-activity-log-plan.md](./ingest-activity-log-plan.md): trace-backed activity log for source ingestion and raw-to-wiki organization.
- [tool-packs-mcp-plan.md](./tool-packs-mcp-plan.md): external third-party tool-pack architecture and Notion MCP agent-tool plan.
- [extensions-plan.md](./extensions-plan.md): Pi-style trusted local extension runtime for tools, commands, hooks, providers, UI affordances, and subagent-style workflows.
- [slack-connector.md](./slack-connector.md): Slack backfill, checkpointing, Socket Mode, and app setup notes.

When the plans conflict, update this document first, then reconcile the lower-level plan.
