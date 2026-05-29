# AGENTS.md

This is the root instruction file for agents working in this repository. `CLAUDE.md` is a compatibility symlink to this file, so keep this document tool-agnostic and useful for any coding agent.

## What We Are Building

Strata is a local, agent-maintained personal work system.

It has two connected parts:

1. A Markdown work wiki that captures the user's priorities, projects, people, meetings, decisions, open threads, action items, and source material.
2. A Bun/TypeScript agentic harness that can query, maintain, improve, and locally extend that wiki through explicit tools, durable traces, memory, skills, scheduled jobs, extensions, a TUI, a local browser chat UI, and a local web control plane for connector setup.

The wiki is the durable knowledge base. The harness is the working system that keeps that knowledge base useful.

In one sentence: Strata is a local Bun/TypeScript agent that helps the user remember, understand, and maintain their work context by operating on a Markdown wiki with safe tools and durable learning loops.

## How The Roadmap Works

Start with [docs/app-overview.md](docs/app-overview.md) for a short orientation, then read [docs/roadmap.md](docs/roadmap.md). The roadmap is the canonical top-level plan: product definition, system layers, design commitments, near-term sequencing, and reference implementation strategy.

Use [docs/status.md](docs/status.md) to understand where implementation currently stands against the roadmap. Update it whenever a roadmap area materially changes.

The detailed plans are subordinate to the roadmap:

- [docs/wiki-plan.md](docs/wiki-plan.md): wiki structure, source ingestion, entity schemas, and maintenance workflows.
- [docs/extraction-framework-plan.md](docs/extraction-framework-plan.md): generalized evidence-backed extraction framework and daily TODO re-indexing plan.
- [docs/agent-harness-plan.md](docs/agent-harness-plan.md): model loop, tools, memory, skills, traces, and learning architecture.
- [docs/tui-plan.md](docs/tui-plan.md): terminal UI architecture and implementation direction.
- [docs/web-chat-plan.md](docs/web-chat-plan.md): local browser chat over the shared agent loop.
- [docs/web-control-plane-plan.md](docs/web-control-plane-plan.md): local browser UI for connector setup, schedules, ingest history, and proposal review.
- [docs/tool-packs-mcp-plan.md](docs/tool-packs-mcp-plan.md): external third-party tool-pack architecture and Notion MCP agent-tool plan.
- [docs/extensions-plan.md](docs/extensions-plan.md): Pi-style trusted local extension runtime for tools, commands, hooks, providers, UI affordances, and subagent-style workflows.

When plans conflict, update `docs/roadmap.md` first, then reconcile `docs/status.md` and the relevant detailed plan.

The current implementation focus is documented in `docs/status.md`. At the time this file was last updated, raw-to-wiki indexing could automatically create curated meeting/entity wiki pages from Granola, Notion, and Slack, action promotion flowed through the generalized daily TODO extraction path, and the next milestone was a model-verified daily TODO quality pass before broader publication.

If you change the core roadmap path, milestone sequencing, package boundaries, runtime architecture, agent-loop behavior, tool architecture, connector architecture, or any other load-bearing design decision, use `$maintain-documentation` and update the relevant docs in the same change.

## Agent Roles

You may be working in either of two modes:

- Harness developer: build the agent runtime, tools, CLI, TUI, storage, learning loops, and scheduled maintenance system under `packages/`.
- Wiki curator: maintain the user's Markdown work wiki from curated source material and user requests.

For code work, prefer implementation over abstract advice unless the user explicitly asks for planning or analysis. For wiki work, preserve evidence, cite pages, and do not over-capture noise.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for the current repository remote. See `docs/agents/issue-tracker.md`.

### Triage labels

The canonical triage labels use the default mattpocock/skills vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain-doc layout. See `docs/agents/domain.md`.

## Environment

This repo runs in an exe.dev VM. Only use documented exe.dev features. The exe.dev HTTPS proxy is documented at <https://exe.dev/docs/proxy.md>, and the general docs are at <https://exe.dev/docs.md>. Undocumented local endpoints are internal infrastructure and should not be used.

## Toolchain

Use Bun, not npm.

The repo uses `bun@1.3.13`, TypeScript via `@typescript/native-preview` (`tsgo`), Biome for formatting/linting, and dotenvx for encrypted local `.env` values. Bun runs `.ts` files directly; there is no `tsc` emit step. `verbatimModuleSyntax` and `exactOptionalPropertyTypes` are enabled. Relative imports use `.js` extensions even when the source files are `.ts`.

Runtime scripts that need secrets wrap dotenvx automatically with overload enabled, so encrypted `.env` values work through `bun run strata`, `bun run web:api`, `bun run web:dev`, and the pull scripts. Do not manually decrypt secrets into tracked files.

Common commands:

```bash
bun install
bun run check:workspaces
bun run check
bun test
bun test packages/tui/src/runtime.test.ts
bun test packages/tui/src/runtime.test.ts -t "scrolls"
bun run biome:check
bun run format
bun run format:check
bun dev
bun run dev:status
bun run dev:logs
bun run dev:stop
bun run strata <args>
bun run strata jobs list
bun run strata schedules list
bun run web:api
bun run web:dev
bun run build
```

