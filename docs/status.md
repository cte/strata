# Strata Implementation Status

Status date: 2026-05-09.

This document tracks where the repo currently stands against [roadmap.md](./roadmap.md). It should be updated whenever a roadmap phase materially changes.

## Current Snapshot

Strata currently has a Bun/TypeScript monorepo, an initial Markdown wiki skeleton, a model/tool agent loop, ChatGPT/OpenAI Codex auth, SQLite-backed session traces, read/write wiki and filesystem tools, a dangerous-mode shell tool, registry profiles, file-change trace events, basic learning-state tools, run-context injection, a basic post-run reflection loop, manual maintenance jobs, a trace-backed Notion raw snapshot command, a first-party TUI package, a shared connector runtime foundation, a Slack backfill/listen foundation, and a local web control-plane skeleton. A browser chat interface over the shared agent loop is now planned but not implemented.

The system is not yet a self-maintaining wiki agent. The next major gap is closing the maintenance loop: Strata can now run named maintenance jobs manually and persist their traces, but it does not yet have proposal review/apply commands or cron-style recurring execution.

## Roadmap Status

| Roadmap area | Status | Current implementation | Next work |
|---|---:|---|---|
| Work wiki skeleton | Mostly present | Wiki Markdown files and directories live under `wiki/`, including `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/actions/`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/raw/`. | Continue schema and content quality work after the harness can safely maintain pages. |
| Source connectors | Partial | TypeScript scripts exist under `packages/ingest/` for Granola, Slack, Notion, and wiki linting. `@strata/ingest/connectors` now exposes connector types, registry, local secret store, local checkpoint store, and a trace-backed runner. Notion has validation, dry-run, and pull operations plus `strata ingest notion --page-id <id-or-url>` through the shared runner. Granola credential status/configuration and raw meeting pulls now live in `@strata/ingest`, with secrets under `.strata/secrets/granola.json` and `strata ingest granola`. Slack now supports explicit thread pulls, checkpointed conversation sync, and a basic Socket Mode listener through `strata ingest slack`. | Validate the three connectors against real source accounts, then add persisted non-secret config, web pull controls, scheduled pulls, and raw-to-wiki proposal generation. |
| Bun workspace | Present | Packages exist for `@strata/core`, `@strata/agent`, `@strata/tools`, `@strata/cli`, `@strata/tui`, `@strata/ingest`, and `@strata/web-api`. `apps/web` exists as the Vite/React control-plane app. | Keep package boundaries stable while adding connector config, scheduler, and proposal APIs. |
| Model/auth layer | Present | OpenAI-compatible and ChatGPT/OpenAI Codex auth code exists in `packages/agent`; CLI exposes auth commands. | Improve provider UX in the TUI as the runtime matures. |
| Agent loop | Present, learning-context aware | `packages/agent/src/agentLoop.ts` runs model/tool iterations until final answer, cancellation, or model/tool failure; records sessions; records `file.changed` events when write tools mutate files; and uses `packages/agent/src/runContext.ts` to inject memory, active todos, and a compact skill index. The current run context is recorded as `message.system_context`. | Add automatic post-run reflection once the manual reflection flow has more mileage. |
| Session storage | Present | `packages/core/src/sessionStore.ts` persists sessions, messages, events, and JSONL traces in `.strata/`. | Upgrade session recall to SQLite FTS with snippets/ranking. |
| Tool registry | Partial | `packages/tools/src/registry.ts` registers and safely executes tools with modes, read-only/maintenance/learning/dangerous profiles, structured text-argument parsing, and result truncation. The default runtime registry is dangerous; callers can still request narrower profiles explicitly. | Add availability checks, stronger schema validation, and richer tool context. |
| Current tools | Read/write/shell/learning foundation present | Registered read tools are `wiki.listPages`, `wiki.readPage`, `wiki.search`, `fs.list`, `fs.read`, `fs.find`, `fs.grep`, `todo.list`, `memory.read`, `sessions.recent`, `sessions.search`, `skills.list`, and `skills.read`. Registered write tools are `fs.write`, `fs.edit`, `wiki.writePage`, `wiki.patchPage`, `wiki.appendLog`, and `wiki.updateIndex`. Registered learning tools are `todo.add`, `todo.update`, `todo.remove`, `memory.write`, and `memory.append`. `shell.run` is registered in the `dangerous` profile. | Add proposal review/apply commands and richer TUI renderers for learning updates. |
| Shell tool | Present, dangerous-only | `shell.run` runs arbitrary shell command strings with no command allowlist or denylist. It defaults to the repo root, accepts relative or absolute cwd, captures exit code, timeout state, duration, stdout/stderr previews, and truncation metadata. | Wire shell usage into agent workflows once context construction is generalized. |
| Todo tool | Basic present | `.strata/todos.json` stores active todo state. `todo.list` is read-only; `todo.add`, `todo.update`, and `todo.remove` are learning tools. Active non-completed todos are injected into agent context. | Add reflection-driven todo updates and better TUI visibility. |
| Memory | Basic present | `.strata/memory/USER.md` and `.strata/memory/OPERATIONS.md` are readable with `memory.read` and mutable with bounded `memory.write`/`memory.append`. Bounded memory content is injected into agent context. Manual reflection can auto-apply duplicate-aware low-risk memory entries. | Add duplicate/staleness review and proposal apply/reject flow. |
| Skills | Basic read path present | `.strata/skills/<skill>/SKILL.md` can be listed and read with `skills.list` and `skills.read`; the compact skill index is injected into agent context. Manual reflection can stage skill update proposals. | Add seeded skills, proposal apply/reject flow, and later guarded skill create/update/delete tools. |
| Session search tools | Basic present | CLI and agent tools can list/search sessions using the current simple database queries. `sessions.recent` and `sessions.search` exclude the current session by default. | Upgrade search to SQLite FTS with snippets/ranking. |
| Reflection/curator loop | Basic reflection present | `strata learn reflect <session-id>` reads a completed trace, asks the configured model for structured learning classifications, auto-applies duplicate-aware low-risk memory/todo updates, stages skill/schema/wiki/lint proposals under `.strata/proposals/`, writes `.strata/reports/reflections/<session-id>.json`, and records `reflection.*` / `proposal.created` events back to the trace. | Add reflection triggering after agent runs, richer proposal review/apply commands, and curator passes for stale/duplicated memory and skills. |
| Scheduled maintenance | Manual slice present | `strata maintain list` and `strata maintain run <job>` exist. Initial jobs are `wiki.lint`, `actions.review`, `memory.review`, `skills.inventory`, and `index.refresh`. Runs persist as `maintain` sessions with `maintenance.*` trace events and JSON reports under `.strata/reports/maintenance/`. `index.refresh` can stage a wiki proposal when index references appear stale. | Add proposal review/apply commands, then cron-style recurring execution for stable maintenance jobs. |
| TUI | Partial | `packages/tui` exists with terminal/runtime/editor/app/auth/session components and tests. | Continue wiring richer agent events, tool renderers, learning state, and scheduler visibility. |
| Web chat | Planned | [web-chat-plan.md](./web-chat-plan.md) defines the target architecture: `apps/web` renders a local browser chat with Vercel AI Elements, `packages/web-api` streams browser-safe events, and each submitted turn invokes the shared `runAgentLoopEvents()` server-side. | Extract shared model-adapter construction, add chat streaming/cancel endpoints, install AI Elements components, and add the `/chat` route. |
| Web control plane | Skeleton present | `packages/web-api` is a Hono local API with a tRPC router for connector list and Notion validate/dry-run/pull, plus compatibility JSON endpoints for smoke tests. Notion dry-run/pull now delegates to the shared connector runner instead of duplicating session logic. It also has an experimental Notion MCP OAuth flow that stores local refresh credentials in `.strata/secrets/notion-mcp.json` and can list hosted Notion MCP tools. Granola API key configuration now calls the shared ingest connector secret store. `apps/web` is a Vite + React + TanStack Router app with shadcn-style owned components using Base UI primitives and connector setup pages that consume the shared `AppRouter` type. | Validate Notion MCP against a real workspace, decide whether MCP should remain agent-tool-only or become part of ingestion, then add Granola/Slack web pull controls, recent ingest sessions, schedules, and proposals. |

## Immediate Next Milestone

The current implementation focus is the web chat foundation while Slack ingestion continues running and connector validation continues in parallel:

1. Extract shared model-adapter construction so CLI, TUI, and web API use the same provider defaults and ChatGPT/OpenAI-compatible auth behavior.
2. Add a `packages/web-api` chat service with an active-run registry, one-active-run-per-session guard, and cancellation support.
3. Add `POST /api/chat/runs` as a streaming endpoint over `runAgentLoopEvents()`.
4. Add tRPC chat metadata procedures for model status, recent sessions, session load, and session search.
5. Install Vercel AI Elements components into `apps/web` and add a `/chat` route with conversation, messages, prompt input, and generic tool panels.
6. Verify a browser message streams assistant deltas, shows tool states, persists a Strata session, and supports follow-up continuation.

After the chat foundation is usable, return to the connector bring-up slice: validate Notion, Granola, and Slack against real accounts; add persisted non-secret connector config; show recent ingest sessions in the web UI; and add the first raw-to-wiki proposal workflow.

## Resume Here

The next agent should start with the first web chat foundation task, not with connector UI work:

1. Read [app-overview.md](./app-overview.md), [roadmap.md](./roadmap.md), [web-chat-plan.md](./web-chat-plan.md), and this status file.
2. Inspect the duplicated model-adapter construction in `packages/cli/src/index.ts` and `packages/tui/src/app/modelFactory.ts`.
3. Extract the shared provider/model adapter factory into `packages/agent` or another server-safe shared module.
4. Update CLI and TUI callers to use the shared factory without changing user-facing behavior.
5. Add or adjust tests around provider inference and missing-auth/missing-key behavior before moving to the web API streaming endpoint.

Do not implement web chat by spawning the CLI. The target path is `apps/web` -> `packages/web-api` -> `runAgentLoopEvents()`.
