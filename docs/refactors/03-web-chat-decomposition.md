# Refactor Plan 03: Decompose Web Chat and Browser Run State

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

Web chat has become the highest-churn UI surface, and most new behavior lands in a few very large files:

- `apps/web/src/routes/chat.tsx`
- `apps/web/src/lib/chatRunsStore.ts`
- `packages/web-api/src/chat.ts`
- `packages/web-api/src/chatRunStore.ts`

`chat.tsx` mixes routing, pinned tabs, queue controls, composer behavior, model selection, terminal drawer wiring, transcript display, specialized tool renderers, streaming status, utility parsing, and many local effects. `chatRunsStore.ts` mixes discovery, stream reconnect, transcript batching, query invalidation, queue refresh, session loading, and local run state.

This works, but it makes every web chat change feel like editing the whole product.

## Target Shape

The route should become a composition shell over feature modules.

Suggested frontend layout:

```text
apps/web/src/features/chat/
  page/ChatPage.tsx
  composer/
  tabs/
  queue/
  transcript/
  tool-renderers/
  terminal/
  state/
    ChatRunStore.ts
    RunStreamController.ts
    SessionDiscovery.ts
    TranscriptBatcher.ts
    QueueRefreshController.ts
```

Suggested backend layout:

```text
packages/web-api/src/chat/
  service.ts
  activeRuns.ts
  queuedMessages.ts
  events.ts
  store.ts
  types.ts
```

## Non-goals

- Do not convert the SSE chat stream into TanStack Query. The current design intentionally treats streaming chat as an exception.
- Do not create a browser-side agent.
- Do not remove durable web chat run/event replay.
- Do not make terminal output durable as part of chat decomposition.

## Refactor Slices

### Slice 1: Extract tool renderers

1. Move `ToolIcon`, `SpecializedToolContent`, and every `*ToolView` into `features/chat/tool-renderers`.
2. Replace the hard-coded `if tool.name === ...` chain with a `ToolRendererRegistry` map.
3. Keep a generic fallback renderer.
4. Add small renderer tests for representative tools if practical.

### Slice 2: Extract pinned tabs

1. Move tab bar components and drag/drop helpers out of `chat.tsx`.
2. Keep `chatPinnedTabs.ts` as the store, but move UI-only behavior to `features/chat/tabs`.
3. Preserve browser-local localStorage behavior.

### Slice 3: Extract queue UI and queue API helpers

1. Move queued prompt components and reorder/promote/remove behavior to `features/chat/queue`.
2. Keep API calls through existing `@/lib/api` transport or a dedicated query/mutation wrapper if it does not conflict with streaming design.
3. Preserve steering vs follow-up semantics.

### Slice 4: Split browser run state

Break `chatRunsStore.ts` into internal collaborators:

- `RunStreamController` — start/reconnect/cancel SSE streams.
- `SessionDiscovery` — active-run polling and change-feed reactions.
- `TranscriptBatcher` — delayed transcript update flushing.
- `SessionTranscriptLoader` — persisted message page loading.
- `QueueRefreshController` — queue-change versioning and refresh triggers.

Keep one exported `chatRunsStore` facade initially.

### Slice 5: Split backend chat service

Move the durable store and active-run orchestration into separate files. Keep `createChatService()` as the public constructor.

## Acceptance Criteria

- `apps/web/src/routes/chat.tsx` is reduced to route composition and top-level orchestration.
- Tool renderers can be extended without editing the route file.
- `chatRunsStore` behavior is preserved: background streams continue across route switches, reconnect works, queued continuations appear live, and change-feed refresh still works.
- Existing web chat tests pass.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass.

## Risks

- React render performance can regress if store snapshots lose stable identity.
- SSE reconnect and queued-message replacement behavior are subtle; preserve tests around `run.replaced`, pending steering, and disconnected streams.
- Splitting UI too aggressively can create prop-drilling. Prefer small local providers or feature-level hooks where needed.

## Documentation Notes

If behavior or architecture changes beyond file decomposition, update:

- [../web-chat-plan.md](../web-chat-plan.md)
- [../web-control-plane-plan.md](../web-control-plane-plan.md)
- [../status.md](../status.md)
