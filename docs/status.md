# Cortex Implementation Status

Status date: 2026-05-05.

This document tracks where the repo currently stands against [roadmap.md](./roadmap.md). It should be updated whenever a roadmap phase materially changes.

## Current Snapshot

Cortex currently has a Bun/TypeScript monorepo, an initial Markdown wiki skeleton, a model/tool agent loop, ChatGPT/OpenAI Codex auth, SQLite-backed session traces, read/write wiki and filesystem tools, a dangerous-mode shell tool, registry profiles, file-change trace events, basic learning-state tools, run-context injection, a basic post-run reflection loop, manual maintenance jobs, a trace-backed Notion raw snapshot command, a first-party TUI package, and a planned local web control plane for connector setup.

The system is not yet a self-maintaining wiki agent. The next major gap is closing the maintenance loop: Cortex can now run named maintenance jobs manually and persist their traces, but it does not yet have proposal review/apply commands or cron-style recurring execution.

## Roadmap Status

| Roadmap area | Status | Current implementation | Next work |
|---|---:|---|---|
| Work wiki skeleton | Mostly present | Wiki Markdown files and directories live under `wiki/`, including `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/actions/`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/raw/`. | Continue schema and content quality work after the harness can safely maintain pages. |
| Source connectors | Partial | TypeScript scripts exist under `packages/ingest/` for Granola, Slack, Notion, and wiki linting. Notion has an importable `@cortex/ingest/notion` module plus `cortex ingest notion --page-id <id-or-url>` for trace-backed snapshots into `wiki/raw/notion/`. | Add shared connector contracts, raw-to-wiki Notion ingest, and then bring Granola and Slack through the same trace-backed path. |
| Bun workspace | Present | Packages exist for `@cortex/core`, `@cortex/agent`, `@cortex/tools`, `@cortex/cli`, `@cortex/tui`, and `@cortex/ingest`. | Keep package boundaries stable while adding tools and learning modules. |
| Model/auth layer | Present | OpenAI-compatible and ChatGPT/OpenAI Codex auth code exists in `packages/agent`; CLI exposes auth commands. | Improve provider UX in the TUI as the runtime matures. |
| Agent loop | Present, learning-context aware | `packages/agent/src/agentLoop.ts` runs model/tool iterations until final answer, cancellation, or model/tool failure; records sessions; records `file.changed` events when write tools mutate files; and uses `packages/agent/src/runContext.ts` to inject memory, active todos, and a compact skill index. The current run context is recorded as `message.system_context`. | Add automatic post-run reflection once the manual reflection flow has more mileage. |
| Session storage | Present | `packages/core/src/sessionStore.ts` persists sessions, messages, events, and JSONL traces in `.cortex/`. | Upgrade session recall to SQLite FTS with snippets/ranking. |
| Tool registry | Partial | `packages/tools/src/registry.ts` registers and safely executes tools with modes, read-only/maintenance/learning/dangerous profiles, structured text-argument parsing, and result truncation. The default runtime registry is dangerous; callers can still request narrower profiles explicitly. | Add availability checks, stronger schema validation, and richer tool context. |
| Current tools | Read/write/shell/learning foundation present | Registered read tools are `wiki.listPages`, `wiki.readPage`, `wiki.search`, `fs.list`, `fs.read`, `fs.find`, `fs.grep`, `todo.list`, `memory.read`, `sessions.recent`, `sessions.search`, `skills.list`, and `skills.read`. Registered write tools are `fs.write`, `fs.edit`, `wiki.writePage`, `wiki.patchPage`, `wiki.appendLog`, and `wiki.updateIndex`. Registered learning tools are `todo.add`, `todo.update`, `todo.remove`, `memory.write`, and `memory.append`. `shell.run` is registered in the `dangerous` profile. | Add proposal review/apply commands and richer TUI renderers for learning updates. |
| Shell tool | Present, dangerous-only | `shell.run` runs arbitrary shell command strings with no command allowlist or denylist. It defaults to the repo root, accepts relative or absolute cwd, captures exit code, timeout state, duration, stdout/stderr previews, and truncation metadata. | Wire shell usage into agent workflows once context construction is generalized. |
| Todo tool | Basic present | `.cortex/todos.json` stores active todo state. `todo.list` is read-only; `todo.add`, `todo.update`, and `todo.remove` are learning tools. Active non-completed todos are injected into agent context. | Add reflection-driven todo updates and better TUI visibility. |
| Memory | Basic present | `.cortex/memory/USER.md` and `.cortex/memory/OPERATIONS.md` are readable with `memory.read` and mutable with bounded `memory.write`/`memory.append`. Bounded memory content is injected into agent context. Manual reflection can auto-apply duplicate-aware low-risk memory entries. | Add duplicate/staleness review and proposal apply/reject flow. |
| Skills | Basic read path present | `.cortex/skills/<skill>/SKILL.md` can be listed and read with `skills.list` and `skills.read`; the compact skill index is injected into agent context. Manual reflection can stage skill update proposals. | Add seeded skills, proposal apply/reject flow, and later guarded skill create/update/delete tools. |
| Session search tools | Basic present | CLI and agent tools can list/search sessions using the current simple database queries. `sessions.recent` and `sessions.search` exclude the current session by default. | Upgrade search to SQLite FTS with snippets/ranking. |
| Reflection/curator loop | Basic reflection present | `cortex learn reflect <session-id>` reads a completed trace, asks the configured model for structured learning classifications, auto-applies duplicate-aware low-risk memory/todo updates, stages skill/schema/wiki/lint proposals under `.cortex/proposals/`, writes `.cortex/reports/reflections/<session-id>.json`, and records `reflection.*` / `proposal.created` events back to the trace. | Add reflection triggering after agent runs, richer proposal review/apply commands, and curator passes for stale/duplicated memory and skills. |
| Scheduled maintenance | Manual slice present | `cortex maintain list` and `cortex maintain run <job>` exist. Initial jobs are `wiki.lint`, `actions.review`, `memory.review`, `skills.inventory`, and `index.refresh`. Runs persist as `maintain` sessions with `maintenance.*` trace events and JSON reports under `.cortex/reports/maintenance/`. `index.refresh` can stage a wiki proposal when index references appear stale. | Add proposal review/apply commands, then cron-style recurring execution for stable maintenance jobs. |
| TUI | Partial | `packages/tui` exists with terminal/runtime/editor/app/auth/session components and tests. | Continue wiring richer agent events, tool renderers, learning state, and scheduler visibility. |
| Web control plane | Planned | No web app exists yet. Requirement captured in [web-control-plane-plan.md](./web-control-plane-plan.md): local-only browser UI for connector setup/status, dry-runs, schedules, ingest history, and proposal review. | Wait until connector contracts and at least one raw-to-wiki workflow are stable, then add `apps/web` or equivalent on top of shared packages. |

## Immediate Next Milestone

The current implementation focus is the Notion ingestion follow-through slice:

1. Validate `cortex ingest notion --page-id <id-or-url>` against a real shared Notion page.
2. Define a small shared connector contract for config schema, validation/status, pull/dry-run, and trace-backed results.
3. Add a Notion raw-to-wiki ingest workflow that reads `wiki/raw/notion/*.md`, extracts durable people/projects/decisions/actions/threads, updates wiki pages, and appends to `wiki/log.md`.
4. Keep broad or ambiguous wiki changes staged as proposals until proposal review commands exist.
5. Use the same trace-backed ingestion pattern for Granola and Slack after the Notion path is stable.
6. Defer the web control plane until the shared connector and raw-to-wiki contracts are stable enough to expose in a UI.

Completing this milestone turns Notion from a raw source snapshot into maintained wiki knowledge.
