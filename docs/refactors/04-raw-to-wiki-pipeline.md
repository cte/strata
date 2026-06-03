# Refactor Plan 04: Rebuild Raw-to-Wiki as a Source-Adapter Pipeline

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

`packages/ingest/src/rawToWiki.ts` is the main raw-to-wiki indexing implementation and is too broad. It handles:

- raw path resolution
- raw frontmatter parsing
- source-specific draft construction
- taxonomy-aware classification
- page formatting
- entity upserts
- index/log updates
- dry-run/apply behavior
- trace event emission

Some source-specific helpers already live in `packages/ingest/src/raw-to-wiki/`, but the main file is still the orchestration and implementation god module.

This matters because automated action extraction has been reset. Raw-to-wiki must stay subject-matter agnostic and should not become the place where action intelligence sneaks back in.

## Target Shape

Model raw-to-wiki as an explicit pipeline with source adapters:

```ts
RawSourceAdapter
  -> parse(raw file)
  -> classify(parsed source, taxonomy)
  -> planWikiWrites(classification)
  -> applyPlan(plan)
  -> emitActivity(plan, result)
```

Core concepts:

- `RawSourceAdapter`: Granola, Notion, Slack implementation boundary.
- `RawSourceDocument`: normalized parsed source shape.
- `ClassificationResult`: people/projects/decisions/threads/source materiality with reasons.
- `WikiWritePlan`: explicit list of page writes/patches/index/log updates.
- `RawToWikiPipeline`: generic orchestration and event emission.

## Non-goals

- Do not reintroduce raw-to-wiki action promotion.
- Do not hard-code workspace-specific taxonomy in TypeScript.
- Do not rewrite generated wiki content formats unless required for extraction.
- Do not make raw sources mutable.

## Current Hotspots

- `packages/ingest/src/rawToWiki.ts`
- `packages/ingest/src/raw-to-wiki/entityResolution.ts`
- `packages/ingest/src/raw-to-wiki/extraction.ts`
- `packages/ingest/src/raw-to-wiki/materiality.ts`
- `packages/ingest/src/raw-to-wiki/slack.ts`
- `packages/ingest/src/raw-to-wiki/types.ts`
- `packages/ingest/src/__tests__/rawToWiki.test.ts`

## Refactor Slices

### Slice 1: Define pipeline types

1. Add `raw-to-wiki/pipelineTypes.ts` for normalized source document, classification, write plan, and apply result types.
2. Map existing `RawToWikiIndexItem` onto the new plan/result types without changing public exports.
3. Add unit tests for the mapping layer.

### Slice 2: Extract source adapters

1. Move Granola draft/parsing/classification into `adapters/granola.ts`.
2. Move Notion source parsing into `adapters/notion.ts`.
3. Move Slack parsing/materiality/classification into `adapters/slack.ts`.
4. Each adapter should expose a small common interface and source-specific tests.

### Slice 3: Extract write planning

1. Move page-formatting and entity-upsert planning into `wikiWritePlanner.ts`.
2. Represent writes as data before applying them.
3. Keep exact current page output in tests.

### Slice 4: Extract application and event emission

1. Move file mutation into `wikiPlanApplier.ts`.
2. Move trace event payload construction into `activityEvents.ts`.
3. Make dry-run behavior use the same plan objects without writing.

### Slice 5: Shrink `rawToWiki.ts` to public API compatibility

Keep `runRawToWikiIndex()` and compatibility exports in `rawToWiki.ts`, but delegate to the pipeline.

## Acceptance Criteria

- All existing raw-to-wiki tests pass without weakening expected output.
- Public exports used by CLI/jobs/web remain compatible.
- Adding a new source requires implementing a source adapter, not editing a 2k-line central file.
- Classification reasons remain present in activity events.
- No action-item publication is reintroduced.

## Risks

- Existing output is wiki-user-facing; even small formatting changes can create churn. Use snapshot-style fixture tests around generated pages.
- Slack materiality rules are subtle and must remain taxonomy-backed rather than product-code local vocabulary.
- Dry-run and apply paths can diverge if write plans are not shared.

## Documentation Notes

If this changes ingest architecture or public command behavior, update:

- [../wiki-plan.md](../wiki-plan.md)
- [../ingest-activity-log-plan.md](../ingest-activity-log-plan.md)
- [../status.md](../status.md)
- [../../AGENTS.md](../../AGENTS.md)
