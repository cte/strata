# Extraction Framework Plan

Status: reset on 2026-05-29.

The previous `daily.todo` implementation was removed. It produced poor action items even after deterministic and model-verifier passes, so the code path, CLI/API/UI review surface, SQLite schema, and raw-to-wiki action promotion have been deleted. The generated wiki action ledgers were cleared.

This document now records the next design starting point rather than an implemented extraction system.

## Clean Starting Point

The canonical action-item surface is the Markdown schema plus manual management UI:

- `wiki/actions/mine.md`
- `wiki/actions/theirs.md`
- `@strata/core/wiki-actions`
- `wiki.actions.*` tRPC procedures
- `/actions`

Action items are ordinary Markdown task-list rows. Optional source links and hidden `strata:action-context` comments may store user-entered context or importer metadata, but there is no current automated wiki extraction path that writes actions.

## Architecture Direction

The next extraction architecture should start from the action-item schema and the Routine artifact contract, not from source heuristics.

Before implementing extraction again, define:

1. The action item data contract: owner, title, status, source evidence, context, due/review date, provenance, and sync behavior.
2. The write-back contract: how a completed or edited action propagates to the originating wiki/source page without corrupting raw evidence.
3. The candidate lifecycle: proposed, accepted, rejected, completed, stale, merged, and superseded.
4. The evidence contract: source page/path, span, quote boundary, confidence, rationale, and reviewer decisions.
5. The UI contract: today-first manual action management remains useful even when extraction is disabled.

Only after those contracts are settled should automated discovery be reintroduced through the general Routine primitive described in [routines-plan.md](./routines-plan.md). The first new producer should be a Granola daily TODO Routine that emits schema-valid Routine artifacts for review, not a source-specific writer into `wiki/actions/`.

## Constraints

- Do not re-add raw-to-wiki action promotion as a shortcut.
- Do not write extracted actions directly from Slack-specific heuristics.
- Do not make `/actions` depend on a candidate store; it must remain useful for manual wiki-backed action management.
- Do not put extraction decisions in the browser. Browser controls may review or edit data only after the shared core/ingest contract exists.
- Keep raw snapshots immutable.

## Next Slice

Build the Routine foundation first, then implement a Granola daily TODO Routine that produces reviewable candidates against the action schema. Keep manual `/actions` management useful throughout, and add reviewed write-back only after Routine artifacts and provenance are working.
