# Strata App Overview

Status: orientation document for agents joining the project.

Read this before starting implementation work, then use [roadmap.md](./roadmap.md) and [status.md](./status.md) for the current plan and handoff.

## Purpose

Strata is a local, agent-maintained personal work system. It has two connected parts:

- A Markdown work wiki under `wiki/` that stores priorities, projects, people, meetings, decisions, open threads, actions, and immutable raw source snapshots.
- A Bun/TypeScript agentic harness that can query, maintain, and improve the wiki through tools, session traces, memory, skills, scheduled maintenance jobs, a TUI, and local browser UIs.

The wiki is the durable knowledge base. The harness is the operating system that keeps the knowledge base useful.

## Product Surfaces

- `packages/cli`: `strata` command-line entrypoint for auth, init, query, TUI launch, sessions, tools, ingest, learning, and maintenance commands.
- `packages/tui`: first-party terminal UI over the shared agent loop.
- `packages/web-api`: local Hono + tRPC server for the browser app, connector operations, and chat streaming.
- `apps/web`: Vite + React + TanStack Router browser app for connector setup and initial agent chat.
- `packages/ingest`: connector contracts, source pullers, checkpointing, raw snapshot writers for Notion, Granola, and Slack, plus automated raw-to-wiki indexing for meeting/entity pages across those sources.
- Planned `packages/integrations/*`: optional third-party tool packs, starting with Notion MCP, that register external capabilities as ordinary Strata tools without adding provider-specific code to the agent loop.

The CLI, TUI, and web chat should be presentation layers over the same agent runtime. Do not duplicate agent-loop behavior inside an interface package.

## Runtime Architecture

Core packages:

- `packages/core`: paths, runtime directories, SQLite-backed `SessionStore`, memory/proposal/skill/todo stores, AGENTS.md instruction loading, and shared JSON/session types.
- `packages/agent`: model adapters, ChatGPT/OpenAI Codex auth, OpenAI-compatible adapter, `runAgentLoopEvents()`, run-context injection, compaction, reflection, and maintenance jobs.
- `packages/tools`: `ToolRegistry`, tool policy/profile handling, wiki tools, filesystem tools, shell tool, memory/todo/session/skill tools.

Key invariant:

`runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` is the source of truth for agent runs. It creates or continues sessions, builds run context, calls the model adapter, executes tools, persists messages/events, emits streaming lifecycle events, and honors cancellation. Interfaces should consume these events rather than reimplementing the loop.

## Runtime State

- `.strata/` contains local runtime state: SQLite DB, traces, auth, memory, Strata-owned skills, proposals, connector checkpoints, and reports.
- `AGENTS.md` and `.agents/skills/**/SKILL.md` are read as project agent guidance. `.agents/skills` is a compatibility skill source; `.strata/skills` remains Strata's own procedural-memory store.
- `.env` may contain dotenvx-encrypted secrets; runtime scripts that need secrets already wrap dotenvx.
- `wiki/raw/` contains immutable raw source snapshots. Agents may read it but should not edit it.
- Legacy `.cortex/` may exist locally from the old project name. New code should use `.strata/`.

## Current Strategic Direction

Near-term work is returning to connector bring-up and raw-to-wiki automation now that the web chat depth slice is usable:

1. Keep Slack ingestion running and continue connector validation in parallel.
2. Treat [web-feature-parity-plan.md](./web-feature-parity-plan.md) as complete: `listModels` lives in `@strata/agent`, repo-file enumeration lives in `@strata/core` as `findRepoFiles`, `chat.files.list` / `chat.models.list` expose those data sources through tRPC, and the web composer now has file `@`-mentions, a persisted model/reasoning picker, slash commands, and prompt history.
3. Treat the web chat polish slice as complete: dropped-stream reconnect/recovery and responsive mobile/tablet/narrow-desktop behavior have been browser-verified.
4. Apply wiki entity consolidation and improve raw-to-wiki extraction quality. `wiki.search` is now curated-first and `wiki.entities` can audit duplicate project topics; next work should merge duplicate canonical topics and strengthen decision/action extraction before expanding connector UI depth.

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
