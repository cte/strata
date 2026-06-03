# Strata App Overview

Status: orientation document for agents joining the project.

Read this before starting implementation work, then use [roadmap.md](./roadmap.md) and [status.md](./status.md) for the current plan and handoff.

## Purpose

Strata is a local, agent-maintained personal work system. It has two connected parts:

- A Markdown work wiki under `wiki/` that stores priorities, projects, people, meetings, decisions, open threads, actions, and immutable raw source snapshots.
- A Bun/TypeScript agentic harness that can query, maintain, improve, and locally extend the wiki through tools, session traces, memory, skills, scheduled maintenance jobs, structured Routines, extensions, a TUI, and local browser UIs.

The wiki is the durable knowledge base. The harness is the operating system that keeps the knowledge base useful.

## Product Surfaces

- `packages/cli`: `strata` command-line entrypoint for auth, init, query, TUI launch, sessions, tools, ingest, learning, and maintenance commands.
- `packages/tui`: first-party terminal UI over the shared agent loop.
- `packages/web-api`: local Hono + tRPC server for the browser app, connector operations, and chat streaming.
- `apps/web`: Vite + React + TanStack Router browser app for connector setup, agent chat, wiki browsing, wiki action-item management, Routine authoring/triggers, retrieval-index management, review inbox, and ingest activity inspection.
- `packages/ingest`: connector contracts, source pullers, checkpointing, non-secret connector config profiles, raw snapshot writers for Notion, Granola, and Slack, workspace-local ingest taxonomy loading/proposals, automated raw-to-wiki indexing for meeting/entity pages across those sources, and trace-backed ingest activity normalization.
- `packages/jobs`: registered deterministic jobs, trace-backed job execution, durable Routine triggers, and the scheduler loop used by CLI, PM2, and the web control plane.
- `packages/routines`: local-first reusable agent workflow definitions, Routine Runs, and schema-valid artifacts. The package provides types, SQLite persistence, store helpers, input/output validation, prompt envelope rendering, the per-run `routine.output.submit` tool, and the runner used by `routine.run`; CLI, web tRPC, and the browser `/routines` UI (inspect plus create/edit/enable-disable/delete and run-now) are present. Built-in infrastructure templates are present for source sync, index refresh, and wiki hygiene; Granola daily TODO discovery is still planned.
- Planned `packages/integrations/*`: optional third-party tool packs, starting with Notion MCP, that register external capabilities as ordinary Strata tools without adding provider-specific code to the agent loop.
- Planned `packages/extensions`: Pi-style trusted local extension runtime for tools, commands, hooks, prompt/resources, providers, UI affordances, and subagent-style workflows.

The CLI, TUI, and web chat should be presentation layers over the same agent runtime. Do not duplicate agent-loop behavior inside an interface package.

## Runtime Architecture

Core packages:

- `packages/core`: paths, runtime directories, SQLite-backed `SessionStore`, embedded state migrations/schema (including durable web chat run/event/queue tables), memory/proposal/skill/todo stores, AGENTS.md instruction loading, and shared JSON/session types.
- `packages/agent`: model adapters, ChatGPT/OpenAI Codex auth, OpenAI-compatible adapter, `runAgentLoopEvents()`, run-context injection, compaction, reflection, and maintenance jobs.
- `packages/tools`: `ToolRegistry`, tool policy/profile handling, wiki tools, filesystem tools, shell tool, memory/todo/session/skill tools, and the planned native `user.ask` human-interaction tool (see [interactive-agent-ui-plan.md](./interactive-agent-ui-plan.md)).
- `packages/jobs`: `JobRegistry`, `runJob()`, `RoutineTriggerStore`, and the scheduler loop. Registered jobs currently wrap connector pulls, raw-to-wiki indexing, wiki retrieval-index refresh, maintenance jobs, the safe `wiki.hygiene` proposal-plus-index job, and `routine.run` as the trigger/execution wrapper for Routines.
- `packages/core/src/wikiSearchIndex.ts`: rebuildable SQLite retrieval state over `wiki/`, including curated/source/raw document rows, chunk-level FTS rows, extracted wiki links, status inspection, and a native hybrid retrieval surface used by `wiki.search` and `wiki.retrieve`.
- `packages/routines`: Routine definition store, Routine Run/artifact persistence, run-time input/output validation, prompt envelope rendering, per-run structured output submission, and shared runner. CLI commands, web tRPC procedures, and the browser `/routines` route can author (create/edit/enable-disable/delete), inspect, and run routines; the planned next piece is built-in routines such as Granola daily TODO discovery (see [routines-plan.md](./routines-plan.md)).
- `packages/terminal-web`: browser terminal emulator API, Ghostty/libghostty WASM loader and snapshot adapter, fallback parser/screen model, canvas renderer, and input mapper for the experimental chat-side terminal panel.
- `packages/terminal-backend`: local PTY-backed shell session management and HTTP/SSE plus POST input/resize terminal bridge used by `packages/web-api` routes.
- Planned `packages/extensions`: extension loader, trust/config handling, lifecycle hooks, extension command/resource registries, and surface adapters.

