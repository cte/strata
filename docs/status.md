# Cortex Implementation Status

Status date: 2026-05-04.

This document tracks where the repo currently stands against [roadmap.md](./roadmap.md). It should be updated whenever a roadmap phase materially changes.

## Current Snapshot

Cortex currently has a Bun/TypeScript monorepo, an initial Markdown wiki skeleton, a bounded model/tool agent loop, ChatGPT/OpenAI Codex auth, SQLite-backed session traces, read/write wiki and filesystem tools, a dangerous-mode shell tool, registry profiles, file-change trace events, basic learning-state tools, run-context injection, and a first-party TUI package.

The system is not yet a self-maintaining wiki agent. The next major gap is the reflection loop: completed sessions should be reviewed so stable facts, procedural lessons, and follow-up work can become durable memory, skill proposals, or todos.

## Roadmap Status

| Roadmap area | Status | Current implementation | Next work |
|---|---:|---|---|
| Work wiki skeleton | Mostly present | Wiki Markdown files and directories live under `wiki/`, including `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/actions/`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/raw/`. | Continue schema and content quality work after the harness can safely maintain pages. |
| Source connectors | Partial | TypeScript scripts exist under `packages/ingest/` for Granola, Slack, Notion, and wiki linting. | Defer deeper ingestion automation until the harness has guarded write tools and learning loops. |
| Bun workspace | Present | Packages exist for `@cortex/core`, `@cortex/agent`, `@cortex/tools`, `@cortex/cli`, `@cortex/tui`, and `@cortex/ingest`. | Keep package boundaries stable while adding tools and learning modules. |
| Model/auth layer | Present | OpenAI-compatible and ChatGPT/OpenAI Codex auth code exists in `packages/agent`; CLI exposes auth commands. | Improve provider UX in the TUI as the runtime matures. |
| Agent loop | Present, learning-context aware | `packages/agent/src/agentLoop.ts` runs bounded model/tool iterations, records sessions, records `file.changed` events when write tools mutate files, and uses `packages/agent/src/runContext.ts` to inject memory, active todos, and a compact skill index. The current run context is recorded as `message.system_context`. | Add a post-run reflection hook that can inspect traces and stage or apply learning updates. |
| Session storage | Present | `packages/core/src/sessionStore.ts` persists sessions, messages, events, and JSONL traces in `.cortex/`. | Add FTS-backed session recall and expose it as tools. |
| Tool registry | Partial | `packages/tools/src/registry.ts` registers and safely executes tools with modes, read-only/maintenance/learning/dangerous profiles, structured text-argument parsing, and result truncation. The default runtime registry is dangerous; callers can still request narrower profiles explicitly. | Add availability checks, stronger schema validation, and richer tool context. |
| Current tools | Read/write/shell/learning foundation present | Registered read tools are `wiki.listPages`, `wiki.readPage`, `wiki.search`, `fs.list`, `fs.read`, `fs.find`, `fs.grep`, `todo.list`, `memory.read`, `sessions.recent`, `sessions.search`, `skills.list`, and `skills.read`. Registered write tools are `fs.write`, `fs.edit`, `wiki.writePage`, `wiki.patchPage`, `wiki.appendLog`, and `wiki.updateIndex`. Registered learning tools are `todo.add`, `todo.update`, `todo.remove`, `memory.write`, and `memory.append`. `shell.run` is registered in the `dangerous` profile. | Add reflection tools/commands and richer tool renderers for learning updates. |
| Shell tool | Present, dangerous-only | `shell.run` runs arbitrary shell command strings with no command allowlist or denylist. It defaults to the repo root, accepts relative or absolute cwd, captures exit code, timeout state, duration, stdout/stderr previews, and truncation metadata. | Wire shell usage into agent workflows once context construction is generalized. |
| Todo tool | Basic present | `.cortex/todos.json` stores active todo state. `todo.list` is read-only; `todo.add`, `todo.update`, and `todo.remove` are learning tools. Active non-completed todos are injected into agent context. | Add reflection-driven todo updates and better TUI visibility. |
| Memory | Basic present | `.cortex/memory/USER.md` and `.cortex/memory/OPERATIONS.md` are readable with `memory.read` and mutable with bounded `memory.write`/`memory.append`. Bounded memory content is injected into agent context. | Add reflection-driven memory proposals and duplicate/staleness review. |
| Skills | Basic read path present | `.cortex/skills/<skill>/SKILL.md` can be listed and read with `skills.list` and `skills.read`; the compact skill index is injected into agent context. | Add seeded skills, proposal-based skill updates, and later guarded skill create/update/delete tools. |
| Session search tools | Basic present | CLI and agent tools can list/search sessions using the current simple database queries. `sessions.recent` and `sessions.search` exclude the current session by default. | Upgrade search to SQLite FTS with snippets/ranking. |
| Reflection/curator loop | Not implemented | No post-run learning review exists. | Add `cortex learn reflect <session-id>` and proposal staging. |
| Scheduled maintenance | Not implemented | No cron-style scheduler exists. | Add recurring maintenance jobs for wiki hygiene, stale actions, memory review, skill curation, and index refresh. |
| TUI | Partial | `packages/tui` exists with terminal/runtime/editor/app/auth/session components and tests. | Continue wiring richer agent events, tool renderers, learning state, and scheduler visibility. |

## Immediate Next Milestone

The next milestone is the first reflection loop:

1. Add a reflection command that can inspect a completed session trace.
2. Classify lessons into memory updates, skill updates, todo updates, wiki/schema proposals, or no-op.
3. Stage reviewable proposals under `.cortex/proposals/` before broad skill/wiki/schema changes.
4. Auto-apply only narrow low-risk memory/todo updates after bounded validation.
5. Record reflection decisions back into the session trace so learning remains auditable.

Completing this milestone makes the learning loop active: Cortex will not just expose memory and skills, it will start improving them from experience.
