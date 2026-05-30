# Taxonomy Suggestion Plan

Status: planned (2026-05-30). Decision recorded in [docs/adr/0001-taxonomy-suggestion-routine.md](./adr/0001-taxonomy-suggestion-routine.md). Subordinate to [docs/roadmap.md](./roadmap.md); builds on [docs/routines-plan.md](./routines-plan.md) and the reset notes in [docs/extraction-framework-plan.md](./extraction-framework-plan.md).

## Goal

Populate and maintain the **Ingest taxonomy** (`.strata/ingest/taxonomy.json`) through a feedback loop, so wiki organization (and downstream retrieval) improves over time. The reviewer works a **daily review queue of classification outcomes**, gives **typed verdicts** (Classification corrections), and those corrections both stage taxonomy schema Proposals and accumulate a labeled corpus that tunes an LLM suggester's prompt.

The taxonomy is the lever; reviewer feedback is the signal; the Proposal store is the gate.

## Non-goals

- Not retrieval-quality eval (golden queries → expected pages). That is the north star, measured later from accumulated corrections, never the gate.
- Not action extraction. Distinct from the `daily.todo` reset and `wiki/actions/`.
- Not a new review surface that competes with `/proposals`; derived taxonomy changes remain `schema` Proposals.
- Not feeding the LLM raw Slack. Evidence is source-weighted and materiality-pre-filtered (the daily.todo defense).

## Architecture (from ADR 0001)

- **Primitive:** an LLM-forward, review-gated **Routine** (`routine.run`). A pre-run Job gathers evidence; the agent uses first-party Tools; MCP untouched.
- **Deterministic floor (safety + cost only):** source-weighting (vocabulary from Granola/Notion), the Slack materiality pre-filter, volume/time bounds.
- **LLM owns the thinking:** selecting review-worthy outcomes, judging, drafting corrections + taxonomy operations, phrasing aliases.
- **Safety:** every output is a `schema` Proposal the reviewer confirms; only future classification (config) is affected.
- **Metric:** suggestion-vs-feedback (accept rate; recall against what the reviewer adds) + taxonomy-coverage trend.

## Data contracts

### Classification correction (new)

A durable, queryable reviewer verdict on one raw-to-wiki classification outcome. Persisted in `.strata/state.sqlite` (queryable for suppression + eval), keyed for dedupe.

```
ClassificationCorrection {
  id: string                 // stable
  createdAt: string          // ISO
  source: IngestActivitySource
  targetSessionId: string    // the raw_to_wiki.index.* run
  targetEventId: number      // the index.item/.skipped event
  rawPath: string            // provenance, immutable raw
  observed: {                // what the pipeline decided
    projectPaths: string[]
    primaryPath: string | null
    kept: boolean            // material vs skipped
    reasons: ClassificationReason[]
  }
  verdict:                   // typed
    | "confirm"
    | "wrong_project"        // correction.projectLabel
    | "noise"                // should have been skipped
    | "unrecognized_project" // correction.projectLabel (+ aliases)
    | "not_me" | "is_me"     // self-name corrections
  correction?: {
    projectLabel?: string
    aliases?: string[]
    selfName?: string
  }
  derivedProposalPath: string | null  // schema Proposal staged from this
  status: "open" | "applied" | "dismissed"
  dedupeKey: string
}
```

A correction maps deterministically to a taxonomy operation:
- `unrecognized_project` / `wrong_project` → `ingest.taxonomy.addProjectAlias { label, aliases }`
- `noise` → `ingest.taxonomy.addSlackPattern { field: ignoredLogPatterns, rule }` (Slack) or a project/source exclusion note
- `is_me` → `ingest.taxonomy.addSelfName { name }`

The correction is the **feedback unit**: it (a) seeds a schema Proposal, (b) is a permanent eval row, (c) suppresses the corrected item from re-surfacing.

### Review queue item (derived, not stored)

Computed from ingest activity events, never materialized in v1:
`reviewQueue = reviewWorthy(raw_to_wiki.* events) − alreadyCorrected(ClassificationCorrection by dedupeKey)`

**reviewWorthy** for v1 = classification outcomes that the taxonomy did *not* explain:
- project attribution was `generic`-only or absent (`ClassificationReason.source !== "taxonomy"` for the project), or
- a Slack thread kept/skipped by generic rules only,
source-weighted (Granola/Notion ranked above Slack), ranked by frequency/impact, capped per day.

### Taxonomy suggestion = `schema` Proposal (existing)

Reuse `stageIngestTaxonomyProposal` → `.strata/proposals/` → `/proposals`. No new store.

### Feedback corpus / eval set