Key invariant:

`runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` is the source of truth for agent runs. It creates or continues sessions, builds run context, calls the model adapter, executes tools, persists messages/events, emits streaming lifecycle events, and honors cancellation through both model requests and `ToolContext.signal`. Interfaces should consume these events rather than reimplementing the loop. Human clarification should follow the planned [interactive-agent-ui-plan.md](./interactive-agent-ui-plan.md): a normal trace-backed `user.ask` tool over a shared UI adapter, with TUI/web adapters and explicit unavailable behavior for non-interactive runs.

The loop also owns Pi-style mid-run steering. Interactive surfaces may supply `getSteeringMessages` and `getFollowUpMessages`; steering is injected after the current assistant turn/tool batch before the next model request, while follow-ups run only after the agent would otherwise stop.

## Runtime State

- `.strata/` contains local runtime state: SQLite DB, traces, auth, memory, Strata-owned skills, proposals, connector checkpoints, Routine triggers, durable web chat run/event/queue state, and reports. Durable `.strata/state.sqlite` schema belongs in `@strata/core` migrations; feature packages should not create or alter state DB tables directly.
- `.strata/ingest/taxonomy.json` is the local raw-to-wiki taxonomy: canonical project aliases, self-name ownership hints, and source-specific materiality/ignore patterns. It is intentionally local runtime state rather than product code.
- `AGENTS.md` and `.agents/skills/**/SKILL.md` are read as project agent guidance. `.agents/skills` is a compatibility skill source; `.strata/skills` remains Strata's own procedural-memory store.
- `.env` may contain dotenvx-encrypted secrets; runtime scripts that need secrets already wrap dotenvx.
- `wiki/raw/` contains immutable raw source snapshots. Agents may read it but should not edit it.
- Legacy `.cortex/` may exist locally from the old project name. New code should use `.strata/`.

## Current Strategic Direction

Near-term work is returning to connector bring-up and raw-to-wiki automation now that the web chat depth slice is usable:

1. Keep Slack ingestion running and continue connector validation in parallel.
2. Treat [web-feature-parity-plan.md](./web-feature-parity-plan.md) as complete: `listModels` lives in `@strata/agent`, repo-file enumeration lives in `@strata/core` as `findRepoFiles`, `chat.files.list` / `chat.models.list` expose those data sources through tRPC, and the web composer now has file `@`-mentions, a persisted model/reasoning picker, slash commands, and prompt history.
3. Treat the web chat polish slice as complete: dropped-stream reconnect/recovery and responsive mobile/tablet/narrow-desktop behavior have been browser-verified.
4. Keep recurring connector upkeep healthy through Routines and `@strata/jobs`. Granola/Slack sync, retrieval-index refresh, and wiki hygiene are now Routine templates that can be instantiated, given `routine_triggers`, and executed through `routine.run`. `/index` can inspect and manually rebuild the derived retrieval index independent of triggers. `/activity` shows trace-backed source pull and raw-to-wiki outcomes through projection-backed run-list filters. Notion/Granola/Slack one-off controls can save/reload non-secret defaults through the shared connector config store, while recurring source syncs should be represented as Routine definitions plus triggers.
5. Continue the Routine primitive from [routines-plan.md](./routines-plan.md). The store/tables, `routine.run`, structured output submission, CLI/API inspection, and the browser `/routines` UI exist; next is the Granola daily TODO routine and its extraction skill.
6. Re-think automated action extraction from the action-item schema upward through Routines. The previous `daily.todo` path was removed after poor quality results, and the generated ledgers were cleared. The clean starting point is `wiki/actions/mine.md`, `wiki/actions/theirs.md`, `@strata/core/wiki-actions`, `wiki.actions.*`, and `/actions` manual management. The first new producer should be a Granola daily TODO Routine that emits evidence-backed TODO artifacts for review before anything writes to `wiki/actions/`.

Use [status.md](./status.md) for the exact handoff and next concrete implementation step.

## Common Commands

```bash
bun install
bun run check:workspaces
bun test
bun run biome:check
bun run knip
bun run format
bun dev
bun run dev:status
bun run dev:logs
bun run dev:stop
bun run strata <args>
bun run web:api
bun run web:dev
```

Use Bun, not npm. Relative TypeScript imports use `.js` extensions. Cross-package imports use `@strata/<pkg>` and package subpath exports.
