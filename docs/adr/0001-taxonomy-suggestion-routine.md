---
status: accepted
date: 2026-05-30
---

# Taxonomy suggestions: a review-gated LLM Routine, not a deterministic miner

## Context

The ingest taxonomy (`.strata/ingest/taxonomy.json`) is the lever for wiki organization quality, but nothing populates it — entries are only ever added by hand. We want a learning loop that proposes taxonomy entries from real ingest evidence, the reviewer gives feedback, and that feedback improves future runs. This is structurally an **Extraction**, which the codebase deliberately *removed* (`daily.todo`) after poor results — so re-introducing an LLM extraction is surprising without this context. The reviewer's lived takeaway is that `daily.todo` failed because of **Slack noise**, not because LLM extraction is inherently unreliable.

## Decision

Build the taxonomy suggester as an **LLM-forward, review-gated `Routine`** (run via `routine.run`), not a deterministic miner or a bespoke job.

- **The LLM does the thinking** — selecting which classification outcomes are review-worthy, judging them, drafting corrections, and phrasing the derived taxonomy operations.
- **The only deterministic guardrails are safety + cost**, not intelligence: source-weighting (project/self-name vocabulary discovered from clean Granola/Notion), the **Slack materiality pre-filter** (the LLM never sees the raw Slack firehose — this *is* the noise defense), and volume/time bounds.
- **Safety comes from the review gate and reversible stakes**, not from avoiding the LLM: every output is a `schema` **Proposal** the reviewer confirms; it only changes *future* classification (config), never `/actions` content.
- **Surface:** a curated daily review queue of classification *outcomes* (e.g. "this meeting → Atlas Portal — right?"). Typed reviewer verdicts are the feedback unit (see *Classification correction* in `CONTEXT.md`); taxonomy changes are derived from corrections; the existing Proposal store is reused rather than a parallel review surface.
- **Learning is human-in-the-loop prompt engineering:** captured verdicts form a labeled corpus that (a) tunes the Routine's prompt offline, (b) is the regression test set guarding that tuning, (c) suppresses rejected items, and (d) grows the taxonomy.
- **Success metric** is suggestion-vs-feedback (accept rate; recall against vocabulary the reviewer ends up adding) plus a taxonomy-coverage trend. Retrieval precision/recall is the believed-in **north star but not the gate** (too expensive/indirect to measure, and taxonomy is only one lever alongside entity consolidation).
- A general **Routine capability** falls out: Routine artifacts carry reviewer feedback that feeds prompt evals — useful for every future Routine.

## Considered options

- **Deterministic miner (count recurring generic-rule matches → propose).** Rejected: it can't do the entity-linking judgment the empty-taxonomy cold-start needs, and the reviewer explicitly prefers leaning on the LLM.
- **Defer the LLM to v2; ship a deterministic v1.** Rejected: it mis-reads the `daily.todo` failure as "LLMs are unreliable." The failure was Slack noise; the correct defense is source-weighting + materiality pre-filtering, not removing the LLM.
- **A bespoke `taxonomy.suggest` job.** Rejected: a prompt-driven, structured-output, review-published workflow is the literal definition of a Routine and the anti-pattern for a bare Job (which runs outside the model loop).
- **Point the LLM at raw Slack and trust it to filter noise.** Rejected: that is the failure mode that sank `daily.todo`.

## Consequences

- Re-opens automated extraction, which `extraction-framework-plan.md` paused — but constrained to low-stakes, reversible config behind review, and routed through the blessed Routine + Proposal path the reset prescribed.
- The Slack materiality pre-filter is load-bearing for quality, and there is a cold-start dependency: discovering *new* Slack materiality patterns is a separate, bounded track, since cleaning Slack evidence depends on patterns the loop is still learning.
- Requires extending the Routine runtime to capture reviewer feedback on artifacts and expose it for prompt evals.
