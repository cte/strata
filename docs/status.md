# Cortex Implementation Status

Status date: 2026-05-02.

This document tracks where the repo currently stands against [roadmap.md](./roadmap.md). It should be updated whenever a roadmap phase materially changes.

## Current Snapshot

Cortex currently has a Bun/TypeScript monorepo, an initial Markdown wiki skeleton, a bounded model/tool agent loop, ChatGPT/OpenAI Codex auth, SQLite-backed session traces, read/write wiki and filesystem tools, a dangerous-mode shell tool, registry profiles, file-change trace events, and a first-party TUI package.

The system is not yet a self-maintaining wiki agent. The next major gap is the learning surface: todo state, persistent memory, session-search tools, skills, reflection, and scheduled maintenance.

## Roadmap Status

| Roadmap area | Status | Current implementation | Next work |
|---|---:|---|---|
| Work wiki skeleton | Mostly present | Wiki Markdown files and directories live under `wiki/`, including `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/actions/`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/raw/`. | Continue schema and content quality work after the harness can safely maintain pages. |
| Source connectors | Partial | TypeScript scripts exist under `packages/ingest/` for Granola, Slack, Notion, and wiki linting. | Defer deeper ingestion automation until the harness has guarded write tools and learning loops. |
| Bun workspace | Present | Packages exist for `@cortex/core`, `@cortex/agent`, `@cortex/tools`, `@cortex/cli`, `@cortex/tui`, and `@cortex/ingest`. | Keep package boundaries stable while adding tools and learning modules. |
| Model/auth layer | Present | OpenAI-compatible and ChatGPT/OpenAI Codex auth code exists in `packages/agent`; CLI exposes auth commands. | Improve provider UX in the TUI as the runtime matures. |
| Agent loop | Present, read-only oriented | `packages/agent/src/agentLoop.ts` runs bounded model/tool iterations, records sessions, and records `file.changed` events when write tools mutate files. Current default system prompt tells the agent this phase is read-only. | Generalize context construction for memory, skills, active todos, and richer tool profiles. |
| Session storage | Present | `packages/core/src/sessionStore.ts` persists sessions, messages, events, and JSONL traces in `.cortex/`. | Add FTS-backed session recall and expose it as tools. |
| Tool registry | Partial | `packages/tools/src/registry.ts` registers and safely executes tools with modes, read-only/maintenance/learning/dangerous profiles, structured text-argument parsing, and result truncation. | Add availability checks, stronger schema validation, and richer tool context. |
| Current tools | Read/write/shell foundation present | Registered read tools are `wiki.listPages`, `wiki.readPage`, `wiki.search`, `fs.list`, `fs.read`, `fs.find`, and `fs.grep`. Registered write tools are `fs.write`, `fs.edit`, `wiki.writePage`, `wiki.patchPage`, `wiki.appendLog`, and `wiki.updateIndex`. `shell.run` is registered in the `dangerous` profile. Wiki and filesystem tools share the repo path-policy seam. Filesystem tools skip blocked runtime/build directories, reject symlink reads, reject binary reads, require `includeRaw` for raw reads, and forbid raw writes. | Add learning/session tools. |
| Shell tool | Present, dangerous-only | `shell.run` runs arbitrary shell command strings with no command allowlist or denylist. It defaults to the repo root, accepts relative or absolute cwd, captures exit code, timeout state, duration, stdout/stderr previews, and truncation metadata. | Wire shell usage into agent workflows once context construction is generalized. |
| Todo tool | Not implemented | No session todo tool exists. | Add Hermes-style todo state and inject active todos into agent context. |
| Memory | Storage dirs only | `.cortex/memory` is created by runtime setup, but no memory tool or prompt injection exists. | Add `memory.*` tools and bounded user/project memory files. |
| Skills | Storage dirs only | `.cortex/skills` is created by runtime setup, but no skill tools exist. | Add `skills.list`, `skills.read`, and guarded create/update/delete tools. |
| Session search tools | CLI only, basic | CLI can list/search sessions using simple database queries. No agent-callable session recall exists. | Add `sessions.recent` and `sessions.search`, then upgrade search to SQLite FTS. |
| Reflection/curator loop | Not implemented | No post-run learning review exists. | Add `cortex learn reflect <session-id>` and proposal staging. |
| Scheduled maintenance | Not implemented | No cron-style scheduler exists. | Add recurring maintenance jobs for wiki hygiene, stale actions, memory review, skill curation, and index refresh. |
| TUI | Partial | `packages/tui` exists with terminal/runtime/editor/app/auth/session components and tests. | Continue wiring richer agent events, tool renderers, learning state, and scheduler visibility. |

## Immediate Next Milestone

The next milestone is the first learning-state tool slice:

1. Add session todo state and `todo.*` tools.
2. Add `memory.*` tools backed by bounded `.cortex/memory/USER.md` and `.cortex/memory/OPERATIONS.md`.
3. Add `sessions.recent` and `sessions.search` as agent-callable recall tools.
4. Add initial `skills.list` and `skills.read` tools for `.cortex/skills`.
5. Inject active todos, memory summaries, and a compact skill index into agent context after the tools exist.

Completing this milestone starts the durable learning loop: the agent can carry active work, remember stable facts, and recall prior sessions.
