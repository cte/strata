# Refactor Plan 08: Finish the Web App Feature-Folder Migration

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

The web app already has good infrastructure for API transport, TanStack Query hooks, and form helpers, but many route files still contain full feature implementations:

- `apps/web/src/routes/routines.tsx`
- `apps/web/src/routes/actions.tsx`
- `apps/web/src/routes/activity.tsx`
- `apps/web/src/routes/proposals.tsx`
- connector routes under `apps/web/src/routes/`

Route files should describe page composition, route params, and high-level selection state. They should not own every dialog, table, row, editor, and formatter for a product area.

## Target Shape

Move domain UI into feature folders while keeping shared primitives under `components/ui`, `components/ai-elements`, `lib/queries`, and `lib/forms`.

Suggested layout:

```text
apps/web/src/features/
  routines/
    RoutinePage.tsx
    RoutineList.tsx
    RoutineDetail.tsx
    RoutineEditorDialog.tsx
    RoutineTriggerDialog.tsx
    RunHistory.tsx
    ArtifactList.tsx
  actions/
  activity/
  review/
  connectors/
  retrieval-index/
```

Routes become thin:

```tsx
export function RoutinesRoute() {
  return <RoutinesPage />;
}
```

## Non-goals

- Do not move server-state fetching back into bespoke `useEffect` loaders.
- Do not replace TanStack Query or TanStack Form patterns.
- Do not create generic mega-components that erase domain language.
- Do not change routes or navigation unless separately planned.

## Refactor Slices

### Slice 1: Extract routines feature

1. Move routine list/detail/editor/trigger/run-history/artifact components out of `routes/routines.tsx`.
2. Keep query hooks in `apps/web/src/lib/queries/routines.ts`.
3. Keep form schema/payload helpers in `apps/web/src/lib/forms/routineForm.ts`.
4. Add feature-local formatter helpers if they are routine-specific.

### Slice 2: Extract actions feature

1. Move action row, add form, filters, and context editor into `features/actions`.
2. Keep manual action-management semantics unchanged.
3. Preserve Markdown-backed action behavior through existing API/query hooks.

### Slice 3: Extract activity/review/proposals

1. Move activity timeline/detail components into `features/activity`.
2. Move proposal detail/review components into `features/review` or `features/proposals` depending on final naming.
3. Keep `/review` as the unified review inbox.

### Slice 4: Extract connector pages

1. Move connector operation panels and source-specific config forms into `features/connectors`.
2. Preserve the documented exception that connector sync-config drafts can remain controlled state instead of TanStack Form.

### Slice 5: Add route size gate

After extraction, add an architecture quality gate warning when route files exceed a small threshold, such as 300-500 LOC.

## Acceptance Criteria

- Routes are thin composition shells.
- Query hooks remain in `lib/queries`; transport remains in `lib/api`.
- Non-trivial forms keep using TanStack Form + zod where appropriate.
- No route component directly imports server package internals beyond allowed shared types.
- `bun run check:workspaces`, `bun test`, and `bun run knip` pass.

## Risks

- Moving state too far down can make URL/selection behavior harder to follow. Keep route-level selection where it genuinely belongs.
- Over-generic components can make product language worse. Prefer domain-specific component names.
- Cross-feature imports can create cycles; enforce one-way dependencies from routes -> features -> shared libs/components.

## Documentation Notes

If the web architecture convention changes, update:

- [../web-control-plane-plan.md](../web-control-plane-plan.md)
- [../web-chat-plan.md](../web-chat-plan.md) for chat-specific exceptions
- [../../AGENTS.md](../../AGENTS.md)
