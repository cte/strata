# AGENTS.md

This is the root instruction file for agents working in this repository. `CLAUDE.md` is a compatibility symlink to this file, so keep this document tool-agnostic and useful for any coding agent.

## What We Are Building

Strata is a local, agent-maintained personal work system.

It has two connected parts:

1. A Markdown work wiki that captures the user's priorities, projects, people, meetings, decisions, open threads, action items, and source material.
2. A Bun/TypeScript agentic harness that can query, maintain, improve, and locally extend that wiki through explicit tools, durable traces, memory, skills, scheduled jobs, extensions, a TUI, a local browser chat UI, and a local web control plane for connector setup.

The wiki is the durable knowledge base. The harness is the working system that keeps that knowledge base useful.

In one sentence: Strata is a local Bun/TypeScript agent that helps the user remember, understand, and maintain their work context by operating on a Markdown wiki with safe tools and durable learning loops.

## How The Roadmap Works

Start with [docs/app-overview.md](docs/app-overview.md) for a short orientation, then read [docs/roadmap.md](docs/roadmap.md). The roadmap is the canonical top-level plan: product definition, system layers, design commitments, near-term sequencing, and reference implementation strategy.

Use [docs/status.md](docs/status.md) to understand where implementation currently stands against the roadmap. Update it whenever a roadmap area materially changes.

The detailed plans are subordinate to the roadmap:

- [docs/wiki-plan.md](docs/wiki-plan.md): wiki structure, source ingestion, entity schemas, and maintenance workflows.
- [docs/extraction-framework-plan.md](docs/extraction-framework-plan.md): reset extraction architecture notes; the next action work starts from the action-item schema.
- [docs/routines-plan.md](docs/routines-plan.md): local-first Routine definitions, triggers, structured input/output, artifacts, and the Granola daily TODO routine plan.
- [docs/taxonomy-suggestion-plan.md](docs/taxonomy-suggestion-plan.md): feedback-loop taxonomy suggestions — the daily classification-correction review queue and the LLM suggestion Routine (decision in [docs/adr/0001-taxonomy-suggestion-routine.md](docs/adr/0001-taxonomy-suggestion-routine.md)).
- [docs/agent-harness-plan.md](docs/agent-harness-plan.md): model loop, tools, memory, skills, traces, and learning architecture.
- [docs/interactive-agent-ui-plan.md](docs/interactive-agent-ui-plan.md): native ask-user/user-interaction primitive for TUI, web, and non-interactive runs.
- [docs/tui-plan.md](docs/tui-plan.md): terminal UI architecture and implementation direction.
- [docs/web-chat-plan.md](docs/web-chat-plan.md): local browser chat over the shared agent loop.
- [docs/web-control-plane-plan.md](docs/web-control-plane-plan.md): local browser UI for connector setup, routine triggers, ingest history, and proposal review.
- [docs/tool-packs-mcp-plan.md](docs/tool-packs-mcp-plan.md): external third-party tool-pack architecture and Notion MCP agent-tool plan.
- [docs/extensions-plan.md](docs/extensions-plan.md): Pi-style trusted local extension runtime for tools, commands, hooks, providers, UI affordances, and subagent-style workflows.

When plans conflict, update `docs/roadmap.md` first, then reconcile `docs/status.md` and the relevant detailed plan.

The current implementation focus is documented in `docs/status.md`. At the time this file was last updated, raw-to-wiki indexing could automatically create curated meeting/entity wiki pages from Granola, Notion, and Slack, but automated action extraction had been removed after poor quality results. The next automation milestone is the local-first Routine primitive from `docs/routines-plan.md`; the next action milestone should use a Granola daily TODO Routine to produce schema-valid artifacts before any reviewed write-back to `/actions`.

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

