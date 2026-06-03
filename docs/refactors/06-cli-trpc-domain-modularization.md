# Refactor Plan 06: Modularize CLI Commands and tRPC Routers by Domain

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

Two central entrypoint files have become too large and too coupled:

- `packages/cli/src/index.ts`
- `packages/web-api/src/trpc.ts`

They contain command/router registration, option parsing, zod input schemas, DTO types, service interfaces, print formatting, and domain-specific behavior. This creates a high-friction path for every new feature: edit the biggest file and hope unrelated command/router behavior does not move.

## Target Shape

Make each domain own its command/router contract.

CLI:

```text
packages/cli/src/
  main.ts
  commandRegistry.ts
  commands/
    auth.ts
    query.ts
    sessions.ts
    ingest.ts
    connectors.ts
    wiki.ts
    proposals.ts
    jobs.ts
    routines.ts
    tools.ts
    tui.ts
```

Web API/tRPC:

```text
packages/web-api/src/trpc/
  index.ts
  context.ts
  routers/
    chat.ts
    connectors.ts
    wiki.ts
    actions.ts
    activity.ts
    review.ts
    proposals.ts
    routines.ts
    retrievalIndex.ts
    modelAuth.ts
    mcps.ts
  contracts/
    chat.ts
    routines.ts
    connectors.ts
```

## Non-goals

- Do not change CLI command names or flags unless separately planned.
- Do not change tRPC procedure paths unless migration is coordinated with the web client.
- Do not move domain business logic into route components.
- Do not duplicate DTOs between server and client.

## Refactor Slices

### Slice 1: Add command registry while preserving `index.ts`

1. Introduce a tiny `Command` interface: name, summary, usage, run.
2. Move one low-risk command, such as `tools` or `trace`, into `commands/`.
3. Keep `packages/cli/src/index.ts` as the executable entrypoint and compatibility export.
4. Add tests around unknown command handling and moved command behavior.

### Slice 2: Move high-complexity CLI domains

1. Move `routines` command parsing/printing to `commands/routines.ts`.
2. Move `ingest` and `connectors` only after the registry pattern is stable.
3. Extract shared flag parsing helpers into `cliArgs.ts`.
4. Extract print helpers into domain files or `formatters/`.

### Slice 3: Split tRPC contracts from router wiring

1. Move zod schemas and exported result types by domain into `trpc/contracts/*`.
2. Keep `AppRouter` export stable from `packages/web-api/src/trpc.ts`.
3. Update `apps/web/src/lib/api.ts` imports only if necessary.

### Slice 4: Split routers by domain

1. Move `chat` router first because it has many subprocedures but clear boundaries.
2. Move routines/connectors/review/proposals after contract extraction.
3. Compose all domain routers in `trpc/index.ts`.

### Slice 5: Align service interfaces

1. Decide whether `WebApiServices` remains one interface or becomes domain service groups.
2. Prefer grouped services if it reduces constructor sprawl.
3. Preserve tests that inject fake services.

## Acceptance Criteria

- CLI behavior and help output remain compatible unless deliberately changed.
- `AppRouter` type remains available to the web app.
- Route components still go through query hooks/API transport rather than direct server logic.
- Adding a new domain no longer requires editing a 1k+ LOC router file.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass.

## Risks

- Moving exported types can break client imports. Use compatibility re-exports during transition.
- Splitting command parsing can accidentally change flag consumption order. Keep focused CLI tests.
- Over-fragmenting contracts can make discovery harder. Keep a clear `trpc/index.ts` barrel.

## Documentation Notes

If public CLI or API organization changes materially, update:

- [../app-overview.md](../app-overview.md)
- [../web-control-plane-plan.md](../web-control-plane-plan.md)
- [../status.md](../status.md)
- [../../AGENTS.md](../../AGENTS.md)
