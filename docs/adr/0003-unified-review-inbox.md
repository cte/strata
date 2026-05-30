---
status: accepted
date: 2026-05-30
---

# One review inbox; taxonomy is edited through review, not a config page

## Context

Reviewing and configuring had drifted into three confusing surfaces:

- **`/proposals`** — the generic apply-gate for every staged change (`wiki`, `memory`, `skill`, `schema` learning proposals).
- **`/ingest-taxonomy`** — a page that mixed *two unrelated activities*: a **review queue** of raw-to-wiki classification outcomes the taxonomy couldn't explain, and a **config UI** of vocabulary lists (projects + aliases, self-names, Slack patterns).
- The taxonomy review queue stayed **upstream** of `/proposals`: confirming/correcting a classification only *staged* a `schema` proposal, which then had to be approved *again* on `/proposals`.

This produced two problems. First, **two review surfaces** for overlapping work ("things I need to judge") with a confusing double-approval for taxonomy. Second, the config UI exposed raw taxonomy plumbing (Slack pattern fields, self-names) that is unintelligible without context and was empty by default — scaffolding for a concept nobody had explained.

The reviewer's intent: collapse to **one place to review**, and stop treating the taxonomy as something you hand-edit.

## Decision

**One `/review` inbox; the taxonomy is maintained through review, not a settings page.**

- **`/review` is the single review surface.** It contains the classification **review queue** (teach the taxonomy from ingest outcomes) and the **proposals** master/detail (approve staged `wiki`/`memory`/`skill`/`schema` changes). `/proposals` is removed and folded in.
- **A reviewer correction applies immediately.** Confirming/correcting a classification *is* a human verdict, so it edits the taxonomy directly via `applyIngestTaxonomyOperation` — no second approval. The `classification_corrections` row is still written as durable feedback / eval ground truth. Only **LLM-generated** suggestions (the `ingest.taxonomy.suggest` Routine) go through the proposal gate, because those are machine judgment.
- **`/ingest-taxonomy` is removed entirely.** The taxonomy is now edited only two ways: reviewer corrections (apply immediately) and reviewed LLM suggestions. There is no manual vocabulary-list UI. The CLI (`strata ingest taxonomy …`) remains the power-user / scripting escape hatch. The orphaned `ingest.taxonomy` management tRPC mutations, their services + `api.ts` wrappers, and the legacy `profile.json` loader path were all deleted (no legacy support retained).
- **The taxonomy concepts are intentionally backstage.** Projects/aliases, self-names, and Slack patterns are how the classifier reads the workspace; users should never need to reason about them directly. They are produced as a side effect of reviewing concrete, legible outcomes ("this meeting is about Roo Code", "this Slack message is noise").

## Consequences

- The two review modes — *teach the taxonomy* and *approve staged changes* — live on one page, grouped (queue capped with a "show all" expander so proposals stay reachable). The reviewer rejected a tabbed split in favor of one scannable inbox.
- Direct corrections lose the proposal audit trail, by design; the `classification_corrections` table is the record. LLM suggestions keep the gate.
- Removing the config UI means a correction or an LLM suggestion is the *only* in-app path to grow the taxonomy. If a gap appears (vocabulary not tied to any review-queue item), the CLI covers it until a need for a richer surface is proven.