The repo uses `bun@1.3.13`, TypeScript via `@typescript/native-preview` (`tsgo`), Biome for formatting/linting, Knip for unused-code detection, and dotenvx for encrypted local `.env` values. Bun runs `.ts` files directly; there is no `tsc` emit step. `verbatimModuleSyntax` and `exactOptionalPropertyTypes` are enabled. Relative imports use `.js` extensions even when the source files are `.ts`.

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
bun run knip
bun run format
bun run format:check
bun dev
bun run dev:status
bun run dev:logs
bun run dev:stop
bun run strata <args>
bun run strata jobs list
bun run strata routines trigger list <routineId>
bun run web:api
bun run web:dev
bun run build
```

The CLI currently exposes `auth status|login|logout`, `init`, `query`, `tui` with Pi-style session launch flags, `jobs list|run|worker`, `routines list|show|create|update|enable|disable|run|runs|artifacts|trigger`, `trace`, `sessions list|search|delete`, and `tools list|call`. Use `bun run strata --help` for the source of truth.

## Workspace Layout

```text
packages/
  core/        SessionStore, JsonValue/SessionRecord types, paths, runtime dirs
  tools/       ToolRegistry, policy guards, current wiki read/search tools
  agent/       ModelAdapter contract, OpenAI adapters, ChatGPT OAuth, agent loop
  tui/         First-party terminal UI runtime, components, editor, app
  cli/         strata command-line entrypoint
  ingest/      Connector/runtime contracts, raw-to-wiki indexing, taxonomy, and ingest activity normalization
  jobs/        Registered jobs, job runner, durable routine triggers, and scheduler loop
  routines/    Structured Routine definitions, runs, artifacts, triggers, and routine.run orchestration
  terminal-web/      Browser terminal emulator API and renderer
  terminal-backend/  Local PTY shell session and HTTP/SSE terminal bridge
  web-api/     Local HTTP API for chat, connector setup, routines, activity, and operations
  e2e/         End-to-end TUI/agent tests driven through FakeTerminal
  extensions/  Planned Pi-style local extension runtime
apps/
  web/     Vite/React/TanStack Router local control-plane UI
