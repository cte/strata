# Refactor Plan 02: Decompose the Shared Agent Loop Without Creating a Second Loop

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

`packages/agent/src/agentLoop.ts` is the canonical source of truth for model/tool runs. That invariant is correct and must remain. The implementation file, however, has grown into a large procedural corridor that handles:

- new-session creation
- session continuation
- system context injection
- transcript repair
- auto-compaction
- model retry/overflow recovery
- streaming deltas
- tool execution and ordering
- queued steering/follow-up messages
- cancellation
- persistence
- run result construction

The danger is not just file length. The danger is that future changes to one behavior, such as native `user.ask`, can accidentally destabilize continuation, compaction, or tool ordering because all concerns share one function body.

## Target Shape

`runAgentLoopEvents()` remains the only public event-producing agent loop. Internally, it delegates to focused units that own one concept each.

Potential internal modules:

- `sessionBootstrap.ts` — create/continue/forkless continuation setup.
- `transcriptRepair.ts` — synthetic tool-result insertion for incomplete turns.
- `queuedMessages.ts` — steering/follow-up drain and persistence.
- `modelTurn.ts` — one model request attempt with streaming events.
- `modelRetry.ts` — retry policy and overflow classification.
- `toolBatch.ts` — tool start/completion/output ordering.
- `runResult.ts` — result and stopped-reason construction.
- `compactionController.ts` — loop-facing compaction orchestration.

## Non-goals

- Do not introduce a second agent loop.
- Do not change public run events unless an explicit compatibility plan is written.
- Do not move UI-specific behavior into the agent package.
- Do not remove cancellation propagation.

## Current Hotspots

- `packages/agent/src/agentLoop.ts`
- `packages/agent/src/types.ts`
- `packages/agent/src/compaction.ts`
- `packages/agent/src/runContext.ts`
- tests under `packages/agent/src/__tests__/agentLoop*.test.ts`
- TUI/web consumers in `packages/tui` and `packages/web-api`

## Refactor Slices

### Slice 1: Extract pure helpers first

1. Move transcript repair helpers out of `agentLoop.ts` with tests unchanged.
2. Move retry classification/timing into a dedicated module.
3. Move result construction and cancellation payload helpers into a small module.

This should reduce file size without touching control flow.

### Slice 2: Extract tool batch execution

1. Define an internal `ToolBatchExecutor` function that receives tool calls, store/session context, registry, and signal.
2. Preserve Pi-style parallel default and sequential override behavior.
3. Preserve persisted tool-result ordering in assistant source order.
4. Keep `ToolEventChannel` internal to the tool batch module if possible.

### Slice 3: Extract model turn execution

1. Wrap model request, streaming delta queue, retry attempts, and overflow recovery into a `runModelTurn()` helper.
2. Return a typed outcome rather than mutating loop-local flags from many places.
3. Keep streaming events yielded through the same outer async generator contract.

### Slice 4: Reframe the main loop as a state machine

The main function should read as:

1. bootstrap session
2. maybe auto-compact
3. drain queued messages
4. run model turn
5. persist assistant turn
6. execute tool batch if present
7. stop or repeat

## Acceptance Criteria

- `runAgentLoopEvents()` remains the single canonical loop consumed by CLI, TUI, web chat, jobs, and routines.
- Existing event ordering tests pass without weakening assertions.
- Cancellation tests still prove model requests and tools receive the abort signal.
- The resulting `agentLoop.ts` is materially shorter and easier to scan.
- No interface package duplicates loop logic.

## Risks

- Splitting an async generator can make event ordering less obvious. Mitigate with golden event-order tests.
- Tool result ordering is subtle: completions may arrive out of order, but persisted tool messages must remain in assistant source order.
- Compaction/overflow retry must not regress into repeated compaction loops.

## Documentation Notes

If any public loop behavior changes, update:

- [../agent-harness-plan.md](../agent-harness-plan.md)
- [../web-chat-plan.md](../web-chat-plan.md)
- [../tui-plan.md](../tui-plan.md)
- [../status.md](../status.md)
- [../../AGENTS.md](../../AGENTS.md)
