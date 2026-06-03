# Refactor Plan 09: Harden Typed JSON Boundaries

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

The repo enables strict TypeScript, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`, but critical runtime boundaries still rely on loose JSON handling:

- `z.any()` in web/API contracts.
- `unknown as` casts for routine input, connector payloads, attachments, tool calls, and chat events.
- Direct `JSON.parse()` into expected shapes.
- Repeated local helpers for `isRecord`, `stringValue`, `arrayValue`, etc.

This is most dangerous at extension/tool/Routine/API boundaries, where untrusted or model-produced data enters the system.

## Target Shape

Create explicit codecs/normalizers for recurring JSON shapes and use them at boundaries.

Suggested modules:

```text
packages/core/src/jsonCodec.ts
packages/agent/src/attachmentCodec.ts
packages/tools/src/toolResultCodec.ts
packages/routines/src/routineCodec.ts
packages/web-api/src/chatEventCodec.ts
packages/ingest/src/connectorPayloadCodec.ts
```

A codec should either return a typed value or a typed validation error. Avoid silent fallback except where current behavior explicitly requires best-effort parsing.

## Non-goals

- Do not eliminate all `unknown`; it is appropriate at input boundaries.
- Do not add a huge generic validation framework.
- Do not make model/tool output parsing brittle where best-effort display is safer.
- Do not store secrets while improving validation diagnostics.

## Refactor Slices

### Slice 1: Central JSON primitives

1. Add `JsonValue`, `JsonObject`, and parse helpers in core if existing types are insufficient.
2. Add `parseJsonObject(text, label)` and `jsonObjectFromUnknown(value, label)` helpers with typed errors.
3. Replace repeated local `isRecord` helpers where the core helper improves clarity.

### Slice 2: API zod schema tightening

1. Replace `z.any()` in `packages/web-api/src/trpc.ts` with explicit JSON schemas.
2. Define `jsonValueInput`, `jsonObjectInput`, and domain-specific schemas once.
3. Preserve client type inference.

### Slice 3: Agent attachment and tool-call codecs

1. Add an `AgentAttachment` parser for persisted/restored message attachments.
2. Add an `AgentToolCall` parser for persisted tool-call JSON.
3. Replace casts in `packages/agent/src/agentLoop.ts` with parser calls and explicit repair/failure behavior.

### Slice 4: Routine codecs

1. Ensure routine create/update input parsing goes through store normalization rather than CLI casts.
2. Add helper functions for parsing routine JSON files from CLI.
3. Keep `RoutineStore` authoritative for final validation.

### Slice 5: Chat event codecs

1. Decode persisted web chat event payloads through a `ChatRunEvent` parser.
2. Preserve fallback behavior for unknown historical events if needed.
3. Make event replay failures observable but not fatal to the whole session list.

## Acceptance Criteria

- Important runtime boundaries no longer need `as unknown as` casts.
- `z.any()` is eliminated or explicitly justified in API contracts.
- JSON parse failures report actionable labels.
- Existing persisted data remains readable.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass.

## Risks

- Strict decoders can break old local state. Use compatibility parsers for persisted historical rows.
- Overly generic codecs can obscure domain invariants. Prefer small domain parsers over a magical universal mapper.
- Tightening API schemas can break the web app if client payload builders are not updated simultaneously.

## Documentation Notes

If this changes public API or tool/Routine boundary behavior, update:

- [../agent-harness-plan.md](../agent-harness-plan.md)
- [../routines-plan.md](../routines-plan.md)
- [../web-control-plane-plan.md](../web-control-plane-plan.md)
- [../status.md](../status.md)