The CLI currently exposes `auth status|login|logout`, `init`, `query`, `tui` with Pi-style session launch flags, `jobs list|run|worker`, `schedules list|create|enable|disable|delete|run-now`, `trace`, `sessions list|search|delete`, and `tools list|call`. Use `bun run strata --help` for the source of truth.

## Workspace Layout

```text
packages/
  core/        SessionStore, JsonValue/SessionRecord types, paths, runtime dirs
  tools/       ToolRegistry, policy guards, current wiki read/search tools
  agent/       ModelAdapter contract, OpenAI adapters, ChatGPT OAuth, agent loop
  tui/         First-party terminal UI runtime, components, editor, app
  cli/         strata command-line entrypoint
  ingest/      Connector/runtime contracts, raw-to-wiki indexing, extraction, and ingest activity normalization
  jobs/        Registered jobs, job runner, durable schedules, and scheduler loop
  web-api/     Local HTTP API for chat, connector setup, schedules, activity, and operations
  e2e/         End-to-end TUI/agent tests driven through FakeTerminal
  extensions/  Planned Pi-style local extension runtime
apps/
  web/     Vite/React/TanStack Router local control-plane UI
docs/      Roadmap and implementation status
.strata/   Local runtime state: sqlite DB, traces, auth, memory, skills, proposals, reports
```

Workspace dependencies use `workspace:*`. Cross-package imports use `@strata/<pkg>` and `@strata/<pkg>/<subpath>`, with subpath exports declared in each package's `package.json`.

## Architecture Invariants

The agent loop is the source of truth. `runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` drives a single run, owns session creation, seeds messages, counts iterations/tool calls, honors abort signals, emits lifecycle events, and persists state. `runAgentLoop()` is a thin consumer. Do not duplicate loop logic.

Cancellation is end-to-end. `AgentRunConfig.signal` and `ModelRequest.signal` flow into model adapters and are checked by the loop at iteration and tool-call boundaries. Cancelled runs should end as `interrupted` with `stoppedReason: "cancelled"`.

Session storage is centralized. Use `SessionStore.open(repoRoot?)`; runs persist to `.strata/state.sqlite` and `.strata/traces/<sessionId>.jsonl`. Delete sessions through `SessionStore.deleteSession()` so SQLite state and the matching trace file are removed together.

Recurring local automation goes through `@strata/jobs`. Jobs are registered typed operations run by `runJob()`, schedules are persisted in the `job_schedules` table, and the scheduler worker claims due schedules before invoking the shared job runner. Do not add connector-specific daemons or web-request-owned polling loops for recurring source ingestion; register a job or schedule instead. Scheduled prompt-driven agent sessions should use the registered `agent.prompt` job, which calls the shared agent loop with an explicit tool profile, rather than introducing a separate background agent runtime. Wiki hygiene should use the safe `wiki.hygiene`/`maintenance.run` paths that stage review proposals and refresh indexes, not silent page merges.

Ingest observability is trace-backed. Connector, raw-to-wiki, and job activity should be reconstructed from `SessionStore` events through `@strata/ingest/activity`; do not parse `wiki/log.md` or browser state to answer what was ingested, skipped, indexed, or failed. `ingest_activity_runs` is only a local materialized run-list projection of those append-only events for fast list filtering and should be refreshed from events, not treated as the canonical record. Add small redacted append-only events when a connector or indexer lacks the activity metadata the UI/CLI needs.

Raw-to-wiki classification is subject-matter agnostic. Product code may contain generic source parsing, evidence extraction, and safety rules, but workspace vocabulary belongs in the local ingest taxonomy at `.strata/ingest/taxonomy.json` or in reviewed taxonomy proposals. Do not hard-code project aliases, self names, customer/team terms, Slack bot names, or local low-signal phrases in raw-to-wiki TypeScript; load them through `@strata/ingest/ingest-taxonomy`. The loader still reads the legacy `.strata/ingest/profile.json` path for compatibility, but new docs and tools should use taxonomy terminology.

Evidence-backed extraction should go through the shared extraction framework described in `docs/extraction-framework-plan.md`. Daily TODO extraction should be day-addressable, idempotent, and traceable to source spans, extractor/verifier versions, confidence, and rationale. Raw-to-wiki action promotion should flow through `daily.todo` candidate persistence/publication, not bespoke writes to `wiki/actions/`; new TODO extraction logic should not be implemented as browser-only code or as one-off Slack-specific rules outside the shared ingest/extraction layer.

Web chat runs are server-side jobs, not HTTP request lifetimes. `packages/web-api/src/chat.ts` owns active-run state and an abort controller per run; browser SSE streams are subscribers. A dropped browser/proxy stream must not cancel the agent. Only explicit run cancellation should abort the run signal.

Web chat run state is write-through durable. `packages/web-api/src/chatRunStore.ts` persists web chat run metadata and SSE event payloads in `.strata/state.sqlite`; SSE frames include event IDs; `GET /api/chat/runs/:runId/events` replays events after a given ID for reconnects; and server startup marks abandoned running rows plus their linked sessions failed with `stoppedReason: "server_restarted"`. Do not make the browser depend only on the in-memory active-run map or the original `POST /api/chat/runs` response stream.