docs/      Roadmap and implementation status
.strata/   Local runtime state: sqlite DB, traces, auth, memory, skills, proposals, reports
```

Workspace dependencies use `workspace:*`. Cross-package imports use `@strata/<pkg>` and `@strata/<pkg>/<subpath>`, with subpath exports declared in each package's `package.json`.

## Architecture Invariants

The agent loop is the source of truth. `runAgentLoopEvents()` in `packages/agent/src/agentLoop.ts` drives a single run, owns session creation, seeds messages, counts iterations/tool calls, honors abort signals, emits lifecycle events, and persists state. `runAgentLoop()` is a thin consumer. Do not duplicate loop logic.

Cancellation is end-to-end. `AgentRunConfig.signal` flows into `ModelRequest.signal` for model adapters and `ToolContext.signal` for tools, and is checked by the loop at iteration and tool-call boundaries. Cancelled runs should end as `interrupted` with `stoppedReason: "cancelled"`.

Mid-run steering is owned by the shared loop, not by a TUI-only after-run queue. `AgentRunConfig.getSteeringMessages` is drained after the current assistant response and any tool calls from that response finish, before the next model request. `AgentRunConfig.getFollowUpMessages` is drained only when the agent has no more tool calls and no steering messages. The TUI mirrors Pi: Enter while running queues steering, Alt+Enter queues follow-up, Alt+Up restores queued messages to the editor, and Escape restores queued messages before aborting the run. Do not reintroduce "send everything only after the run finishes" behavior.

Session storage is centralized. Use `SessionStore.open(repoRoot?)`; runs persist to `.strata/state.sqlite` and `.strata/traces/<sessionId>.jsonl`. Delete sessions through `SessionStore.deleteSession()` so SQLite state and the matching trace file are removed together.

Recurring local automation is a Routine with triggers ([ADR-0002](docs/adr/0002-collapse-schedules-into-routines.md)). A **Routine** is the single automation primitive; its recurring **triggers** are persisted in the `routine_triggers` table (the reshaped successor to `job_schedules`), and the scheduler worker (`@strata/jobs`) claims due triggers before firing `routine.run` for the bound routine. There is no standalone Schedule concept and no `agent.prompt` job — to run a prompt on a cadence, create a Routine and add a trigger. Registered Jobs (`connector.pull`, `raw.index`, `wiki.search-index.refresh`, `wiki.hygiene`, `maintenance.run`) are deterministic operations invoked **by Routines** — guaranteed via `preRunSteps`, or at agent discretion via the `job.run` tool (`maintenance` profile; excludes `routine.run`) — not scheduled directly. Do not add connector-specific daemons or web-request-owned polling loops for recurring source ingestion, and do not reintroduce `job_schedules`/`ScheduleStore`/`agent.prompt`. Wiki hygiene should use the safe `wiki.hygiene`/`maintenance.run` paths that stage review proposals and refresh indexes, not silent page merges.

Ingest observability is trace-backed. Connector, raw-to-wiki, and job activity should be reconstructed from `SessionStore` events through `@strata/ingest/activity`; do not parse `wiki/log.md` or browser state to answer what was ingested, skipped, indexed, or failed. `ingest_activity_runs` is only a local materialized run-list projection of those append-only events for fast list filtering and should be refreshed from events, not treated as the canonical record. Add small redacted append-only events when a connector or indexer lacks the activity metadata the UI/CLI needs.

Raw-to-wiki classification is subject-matter agnostic. Product code may contain generic source parsing, evidence extraction, and safety rules, but workspace vocabulary belongs in the local ingest taxonomy at `.strata/ingest/taxonomy.json` or in reviewed taxonomy proposals. Do not hard-code project aliases, self names, customer/team terms, Slack bot names, or local low-signal phrases in raw-to-wiki TypeScript; load them through `@strata/ingest/ingest-taxonomy`. The taxonomy is grown only through review (reviewer corrections apply immediately; LLM suggestions stage `schema` proposals) — there is no manual taxonomy-config UI, and the legacy `profile.json` path has been removed.

Automated action extraction is currently disabled. `wiki/actions/mine.md`, `wiki/actions/theirs.md`, `@strata/core/wiki-actions`, `wiki.actions.*`, and `/actions` are the clean starting point. Do not reintroduce raw-to-wiki action promotion, Slack-specific action heuristics, browser-only extraction logic, or a new candidate store until the action-item schema and write-back contract have been redesigned.

Routines are the automation primitive. A Routine is a durable local definition with structured input/output schemas, required skills, pre-run Jobs, a tool profile, `routine_triggers`, Routine Runs, schema-valid artifacts, and explicit publication policy. Do not implement routine behavior as a second agent loop or second scheduler; use `runAgentLoopEvents()` for agent work and `@strata/jobs`'s scheduler over `routine_triggers` for scheduled triggers.

Web chat runs are server-side jobs, not HTTP request lifetimes. `packages/web-api/src/chat.ts` owns active-run state and an abort controller per run; browser SSE streams are subscribers. A dropped browser/proxy stream must not cancel the agent. Only explicit run cancellation should abort the run signal.

Web chat run state is write-through durable. `packages/web-api/src/chatRunStore.ts` persists web chat run metadata and SSE event payloads in `.strata/state.sqlite`; SSE frames include event IDs; `GET /api/chat/runs/:runId/events` replays events after a given ID for reconnects; and server startup marks abandoned running rows plus their linked sessions failed with `stoppedReason: "server_restarted"`. Do not make the browser depend only on the in-memory active-run map or the original `POST /api/chat/runs` response stream.

Web chat SSE streams must stay alive while the model is thinking. `packages/web-api/src/server.ts` sends heartbeat comments during quiet periods and configures Bun's server idle timeout above the default, so long model requests do not look like hung or cancelled browser runs.

Web chat lifecycle diagnostics are durable trace events. Run start, browser stream close, explicit cancel requests, and run finish should be appended to the associated `.strata/traces/<sessionId>.jsonl` trace so stopped browser tasks can be debugged after the request is gone.

Cross-process realtime stays local and event-log-driven. The web UI reflects sessions advanced by any process (other browser tabs, CLI, TUI, maintenance, ingest) via a local change feed — `packages/web-api/src/changeFeed.ts` tails the shared `events` table through `SessionStore.sessionChangesSince` and fans out notices over `GET /api/changes`; the browser store reacts by refreshing the sessions list and reloading affected non-client-streamed sessions. This depends on every writer appending to `SessionStore`'s `events` table (which `session.started`/`session.ended`/messages/tools already do). Do not route run persistence around `SessionStore.appendEvent`, and do not replace this with an external/cloud datastore — it is a notification layer over the local SQLite event log, preserving locality.

Web client data fetching goes through React Query, not bespoke `useEffect` loaders. The browser app already wraps everything in a `QueryClientProvider` (`apps/web/src/main.tsx`). Server reads and writes for the control-plane routes flow through typed hooks in `apps/web/src/lib/queries/<domain>.ts`, keyed by the central factory in `apps/web/src/lib/queries/keys.ts` (`qk`). Rules:

- `apps/web/src/lib/api.ts` is the transport layer only — thin typed tRPC wrappers (`listX`, `getX`, `createX`). Do not call those functions directly from route components or hand-roll `useState`/`useEffect`/`useTransition` fetch-then-set ladders.
- Reads use `useQuery` (or `useQueries` for a fixed fan-out) in a `lib/queries` hook. Dependent reads pass `enabled` (e.g. a detail query keyed by the selected id). Derive `loaded`/`error` from the query (`!query.isPending`, `query.error`), and keep selection, filters, dialog, and form state as local `useState`.
- Writes use `useMutation` that invalidates the affected `qk.<domain>.root` (or seeds the cache with `setQueryData` when the mutation returns the fresh state) in `onSuccess`. For an encapsulated multi-call write flow it is acceptable to call the api functions directly and then invalidate the domain key through `useQueryClient`/a small `useInvalidate*` helper — but never leave a write without invalidating its read.
- Share one query key across routes instead of refetching: the connector summary list, routine list, and routine trigger status can be read by several pages through the same `qk` entry, so a write in one place refreshes the others.
- Never call `startTransition`/dispatch side effects from inside a `setState` updater (React 19 + StrictMode runs updaters twice and a transition started during render misbehaves) — validate, set busy state, then run the mutation/transition at the top level of the handler.
- The chat surface is the deliberate exception: it streams over SSE through `chatRunsStore`/`useChatRun` and keeps its own inline `["chat", ...]` keys; do not fold it into the `qk` factory or convert its stream to a query. Realtime cross-process refresh remains the change-feed's job (above); query invalidation is for same-tab writes.

Web client forms use TanStack Form + zod, not bespoke `useState` field ladders. Non-trivial forms (multi-field, validated, or dialog-based — e.g. the routine editor) use `useForm` from `@tanstack/react-form` with per-field zod validators passed straight to `validators.onChange`/`onBlur` (zod 4 implements Standard Schema, so no adapter package). Rules:

- Keep the form's value shape, defaults, zod field schemas, and the function that builds the server payload in a co-located module (e.g. `apps/web/src/lib/forms/routineForm.ts`), so the form component is just wiring. JSON-text fields hold raw strings and validate with a zod `.refine` that parses; the payload builder turns them into the server's input object.
- Client validation is UX only — the server (tRPC zod + the store's `normalize*`) stays authoritative and re-validates. Surface server errors returned from the `useMutation` as a form-level error, separate from field errors.
- Submit through the existing `useMutation` hook in the form's `onSubmit`; gate the submit button on `form.state.canSubmit` via `form.Subscribe`, and use `state.isSubmitting` for the spinner. Re-mount the form (a `key` on mode+id) to reinitialize defaults when a dialog reopens for a different record, rather than syncing defaults with effects.
- Trivial one-or-two-field inputs (a search box, a single token field) do not need TanStack Form; plain controlled state is fine. Reach for the library when there is a single submit plus real validation. Two shapes deliberately stay controlled even with several fields: a multi-action inline editor (Save + enable toggle + delete + sub-selections, e.g. the MCP per-server card) and a config draft that has no submit of its own and feeds a shared run/save panel (the connector sync-config forms feeding `ConnectorOperationPanel`). Those underuse a submit-oriented form library; keep them as controlled state.

Run context includes durable local guidance. `packages/agent/src/runContext.ts` injects root `AGENTS.md`, memory, active todos, and the prompt-visible skill index on every run, including continued sessions.

Auto-compaction is owned by the shared agent loop and is append-only. `packages/agent/src/compaction.ts` appends `compaction.completed` checkpoint events instead of deleting historical messages; continued runs rebuild model context through `buildCompactedMessageRecords()` as fresh system context, the latest summary checkpoint, and kept recent messages. Threshold compaction uses Pi's `contextWindow - reserveTokens` rule, overflow errors compact and retry once, and stale pre-compaction usage must not immediately retrigger compaction.

Tools use dotted names, JSON-schema inputs, a `mode` (`read`, `write`, `learning`, or `dangerous`), optional `maxResultChars`, optional prompt-facing `promptSnippet`/`promptGuidelines`, optional `executionMode` (`parallel` or `sequential`), and the run `ToolContext.signal` for cancellation. `ToolRegistry.list()` exposes active tool prompt guidance, and `packages/agent/src/runContext.ts` injects that guidance into every run so model-facing tool discipline stays with the tool definition. The agent loop executes multiple tool calls in Pi-style `parallel` mode by default: starts are emitted in assistant source order, completions are emitted as tools finish, and persisted tool-result messages remain in assistant source order. Any called tool with `executionMode: "sequential"` forces the whole batch sequential. Execute tools through `registry.safeExecute()` so tool failures become structured `ToolExecutionResult` values. Native human-interaction tools such as planned `user.ask` should be normal trace-backed tools over a shared agent UI adapter; TUI and web may provide interactive adapters, while CLI print and scheduled jobs must return explicit unavailable/cancelled results instead of blocking indefinitely.

TUI rendering is pi-style scrollback, not alt-screen. `TuiRuntime` writes to the main terminal buffer and must not enable alt-screen. Width/height changes clear the visible viewport but must not wipe terminal scrollback.

TUI overlays are composited by the runtime. Do not reintroduce app-side overlay replacement logic.

The TUI must be testable without a real PTY. Use `FakeTerminal` and the e2e tests under `packages/e2e/` when changing rendering or input behavior.

## Code Conventions

- Relative imports use `.js` extensions.
- Test files (`*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`) live under a `__tests__/` directory.
- Cross-package imports use `@strata/<pkg>`.
- Boundary errors should return typed results where possible instead of leaking raw exceptions.
- The TUI runtime must restore terminal state after errors.
- Use Biome for formatting.
- During multi-file edits, do not manually chase formatter-owned whitespace while implementation is still in flight. Ignore indentation, wrapping, blank-line, and comment-layout drift unless it changes semantics, blocks understanding, or remains after formatting. Fix real syntax/type/test failures as they appear, then run `bun run format` once near the end and review the resulting diff.
- Commit messages should follow the existing style: `add: ...`, `fix: ...`, `refactor: ...`, `update: ...`, and `ingest: <source> | <title>` for wiki ingests.

## Web UI (Tailwind) Conventions

The `apps/web` control plane uses Tailwind CSS v4, configured CSS-first in `apps/web/src/styles/globals.css` via `@theme` (there is no `tailwind.config.js`). Theme tokens are the single source of truth for the design system; keep styling expressible through them.

- Size text only with the named font-size scale: `text-2xs`, `text-xs`, `text-sm`, `text-base`, `text-md`, `text-lg`, `text-xl`, `text-2xl`. Never use arbitrary pixel font sizes like `text-[13px]` — they bypass the scale and can't be tuned centrally. Current ladder: `2xs`≈11px, `xs`≈12, `sm`≈13, `base`≈14, `md`≈15, `lg`≈16, `xl`≈18, `2xl`≈20. To resize the whole UI, edit the `--text-*` rem values (and paired `--text-*--line-height`) in the `@theme` block, or adjust the root font-size — do not sprinkle per-element overrides.
- Tokens carry a loose default line-height; when an element needs a specific rhythm, pair it with an explicit `leading-*` utility (which always wins over the token default).
- Color the UI with the operator-console color tokens, not arbitrary CSS-var classes. The palette is exposed in `@theme` as named tokens, so use `text-fg`, `text-fg-dim`, `text-fg-mute`, `bg-surface`, `bg-surface-2`, `bg-bg`, `bg-bg-elev`, `border-hairline`, `border-hairline-strong`, `text-accent`/`bg-accent-soft`, `text-good`/`text-warn`/`text-bad`, `ring-ring`, etc. (with `/opacity` modifiers as needed). Never write `text-[var(--fg-mute)]` or `border-[var(--hairline)]`. Tokens reference the runtime palette vars, so dark/light theme switching cascades automatically. New palette colors go in the `@theme` block first, then are used by name.
- Use complete, static class names. Tailwind only generates CSS for class strings it can see, so do not assemble class names dynamically (e.g. `` `text-${size}` ``); branch between full literal class names instead.
- Component directory split — keep these two kinds of component apart so it is always obvious which is which:
  - `@/components/ui` (`apps/web/src/components/ui/`) holds **only official shadcn/ui components** — the ones added/updated by the shadcn CLI (it is the `ui` alias in `components.json`). Treat these as vendored: add them with the shadcn CLI, and avoid hand-authoring or dropping our own components here so CLI updates stay clean.
  - `@/components/shared` (`apps/web/src/components/shared/`) holds **our own shared UI primitives** — anything we wrote that isn't an official shadcn component (`Eyebrow`, `Chip`, `Callout`, `StatCard`, …). New custom reusable UI goes here, never in `ui/`.
  - Feature/composite components (page-specific panels, pickers, layout) stay at the `@/components` root (e.g. `page-layout.tsx`, `connector-operation-panel.tsx`).
- Reuse the shared primitives rather than hand-rolling markup, so composite patterns stay consistent. From `@/components/ui` (shadcn): `Button`, `Input`, `Dialog`, `Badge` (terse status tag), `Skeleton` (every loading placeholder, sized with height/width utilities — do not hand-roll `bg-surface-2` divs). From `@/components/shared` (ours): `Chip` (sentence-case metadata chip), `Eyebrow` (the canonical small uppercase overline label — use it instead of `uppercase tracking-[…]` strings or the raw `.label-eyebrow` class), `Callout` (the bordered error/status banner — never re-create the `border-bad/40 bg-bad/[0.06]` block inline), `StatCard` (the eyebrow-label + big-mono-number metric tile). Page scaffolding goes through `PageContainer` + `PageHeader`.

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
