# AGENTS.md

This is the root instruction file for agents working in this repository. `CLAUDE.md` is a compatibility symlink to this file, so keep this document tool-agnostic and useful for any coding agent.

## What We Are Building

Strata is a local, agent-maintained personal work system.

It has two connected parts:

1. A Markdown work wiki that captures the user's priorities, projects, people, meetings, decisions, open threads, action items, and source material.
2. A Bun/TypeScript agentic harness that can query, maintain, and improve that wiki through explicit tools, durable traces, memory, skills, scheduled maintenance jobs, a TUI, a local browser chat UI, and a local web control plane for connector setup.

The wiki is the durable knowledge base. The harness is the working system that keeps that knowledge base useful.

In one sentence: Strata is a local Bun/TypeScript agent that helps the user remember, understand, and maintain their work context by operating on a Markdown wiki with safe tools and durable learning loops.

## How The Roadmap Works

Start with [docs/app-overview.md](docs/app-overview.md) for a short orientation, then read [docs/roadmap.md](docs/roadmap.md). The roadmap is the canonical top-level plan: product definition, system layers, design commitments, near-term sequencing, and reference implementation strategy.

Use [docs/status.md](docs/status.md) to understand where implementation currently stands against the roadmap. Update it whenever a roadmap area materially changes.

The detailed plans are subordinate to the roadmap:

- [docs/wiki-plan.md](docs/wiki-plan.md): wiki structure, source ingestion, entity schemas, and maintenance workflows.
- [docs/agent-harness-plan.md](docs/agent-harness-plan.md): model loop, tools, memory, skills, traces, and learning architecture.
- [docs/tui-plan.md](docs/tui-plan.md): terminal UI architecture and implementation direction.
- [docs/web-chat-plan.md](docs/web-chat-plan.md): local browser chat over the shared agent loop.
- [docs/web-control-plane-plan.md](docs/web-control-plane-plan.md): local browser UI for connector setup, schedules, ingest history, and proposal review.

When plans conflict, update `docs/roadmap.md` first, then reconcile `docs/status.md` and the relevant detailed plan.

The current implementation focus is documented in `docs/status.md`. At the time this file was last updated, the next milestone was the web chat foundation over the shared agent loop.

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
bun run web:api
bun run web:dev
bun run build
```

The CLI currently exposes `auth status|login|logout`, `init`, `query`, `tui`, `trace`, `sessions list|search`, and `tools list|call`. Use `bun run strata --help` for the source of truth.

## Workspace Layout

```text
packages/
  core/    SessionStore, JsonValue/SessionRecord types, paths, runtime dirs
  tools/   ToolRegistry, policy guards, current wiki read/search tools
  agent/   ModelAdapter contract, OpenAI adapters, ChatGPT OAuth, agent loop
  tui/     First-party terminal UI runtime, components, editor, app
  cli/     strata command-line entrypoint
  ingest/  Source and wiki scripts: lintWiki, pullGranola, pullSlack, pullNotion
  web-api/ Local HTTP API for connector setup and operations
  e2e/     End-to-end TUI/agent tests driven through FakeTerminal
apps/
  web/     Vite/React/TanStack Router local control-plane UI
docs/      Roadmap and implementation status
.strata/   Local runtime state: sqlite DB, traces, auth, memory, skills, proposals, reports
```

Workspace dependencies use `workspace:*`. Cross-package imports use `@strata/<pkg>` and `@strata/<pkg>/<subpath>`, with subpath exports declared in each package's `package.json`.

## Architecture Invariants

The agent loop is the source of truth. `runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` drives a single run, owns session creation, seeds messages, enforces iteration/tool budgets, honors abort signals, emits lifecycle events, and persists state. `runAgentLoop()` is a thin consumer. Do not duplicate loop logic.

Cancellation is end-to-end. `AgentRunConfig.signal` and `ModelRequest.signal` flow into model adapters and are checked by the loop at iteration and tool-call boundaries. Cancelled runs should end as `interrupted` with `stoppedReason: "cancelled"`.

Session storage is centralized. Use `SessionStore.open(repoRoot?)`; runs persist to `.strata/state.sqlite` and `.strata/traces/<sessionId>.jsonl`.

Tools use dotted names, JSON-schema inputs, a `mode` (`read`, `write`, `learning`, or `dangerous`), and optional `maxResultChars`. Execute tools through `registry.safeExecute()` so tool failures become structured `ToolExecutionResult` values.

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