Web chat SSE streams must stay alive while the model is thinking. `packages/web-api/src/server.ts` sends heartbeat comments during quiet periods and configures Bun's server idle timeout above the default, so long model requests do not look like hung or cancelled browser runs.

Web chat lifecycle diagnostics are durable trace events. Run start, browser stream close, explicit cancel requests, and run finish should be appended to the associated `.strata/traces/<sessionId>.jsonl` trace so stopped browser tasks can be debugged after the request is gone.

Cross-process realtime stays local and event-log-driven. The web UI reflects sessions advanced by any process (other browser tabs, CLI, TUI, maintenance, ingest) via a local change feed — `packages/web-api/src/changeFeed.ts` tails the shared `events` table through `SessionStore.sessionChangesSince` and fans out notices over `GET /api/changes`; the browser store reacts by refreshing the sessions list and reloading affected non-client-streamed sessions. This depends on every writer appending to `SessionStore`'s `events` table (which `session.started`/`session.ended`/messages/tools already do). Do not route run persistence around `SessionStore.appendEvent`, and do not replace this with an external/cloud datastore — it is a notification layer over the local SQLite event log, preserving locality.

Run context includes durable local guidance. `packages/agent/src/runContext.ts` injects root `AGENTS.md`, memory, active todos, and the prompt-visible skill index on every run, including continued sessions.

Auto-compaction is owned by the shared agent loop and is append-only. `packages/agent/src/compaction.ts` appends `compaction.completed` checkpoint events instead of deleting historical messages; continued runs rebuild model context through `buildCompactedMessageRecords()` as fresh system context, the latest summary checkpoint, and kept recent messages. Threshold compaction uses Pi's `contextWindow - reserveTokens` rule, overflow errors compact and retry once, and stale pre-compaction usage must not immediately retrigger compaction.

Tools use dotted names, JSON-schema inputs, a `mode` (`read`, `write`, `learning`, or `dangerous`), optional `maxResultChars`, and optional `executionMode` (`parallel` or `sequential`). The agent loop executes multiple tool calls in Pi-style `parallel` mode by default: starts are emitted in assistant source order, completions are emitted as tools finish, and persisted tool-result messages remain in assistant source order. Any called tool with `executionMode: "sequential"` forces the whole batch sequential. Execute tools through `registry.safeExecute()` so tool failures become structured `ToolExecutionResult` values.

TUI rendering is pi-style scrollback, not alt-screen. `TuiRuntime` writes to the main terminal buffer and must not enable alt-screen. Width/height changes clear the visible viewport but must not wipe terminal scrollback.

TUI overlays are composited by the runtime. Do not reintroduce app-side overlay replacement logic.

The TUI must be testable without a real PTY. Use `FakeTerminal` and the e2e tests under `packages/e2e/` when changing rendering or input behavior.

## Code Conventions

- Relative imports use `.js` extensions.
- Cross-package imports use `@strata/<pkg>`.
- Boundary errors should return typed results where possible instead of leaking raw exceptions.
- The TUI runtime must restore terminal state after errors.
- Use Biome for formatting.
- Commit messages should follow the existing style: `add: ...`, `fix: ...`, `refactor: ...`, `update: ...`, and `ingest: <source> | <title>` for wiki ingests.

## Wiki Operating Rules

The wiki exists so the user never loses track of priorities and can quickly recall past work, decisions, and commitments.

For wiki tasks, read these first:

1. `wiki/priorities.md`
2. `wiki/me.md`
3. `wiki/index.md`

Raw source material lives under `wiki/raw/`:

- `wiki/raw/granola/` for meeting transcripts.
- `wiki/raw/slack/` for captured threads.
- `wiki/raw/notion/` for Notion snapshots.

You may read `wiki/raw/`; never write to it.

Main entity types:

- People: `wiki/people/<name>.md`
- Projects: `wiki/projects/<slug>.md`
- Decisions: `wiki/decisions/YYYY-MM-DD-<slug>.md`
- Threads: `wiki/threads/<slug>.md`
- Meetings: `wiki/meetings/YYYY-MM-DD-<slug>.md`
- Actions: `wiki/actions/mine.md` and `wiki/actions/theirs.md`

Wiki conventions:

- Use wikilinks like `[[Canonical Name]]`.
- Use lowercase kebab-case filenames.
- Date-prefix decisions and meetings.
- Keep YAML frontmatter on wiki pages.
- Append activity to `wiki/log.md` with `## [YYYY-MM-DD HH:MM] <op> | <title>`.
- Update `wiki/index.md` and `wiki/log.md` when ingesting or materially changing wiki content.

Wiki safety rules:

- Never edit `wiki/raw/`.
- Never delete a decision page; mark it superseded and link forward.
- Never auto-ingest Slack threads outside filter rules without asking.
- Never silently overwrite contradictions; surface them.
- Never write secrets into the wiki, traces, memory, skills, or proposals.

When the schema does not fit the work, propose an update to the relevant plan or instruction file rather than forcing the content into the wrong shape.
