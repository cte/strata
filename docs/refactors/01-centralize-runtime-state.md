# Refactor Plan 01: Centralize Runtime State and SQLite Schema Ownership

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

Strata's runtime state is local and SQLite-backed, but schema ownership is split across multiple packages:

- `packages/core/src/sessionStore.ts`
- `packages/core/src/schema.ts`
- `packages/core/src/migrations.ts`
- `packages/web-api/src/chatRunStore.ts`
- `packages/web-api/src/queueChangeStore.ts`

`SessionStore` applies embedded Drizzle migrations for core tables, while web chat run/event/queue tables are created and altered manually in `packages/web-api`. This violates the architectural intent that `.strata/state.sqlite` is the shared local system of record and makes it too easy for new durable state to bypass migrations, typing, event ownership, and test fixtures.

## Target Shape

All persistent SQLite tables in `.strata/state.sqlite` should be declared and migrated from `@strata/core`.

- `@strata/core` owns schema, migrations, and low-level SQLite lifecycle.
- Feature packages may own domain repositories, but they should depend on the core schema/migration layer.
- Web chat run state remains part of the web chat domain, but its durable tables are created through core migrations.
- Queue-change notification remains local and event-log-driven, but no package should silently create schema on first use outside core.

## Non-goals

- Do not replace SQLite.
- Do not introduce an external datastore.
- Do not merge every repository class into `SessionStore` if a separate domain repository improves clarity.
- Do not make terminal output durable as part of this refactor.

## Current Hotspots

- `packages/web-api/src/chatRunStore.ts` owns `web_chat_runs`, `web_chat_run_events`, and `web_chat_queued_messages` schema manually.
- `packages/web-api/src/queueChangeStore.ts` owns `web_chat_queue_changes` manually.
- `packages/core/src/schema.ts` does not include those tables.
- `packages/core/src/migrations.ts` embeds only Drizzle-generated migration SQL.

## Refactor Slices

### Slice 1: Inventory and contract

1. Document every table currently present in `.strata/state.sqlite`.
2. Mark each as one of:
   - core session/event/message state
   - routine/job state
   - ingest projection state
   - web chat durable state
   - derived/rebuildable index state
3. Add a small test that asserts core migrations create all expected durable tables in a fresh runtime directory.

### Slice 2: Move web chat schema into core

1. Add web chat tables to `packages/core/src/schema.ts`.
2. Generate and embed a migration for existing/manual web chat tables.
3. Preserve existing column names so no data migration is needed unless indexes/constraints change.
4. Remove table-creation SQL from `ChatRunStore.ensureSchema()` and `QueueChangeStore.ensureSchema()` after migration coverage exists.

### Slice 3: Share one opened state DB per service container

1. Let `createWebApiServices()` construct or share a core state-store handle for dependent repositories.
2. Update `ChatRunStore` and `QueueChangeStore` to accept a core-managed DB/session store rather than opening independent `bun:sqlite` connections by default.
3. Keep explicit close semantics.

### Slice 4: Add a no-ad-hoc-schema guard

1. Add a quality gate that fails on `create table` / `alter table` outside approved migration/schema files unless allowlisted.
2. Keep existing rebuildable non-state stores out of scope only if they do not write to `.strata/state.sqlite`.

## Acceptance Criteria

- A fresh `SessionStore.open()` applies every durable state migration required by CLI, TUI, web API, jobs, routines, and ingest activity.
- `ChatRunStore` and `QueueChangeStore` no longer create or alter tables directly.
- Existing web chat tests still pass, including durable run replay and abandoned-run recovery.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass.

## Risks

- Migration ordering could break existing local state if manual tables already exist. Mitigate with idempotent SQL and fixture tests against a manually-created pre-refactor DB.
- Sharing a DB handle may expose lifecycle bugs. Keep constructors backward-compatible until service wiring is fully converted.

## Documentation Notes

If this changes the runtime state invariant or package ownership, update:

- [../app-overview.md](../app-overview.md)
- [../status.md](../status.md)
- [../../AGENTS.md](../../AGENTS.md)
