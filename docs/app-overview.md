# Strata App Overview

Status: orientation document for agents joining the project.

Read this before starting implementation work, then use [roadmap.md](./roadmap.md) and [status.md](./status.md) for the current plan and handoff.

## Purpose

Strata is a local, agent-maintained personal work system. It has two connected parts:

- A Markdown work wiki under `wiki/` that stores priorities, projects, people, meetings, decisions, open threads, actions, and immutable raw source snapshots.
- A Bun/TypeScript agentic harness that can query, maintain, improve, and locally extend the wiki through tools, session traces, memory, skills, scheduled maintenance jobs, extensions, a TUI, and local browser UIs.

The wiki is the durable knowledge base. The harness is the operating system that keeps the knowledge base useful.

## Product Surfaces

- `packages/cli`: `strata` command-line entrypoint for auth, init, query, TUI launch, sessions, tools, ingest, learning, and maintenance commands.
- `packages/tui`: first-party terminal UI over the shared agent loop.
- `packages/web-api`: local Hono + tRPC server for the browser app, connector operations, and chat streaming.
- `apps/web`: Vite + React + TanStack Router browser app for connector setup, agent chat, wiki browsing, wiki action-item management, schedules including scheduled agent sessions, ingest taxonomy review, and ingest activity inspection.
- `packages/ingest`: connector contracts, source pullers, checkpointing, non-secret connector config profiles, raw snapshot writers for Notion, Granola, and Slack, workspace-local ingest taxonomy loading/proposals, automated raw-to-wiki indexing for meeting/entity pages across those sources, evidence-backed daily TODO extraction, and trace-backed ingest activity normalization.
- `packages/jobs`: registered local jobs, trace-backed job execution, durable interval/cron schedules, and the scheduler loop used by CLI, PM2, and the web control plane.
- Planned `packages/integrations/*`: optional third-party tool packs, starting with Notion MCP, that register external capabilities as ordinary Strata tools without adding provider-specific code to the agent loop.
- Planned `packages/extensions`: Pi-style trusted local extension runtime for tools, commands, hooks, prompt/resources, providers, UI affordances, and subagent-style workflows.

The CLI, TUI, and web chat should be presentation layers over the same agent runtime. Do not duplicate agent-loop behavior inside an interface package.

## Runtime Architecture

Core packages:

- `packages/core`: paths, runtime directories, SQLite-backed `SessionStore`, memory/proposal/skill/todo stores, AGENTS.md instruction loading, and shared JSON/session types.
- `packages/agent`: model adapters, ChatGPT/OpenAI Codex auth, OpenAI-compatible adapter, `runAgentLoopEvents()`, run-context injection, compaction, reflection, and maintenance jobs.
- `packages/tools`: `ToolRegistry`, tool policy/profile handling, wiki tools, filesystem tools, shell tool, memory/todo/session/skill tools.
- `packages/jobs`: `JobRegistry`, `runJob()`, `ScheduleStore`, and the scheduler loop. Registered jobs currently wrap connector pulls, raw-to-wiki indexing, wiki search-index refresh, scheduled agent prompt sessions, maintenance jobs, and the safe `wiki.hygiene` proposal-plus-index job.
- Planned `packages/extensions`: extension loader, trust/config handling, lifecycle hooks, extension command/resource registries, and surface adapters.

Key invariant:

`runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` is the source of truth for agent runs. It creates or continues sessions, builds run context, calls the model adapter, executes tools, persists messages/events, emits streaming lifecycle events, and honors cancellation. Interfaces should consume these events rather than reimplementing the loop.

## Runtime State

- `.strata/` contains local runtime state: SQLite DB, traces, auth, memory, Strata-owned skills, proposals, connector checkpoints, schedules, and reports.
- `.strata/ingest/taxonomy.json` is the local raw-to-wiki taxonomy: canonical project aliases, self-name ownership hints, and source-specific materiality/ignore patterns. It is intentionally local runtime state rather than product code. The loader can still read legacy `.strata/ingest/profile.json` files.
- `AGENTS.md` and `.agents/skills/**/SKILL.md` are read as project agent guidance. `.agents/skills` is a compatibility skill source; `.strata/skills` remains Strata's own procedural-memory store.
- `.env` may contain dotenvx-encrypted secrets; runtime scripts that need secrets already wrap dotenvx.
- `wiki/raw/` contains immutable raw source snapshots. Agents may read it but should not edit it.
- Legacy `.cortex/` may exist locally from the old project name. New code should use `.strata/`.

## Current Strategic Direction

Near-term work is returning to connector bring-up and raw-to-wiki automation now that the web chat depth slice is usable:

1. Keep Slack ingestion running and continue connector validation in parallel.
2. Treat [web-feature-parity-plan.md](./web-feature-parity-plan.md) as complete: `listModels` lives in `@strata/agent`, repo-file enumeration lives in `@strata/core` as `findRepoFiles`, `chat.files.list` / `chat.models.list` expose those data sources through tRPC, and the web composer now has file `@`-mentions, a persisted model/reasoning picker, slash commands, and prompt history.
3. Treat the web chat polish slice as complete: dropped-stream reconnect/recovery and responsive mobile/tablet/narrow-desktop behavior have been browser-verified.
4. Keep near-real-time connector schedules healthy through `@strata/jobs`. Granola can run as an interval `connector.pull` job with raw-to-wiki indexing and search-index refresh enabled; the `/schedules` web route now presents source sync cards, wiki upkeep presets, an agent prompt scheduler backed by `agent.prompt`, and grouped configured schedules over the same durable schedule records that `strata schedules` manages. `/activity` shows trace-backed source pull and raw-to-wiki outcomes through projection-backed run-list filters, and the Granola/Slack connector pages now expose connector-specific schedule status, run-now, enable/disable, and safe preset controls. Notion/Granola/Slack one-off controls can save/reload non-secret defaults through the shared connector config store, and Granola/Slack schedule presets bind the current default profile when applied so recurring pulls can follow saved scopes while retaining schedule-specific caps.
5. Build out the generalized extraction framework in [extraction-framework-plan.md](./extraction-framework-plan.md), using `daily.todo` as the first case. Slices 1-6 and the first deterministic quality pass are present in `@strata/ingest/extraction`, raw-to-wiki, and the web API/UI: it can resolve a day-scoped corpus, segment Slack and generic wiki evidence into traceable spans, generate deterministic TODO candidates, run a fake verifier for tests, optionally run a schema-checked model verifier through `--verify`, emit trace/count output with verifier/model metadata, persist runs/candidates in SQLite, expose dry-run plus resumable backfill commands, publish confirmed high-confidence owned candidates to `wiki/actions/` through `strata extract daily-todos --date ... --apply`, review unpublished daily candidates from `/actions`, and route raw-to-wiki action promotion through the same daily TODO publication policy. Published actions preserve source links and hidden extraction context metadata, rejected candidates stay preserved across reruns, raw-to-wiki activity events carry extraction run/candidate ids, and shared suppressions/dedupe now cover the first real Slack/status false-positive pass. Next work is model-verified daily TODO quality validation. Continue wiki entity consolidation and raw-to-wiki quality work in parallel: `wiki.search` now uses the local curated-first search index, `wiki.entities` stages deduplicated consolidation proposals, raw-to-wiki classification loads workspace vocabulary from `.strata/ingest/taxonomy.json`, wiki action ledgers remain Markdown under `wiki/actions/`, and `/actions` can manage those ledgers with hidden context metadata.

Use [status.md](./status.md) for the exact handoff and next concrete implementation step.

## Common Commands

```bash
bun install
bun run check:workspaces
bun test
bun run biome:check
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
