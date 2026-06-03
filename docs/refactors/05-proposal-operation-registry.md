# Refactor Plan 05: Extract Proposal Operations into a Registry

Status: proposed structural refactor.

Parent index: [Refactor Plan Index](./index.md)

## Problem

`packages/core/src/proposalStore.ts` owns too many concerns:

- proposal persistence
- frontmatter and Markdown formatting/parsing
- status transition validation
- wiki page create/patch auto-apply
- entity consolidation operation parsing
- legacy prose inference
- diff preview generation
- backlink rewriting
- apply logging

This makes proposals less generic over time. Wiki consolidation logic dominates the store even though proposals are meant to cover wiki, memory, skill, and schema changes.

## Target Shape

Split proposal storage from proposal operations.

Suggested modules:

```text
packages/core/src/proposals/
  store.ts
  markdown.ts
  status.ts
  apply.ts
  operationRegistry.ts
  operations/
    wikiCreatePage.ts
    wikiPatchPage.ts
    wikiConsolidation.ts
    ingestTaxonomy.ts
```

`proposalStore.ts` can remain as a compatibility export that delegates into the new modules.

## Non-goals

- Do not remove existing Markdown proposal files.
- Do not remove current guarded apply behavior.
- Do not silently auto-apply proposals that currently require manual review.
- Do not widen proposal write permissions.

## Design Direction

Proposal operations should be explicit data, not inferred behavior scattered through Markdown parsing.

Preferred shape:

```ts
interface ProposalOperationHandler {
  kind: string;
  preview(repoRoot, proposal): Promise<ProposalApplyPreview>;
  buildPlan(repoRoot, proposal): Promise<ProposalApplyPlan | null>;
  apply(repoRoot, proposal, plan): Promise<ProposalApplyResult>;
}
```

The registry dispatches by an explicit operation block. Legacy Markdown/prose extraction can remain as a compatibility handler until existing proposals age out.

## Refactor Slices

### Slice 1: Split pure Markdown/status helpers

1. Move frontmatter parsing/rendering and proposal Markdown section parsing into `proposals/markdown.ts`.
2. Move status transition validation and review-history formatting into `proposals/status.ts`.
3. Keep existing public functions re-exported.

### Slice 2: Introduce operation registry behind existing API

1. Add an internal registry with handlers for current supported apply modes.
2. Make `previewLearningProposalApply()` and `buildLearningProposalApplyPlan()` dispatch through the registry.
3. Keep outputs byte-compatible where possible.

### Slice 3: Extract wiki create/patch handlers

1. Move fenced Markdown create extraction into `operations/wikiCreatePage.ts`.
2. Move exact patch extraction into `operations/wikiPatchPage.ts`.
3. Keep path safety checks centralized and shared.

### Slice 4: Extract consolidation handler

1. Move consolidation plan normalization, validation, diff preview, merge/supersede/backlink operations, and fingerprinting into `operations/wikiConsolidation.ts`.
2. Keep legacy prose inference as a clearly named compatibility submodule.
3. Preserve guarded exact apply semantics.

### Slice 5: Define explicit operation block format

1. Document the preferred proposal operation JSON shape.
2. Update proposal producers to emit explicit operation blocks where they currently rely on prose/fences.
3. Keep old parsing as a compatibility fallback.

## Acceptance Criteria

- Existing proposal store tests pass.
- `proposalStore.ts` is no longer the place to add operation-specific behavior.
- A new proposal operation can be added by registering a handler.
- Existing pending proposals remain readable and applyable where they were applyable before.
- Unsafe/ambiguous patches remain blocked.

## Risks

- Legacy proposal parsing is brittle. Keep regression tests for existing shapes.
- Consolidation apply touches multiple pages; preserve fingerprint/revalidation checks exactly.
- Too much abstraction can make simple wiki patches harder to understand. Keep handlers direct and boring.

## Documentation Notes

If proposal authoring or review semantics change, update:

- [../web-control-plane-plan.md](../web-control-plane-plan.md)
- [../wiki-plan.md](../wiki-plan.md)
- [../status.md](../status.md)
