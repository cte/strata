# Cortex Implementation Status

Status date: 2026-05-02.

This document tracks where the repo currently stands against [roadmap.md](./roadmap.md). It should be updated whenever a roadmap phase materially changes.

## Current Snapshot

Cortex currently has a Bun/TypeScript monorepo, an initial Markdown wiki skeleton, a bounded model/tool agent loop, ChatGPT/OpenAI Codex auth, SQLite-backed session traces, a small read-only wiki toolset, and a first-party TUI package.

The system is not yet a self-maintaining wiki agent. The next major gap is the expanded tool and learning surface: safe filesystem tools, guarded write/edit tools, shell execution, todo state, persistent memory, session-search tools, skills, reflection, and scheduled maintenance.

## Roadmap Status

| Roadmap area | Status | Current implementation | Next work |
|---|---:|---|---|
| Work wiki skeleton | Mostly present | Wiki Markdown files and directories live under `wiki/`, including `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/actions/`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/raw/`. | Continue schema and content quality work after the harness can safely maintain pages. |
| Source connectors | Partial | TypeScript scripts exist under `packages/ingest/` for Granola, Slack, Notion, and wiki linting. | Defer deeper ingestion automation until the harness has guarded write tools and learning loops. |
| Bun workspace | Present | Packages exist for `@cortex/core`, `@cortex/agent`, `@cortex/tools`, `@cortex/cli`, `@cortex/tui`, and `@cortex/ingest`. | Keep package boundaries stable while adding tools and learning modules. |
| Model/auth layer | Present | OpenAI-compatible and ChatGPT/OpenAI Codex auth code exists in `packages/agent`; CLI exposes auth commands. | Improve provider UX in the TUI as the runtime matures. |
| Agent loop | Present, read-only oriented | `packages/agent/src/agentLoop.ts` runs bounded model/tool iterations and records sessions. Current system prompt tells the agent this phase is read-only. | Generalize context construction for memory, skills, active todos, and richer tool profiles. |
| Session storage | Present | `packages/core/src/sessionStore.ts` persists sessions, messages, events, and JSONL traces in `.cortex/`. | Add FTS-backed session recall and expose it as tools. |
| Tool registry | Basic | `packages/tools/src/registry.ts` registers and safely executes tools with modes and result truncation. | Add registry profiles, availability checks, stronger schema validation, and richer tool context. |
| Current tools | Basic read-only wiki tools | Registered tools are `wiki.listPages`, `wiki.readPage`, and `wiki.search`. | Add Pi-style `fs.read`, `fs.list`, `fs.find`, `fs.grep`, then guarded `fs.edit` and `fs.write`. |
| Shell tool | Not implemented | No agent-callable shell tool exists. | Add gated Pi-style `shell.run` for tests, formatting, and local automation. |
| Todo tool | Not implemented | No session todo tool exists. | Add Hermes-style todo state and inject active todos into agent context. |
| Memory | Storage dirs only | `.cortex/memory` is created by runtime setup, but no memory tool or prompt injection exists. | Add `memory.*` tools and bounded user/project memory files. |
| Skills | Storage dirs only | `.cortex/skills` is created by runtime setup, but no skill tools exist. | Add `skills.list`, `skills.read`, and guarded create/update/delete tools. |
| Session search tools | CLI only, basic | CLI can list/search sessions using simple database queries. No agent-callable session recall exists. | Add `sessions.recent` and `sessions.search`, then upgrade search to SQLite FTS. |
| Reflection/curator loop | Not implemented | No post-run learning review exists. | Add `cortex learn reflect <session-id>` and proposal staging. |
| Scheduled maintenance | Not implemented | No cron-style scheduler exists. | Add recurring maintenance jobs for wiki hygiene, stale actions, memory review, skill curation, and index refresh. |
| TUI | Partial | `packages/tui` exists with terminal/runtime/editor/app/auth/session components and tests. | Continue wiring richer agent events, tool renderers, learning state, and scheduler visibility. |

## Immediate Next Milestone

The next milestone is the tool expansion milestone:

1. Add registry profiles for read-only, maintenance, learning, and dangerous tool sets.
2. Add safe Pi-style filesystem read/search tools.
3. Preserve Cortex repo-boundary and raw-source immutability policies.
4. Keep existing wiki tools as focused wrappers on top of the broader file tools.
5. Add tests for policy behavior, truncation, path handling, and registry profile filtering.

Completing this milestone moves Cortex from a read-only wiki query harness toward a maintainable local agent runtime.