The `ClassificationCorrection` rows are the corpus. The eval set = (observed classification + raw excerpt) → (reviewer verdict). Prompt tuning is judged as suggestion precision/recall against this set.

## Build slices

### Slice 1 — Deterministic spine (no LLM) — DONE

The complete loop, with the reviewer supplying judgment. Useful on its own; produces the corpus the LLM later needs.

Built. Note: the review queue reads raw-to-wiki `index.item` events directly from the event log (`listRawToWikiIndexItems`), because raw-to-wiki indexing runs in its own sessions that are not projected into the `ingest_activity_runs` run-list.

- **core:** `classification_corrections` table (schema + migration), `ClassificationCorrectionStore` (create/list/getByDedupe), types. `packages/core/src/`.
- **ingest:** `reviewQueueFromActivity()` over `@strata/ingest/activity` events → review-worthy items (source-weighted, suppression via corrections). `packages/ingest/src/`.
- **ingest:** `correctionToTaxonomyOperation()` — deterministic verdict → `IngestTaxonomyOperation`. Then stage as schema Proposal (existing path).
- **web-api:** `taxonomy.review.list` (queue) + `taxonomy.review.correct` (submit verdict → store correction + stage proposal) tRPC + services.
- **apps/web:** a review-queue surface (a "Review" section on `/ingest-taxonomy`, or a sibling route) showing review-worthy outcomes with typed-verdict controls; corrected items drop out; staged proposals link to `/proposals`. Uses the shared primitives (`Eyebrow`, `Callout`, `Chip`, `Dialog`, `StatCard`).
- **tests:** correction store, `reviewQueueFromActivity` suppression/ranking, `correctionToTaxonomyOperation`.

### Slice 2 — LLM suggestion Routine — DONE

- **routines:** seedable `routine_taxonomy_suggestions` (`@strata/jobs/taxonomySuggestionRoutine`) — prompt envelope, `outputSchema` (suggestions array w/ operation/rationale/confidence/sourceRefs/dedupe), `toolProfile: learning`, `proposal`/`schema` publication policy, pre-run `ingest.taxonomy.evidence` step. Self-installs on first `ingest.taxonomy.suggest` run via `ensureTaxonomySuggestionsRoutine`.
- **jobs:** read-only `ingest.taxonomy.evidence` emits the bundle (`@strata/ingest/taxonomy-evidence`): keeps Granola/Notion generously, hard-caps Slack and reports the drop (the deterministic floor). The Routine runner now injects pre-run Job outputs into the agent prompt so the model sees the bundle.
- **publication:** write `ingest.taxonomy.suggest` Job runs the Routine, then maps valid artifacts through the authoritative `parseSuggestionOperation`/`suggestionsToProposalInputs` gate (`@strata/ingest/taxonomy-suggestions`) and stages each well-formed suggestion as a reviewable `schema` Proposal; malformed/low-confidence ones are reported, never silently dropped.
- **trigger:** schedule `ingest.taxonomy.suggest` (or `routine.run` of the routine) after syncs; the routine surfaces on `/routines`.
- **note:** the LLM-facing `outputSchema` is intentionally loose (the routine validator has no `oneOf`); per-operation correctness is enforced deterministically at publication, not by the schema.

### Slice 3 — Feedback → prompt loop + eval harness

- **routines runtime extension:** Routine artifacts carry reviewer feedback (accept/reject/correct), exposed for prompt evals. Generic capability for all Routines.
- **eval harness:** turn the `ClassificationCorrection` corpus into eval cases; a test that scores suggester precision/recall against the corpus and flags regressions on prompt changes.
- inject recent corrections as few-shot context into the Routine prompt at runtime.

### Slice 4 — Later refinements

- Confidence/novelty/margin signals out of classification (richer queue population) — only after the generic-only well runs dry.
- Autonomous mining mode (toggleable) once the loop is trusted.
- Accumulated corrections → a small retrieval/organization eval (approach the north star).

## Risks / open questions

- **Slack-materiality cold-start:** learning *new* materiality patterns needs to see Slack, but raw Slack is the noise. Slice 1/2 keep Slack vocabulary discovery minimal; materiality-pattern learning is a separate bounded track (Slice 4).
- **Queue placement:** new route vs a `/ingest-taxonomy` tab — decide in Slice 1 UI.
- **Correction → operation fidelity:** `wrong_project` needs to add the *missing alias* that would have matched; resolving "which alias" from a correction may need a light heuristic (the matched mention) before the LLM exists.

## Sequencing

Build Slice 1 end-to-end (spine + corpus), prove the loop on real ingest, then Slice 2 (LLM) against the corpus the spine produced, then Slice 3 (eval/prompt loop). Slice 4 is opportunistic.
