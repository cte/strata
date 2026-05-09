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
- `packages/web-api`: local Hono + tRPC server for the browser app, connector operations, and planned chat streaming.
- `apps/web`: Vite + React + TanStack Router browser app for connector setup and planned agent chat.
- `packages/ingest`: connector contracts, source pullers, checkpointing, and raw snapshot writers for Notion, Granola, and Slack.

The CLI, TUI, and web chat should be presentation layers over the same agent runtime. Do not duplicate agent-loop behavior inside an interface package.

## Runtime Architecture

Core packages:

- `packages/core`: paths, runtime directories, SQLite-backed `SessionStore`, memory/proposal/skill/todo stores, and shared JSON/session types.
- `packages/agent`: model adapters, ChatGPT/OpenAI Codex auth, OpenAI-compatible adapter, `runAgentLoopEvents()`, run-context injection, compaction, reflection, and maintenance jobs.
- `packages/tools`: `ToolRegistry`, tool policy/profile handling, wiki tools, filesystem tools, shell tool, memory/todo/session/skill tools.

Key invariant:

`runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` is the source of truth for agent runs. It creates or continues sessions, builds run context, calls the model adapter, executes tools, persists messages/events, emits streaming lifecycle events, and honors cancellation. Interfaces should consume these events rather than reimplementing the loop.

## Runtime State

- `.strata/` contains local runtime state: SQLite DB, traces, auth, memory, skills, proposals, connector checkpoints, and reports.
- `.env` may contain dotenvx-encrypted secrets; runtime scripts that need secrets already wrap dotenvx.
- `wiki/raw/` contains immutable raw source snapshots. Agents may read it but should not edit it.
- Legacy `.cortex/` may exist locally from the old project name. New code should use `.strata/`.

## Current Strategic Direction

Near-term work is shifting from connector bring-up to a browser chat foundation:

1. Keep Slack ingestion running and continue connector validation in parallel.
2. Add a web chat interface that streams events from the shared agent loop through `packages/web-api`.
3. Use Vercel AI Elements in `apps/web` for conversation, messages, prompt input, and tool panels.
4. Return to connector UI depth and raw-to-wiki proposal generation after web chat is usable.

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
