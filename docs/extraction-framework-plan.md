# Strata Extraction Framework Plan

Status: implemented through Slice 6 plus the first deterministic quality pass. The first daily TODO path is live in shared ingest/extraction code, raw-to-wiki action promotion now uses it, and the next work is a model-verified quality pass over representative wiki days.

This plan defines a shared extraction framework for turning wiki and raw source evidence into durable extracted artifacts such as action items, decisions, open questions, memory candidates, or project facts. It is subordinate to [roadmap.md](./roadmap.md), [wiki-plan.md](./wiki-plan.md), and [agent-harness-plan.md](./agent-harness-plan.md).

The first implementation target is `daily.todo`: a day-by-day extractor that re-indexes wiki content into reviewed or confirmed TODO/action candidates, with Slack as the most important quality challenge.

## Goal

Extraction should become a deep module instead of scattered heuristics inside raw-to-wiki indexing.

The framework should answer:

- What source evidence was considered?
- Which spans became candidates?
- Which candidates were rejected, held for review, or published?
- Which model/prompt/extractor version made that decision?
- How can a day of wiki history be re-indexed deterministically after improving extraction quality?

The first user-facing outcome is a reliable daily TODO surface: "What action items did Strata find for today, and which historical days should be replayed?"

## Current Problem

Action extraction previously happened inside raw-to-wiki indexing:

1. Source-specific code parsed raw content.
2. Regex helpers selected action-like lines.
3. Source classification mapped those lines directly to `wiki/actions/mine.md` or `wiki/actions/theirs.md`.
4. The browser parsed the resulting Markdown ledgers.

This is too shallow as an architecture seam. Slack false positives are especially visible because agent status reports, investigation summaries, vague "we should" discussion, and quoted task output can all look action-shaped to regexes. The system also lacks a durable record of rejected candidates, so improving extraction requires rerunning samples manually and comparing wiki side effects.

## Design Principles

- Extraction is evidence-backed. Every extracted artifact keeps source path, line/span, date, extractor version, verifier version, and rationale.
- Raw sources remain immutable. Extraction can read `wiki/raw/`, generated `wiki/sources/`, and curated pages, but never edits raw snapshots.
- Deterministic extraction and LLM verification are separate phases. Rules find plausible candidates; the verifier classifies and normalizes them.
- LLM verification is constrained and optional. The framework must support deterministic-only dry runs and test fakes.
- Publication is policy-controlled. High-confidence outputs can be written; ambiguous outputs become review proposals/candidates.
- Re-indexing is day-addressable and idempotent. Replaying `2026-05-09` should not duplicate action rows.
- Framework logic lives in shared packages, not the browser. Web UI calls API procedures over stored extraction runs and candidates.

## Core Concepts

### Extraction Definition

An extraction definition describes one extraction type. Examples:

- `daily.todo`
- `source.decision`
- `source.open-question`
- `person.fact`

The definition owns:

- source selection policy
- evidence segmentation policy
- deterministic candidate rules
- verifier prompt/schema
- confidence thresholds
- dedupe/fingerprint strategy
- publication policy

Prefer object interfaces over class inheritance. TypeScript inheritance would make adapters inherit too many hooks. A definition object with narrow functions keeps the interface small and testable.

### Wiki Corpus

`WikiCorpus` loads candidate documents from the wiki. It should understand:

- `wiki/raw/<source>/...`
- `wiki/sources/<source>/...`
- curated pages such as `meetings/`, `projects/`, `decisions/`, `threads/`, and `actions/`
- frontmatter dates
- date-like path prefixes
- source metadata such as Slack channel/thread timestamps

The day-by-day TODO slice should start with raw/source/meeting documents and skip current `wiki/actions/` by default to avoid self-feeding existing action ledgers back into extraction.

### Evidence Span

An evidence span is the smallest unit the framework sends through candidate extraction:

```ts
interface EvidenceSpan {
  id: string;
  sourcePath: string;
  sourceKind: "raw" | "source" | "curated";
  sourceType: "slack" | "granola" | "notion" | "wiki";
  date: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  contextText?: string;
  metadata: JsonObject;
}
```

Slack spans should be message-level and preserve speaker, user id, bot/app markers, channel, thread timestamp, and message timestamp. Meeting/Notion/wiki spans can start as paragraph or bullet-level spans.

### Candidate

A candidate is a possible extracted artifact before verification:

```ts
interface ExtractionCandidate {
  id: string;
  extractionName: string;
  candidateKind: string;
  evidenceSpanId: string;
  candidateText: string;
  candidateHash: string;
  deterministicReasons: string[];
}
```

For TODOs, candidate kinds include:

- `direct_request`
- `self_commitment`
- `assigned_commitment`
- `checkbox`
- `owner_due`

### Verification

The verifier receives a bounded candidate packet and returns strict JSON. For `daily.todo`:

```ts
interface TodoVerification {
  classification: "action" | "not_action" | "needs_review";
  confidence: number;
  owner: "mine" | "theirs" | "unknown";
  actionText: string;
  dueDate?: string;
  rationale: string;
}
```

The prompt should emphasize negative examples:

- Agent/bot progress updates are not TODOs.
- "I checked", "I found", "Scanned the last 24 hours", and "No code change needed" are outcomes, not commitments.
- "We should" and "might need" are not TODOs unless assigned to a person or framed as an explicit action item.
- Quoted/generated task output should not create TODOs unless a human explicitly asks Strata to track or do it.

### Extraction Store

Extraction runs and candidates are persisted in SQLite through core migrations and shared ingest extraction store helpers. Current tables:

- `extraction_runs`
  - `id`
  - `name`
  - `scope_json`
  - `day`
  - `status`
  - `started_at`
  - `ended_at`
  - `extractor_version`
  - `verifier_version`
  - `model`
  - `session_id`
  - `dry_run`
  - `candidate_count`
  - `rejected_count`
  - `created_at`
  - `updated_at`
- `extraction_candidates`
  - `id`
  - `run_id`
  - `name`
  - `day`
  - `source_path`
  - `source_kind`
  - `source_type`
  - `line_start`
  - `line_end`
  - `evidence_span_id`
  - `evidence_text`
  - `candidate_hash`
  - `candidate_kind`
  - `candidate_text`
  - `status` (`confirmed`, `needs_review`, `rejected`; later publication slices can add `published`/`superseded`)
  - `verification_json`
  - `deterministic_reasons_json`
  - `metadata_json`
  - `published_target`
  - `created_at`
  - `updated_at`

This store is a local index over extraction decisions, not the canonical action ledger. Canonical published actions remain Markdown in `wiki/actions/mine.md` and `wiki/actions/theirs.md`.

## Daily TODO Extractor

`daily.todo` should be the first extraction definition.

### Source Scope

For a given day `YYYY-MM-DD`, include:

- raw Slack snapshots whose frontmatter date or thread/message timestamp falls on that day
- generated Slack source pages for that day
- raw Granola snapshots and curated meeting pages for that day
- raw Notion snapshots with that date
- curated project/thread pages changed or sourced by that day, only after the first raw/source pass works

Exclude by default:

- `wiki/actions/` to avoid re-ingesting already published actions
- `wiki/log.md`
- superseded redirect pages
- raw files outside the requested day unless included as nearby Slack thread context

### Day Re-indexing

The day-by-day re-indexer should support:

```bash
bun run strata extract daily-todos --date 2026-05-09 --dry-run
bun run strata extract daily-todos --date 2026-05-09 --dry-run --verify --model <model>
bun run strata extract daily-todos --date 2026-05-09 --review
bun run strata extract daily-todos --date 2026-05-09 --apply
bun run strata extract daily-todos backfill --from 2026-05-01 --to 2026-05-29 --dry-run
```

Semantics:

- `--dry-run`: produce a trace-backed run and candidate counts without writing wiki action ledgers.
- `--review`: persist candidates as pending review items/proposals but do not append action rows.
- `--apply`: publish only high-confidence confirmed candidates; medium-confidence candidates remain pending.
- `backfill`: process each day independently, recording one extraction run per day so failures are isolated and resumable.

Backfill must be resumable:

- skip a day if the same extractor version and verifier version already completed it, unless `--force`
- dedupe by candidate hash plus source path/span
- when a candidate was previously rejected, do not republish it unless `--force-rejected`
- when a published action already exists with the same source link and normalized action text, treat it as already published

### Publication

For confirmed TODOs:

- `owner = mine` publishes to `wiki/actions/mine.md`
- `owner = theirs` publishes to `wiki/actions/theirs.md`
- `owner = unknown` stays pending review

Published rows should use concise normalized action text and keep the source link:

```markdown
- [ ] Add Roomote to C0B1NV3CWN5 and retry the mention. (source: [[sources/slack/c0av13n7uea/2026-05-09-1778331612-platform-issue-alert|Platform issue alert]])
  <!-- strata:action-context {"extractionCandidateId":"...","createdAt":"2026-05-09T12:34:56.000Z"} -->
```

The hidden context metadata can later carry confidence/rationale if useful, but verbose rationale should stay in the extraction store and trace rather than cluttering the wiki ledger.

### Review UI

After the CLI slice works, `/actions` should gain a review mode:

- confirmed today
- pending candidates
- rejected candidates
- source evidence preview
- accept/reject controls
- "not an action" feedback that persists to the extraction store

Accepting a candidate publishes it to the Markdown ledger. Rejecting it marks the candidate rejected and prevents future automatic publication for the same extractor version unless forced.

## Framework Implementation Slices

### Slice 1 - Types And Deterministic Runner

Status: implemented in `packages/ingest/src/extraction/` and exported as `@strata/ingest/extraction`.

Add `packages/ingest/src/extraction/` with:

- shared extraction types
- wiki corpus day resolver
- evidence span segmenters for Slack and generic Markdown
- deterministic `daily.todo` candidate extractor
- fake verifier for tests
- dry-run result object and trace events

No LLM calls and no wiki writes in this slice.

Acceptance:

- unit tests cover Slack message segmentation, bot/agent suppression, and day selection
- fixture tests prove bad current examples such as agent investigation summaries do not become TODOs
- dry-run returns candidate/rejected counts by source/day
- `runDailyTodoExtractionDryRun()` creates trace-backed `extraction.daily_todo.*` events without LLM calls, browser UI, or wiki writes

### Slice 2 - Extraction Store And CLI

Status: implemented in core migrations, `packages/ingest/src/extraction/store.ts`, and `strata extract daily-todos`.

Add local SQLite tables and CLI commands for daily TODO extraction.

Acceptance:

- `strata extract daily-todos --date ... --dry-run --json` works
- repeated dry runs are idempotent through source-span/candidate-hash dedupe
- `backfill --from --to` records per-day results and can resume by skipping completed same extractor/verifier/day runs unless forced
- trace events include source path, candidate hash, status, and reasons
- dry-run persistence remains a local extraction index only; it does not write `wiki/actions/`

### Slice 3 - LLM Verifier

Status: implemented in `packages/ingest/src/extraction/modelTodoVerifier.ts` and the CLI `--verify` path.

Add model-backed verification behind an explicit flag or config. The default dry-run path still uses `fakeDailyTodoVerifier`, while `strata extract daily-todos ... --verify [--provider P] [--model M]` builds a model-backed verifier through the shared model factory. Hard deterministic suppressions such as bot/status output and `search: 999` tool-count output are rejected before any model call. Other verifier responses are schema checked before being trusted; malformed JSON, malformed fields, and model failures keep the candidate as `needs_review` with an explicit rationale. `extraction_runs.model`, trace events, and result output record the verifier prompt version and model name when model verification is used.

Acceptance:

- verifier can be faked in tests
- live verifier returns schema-validated JSON
- invalid JSON or model failure degrades candidates to `needs_review`, not auto-published
- extractor/prompt/model versions are stored on every run

### Slice 4 - Review And Publication

Status: implemented in `runDailyTodoExtractionApply()`, `strata extract daily-todos --apply`, and the shared wiki action ledger helpers.

Publish high-confidence candidates and expose pending review. `--apply` reruns the same evidence-backed extraction path, persists the run with `dry_run = false`, publishes only confirmed high-confidence candidates with `owner = mine` or `owner = theirs`, and leaves unknown-owner, low-confidence, needs-review, rejected, and previously rejected candidates out of the Markdown ledgers. Published actions keep source wikilinks plus hidden `strata:action-context` metadata carrying extraction run/candidate ids, source path/lines, confidence, and version fields. Duplicate action rows are suppressed by normalized action text plus source target.

Acceptance:

- `--apply` writes only confirmed high-confidence TODOs to Markdown action ledgers
- existing `wikiActions` parsing still works
- rejected candidates are not republished on rerun
- source links and hidden `strata:action-context` metadata are preserved

### Slice 5 - Web Review UX

Status: implemented in the extraction store review APIs, `packages/web-api` tRPC procedures, and the `/actions` review queue.

Expose extraction runs and pending candidates through web-api and `/actions`.

Acceptance:

- `/actions` can show today's confirmed actions and pending extracted candidates
- accept/reject works without editing raw sources
- browser actions call shared APIs; extraction logic stays in `@strata/ingest` and `@strata/core`

### Slice 6 - Raw-To-Wiki Integration

Status: implemented in `packages/ingest/src/rawToWiki.ts` and `packages/ingest/src/extraction/dailyTodo.ts`.

Gradually replace direct action promotion in raw-to-wiki with extraction framework calls.

Acceptance:

- raw-to-wiki can still create source/meeting/project/decision pages
- action promotion flows through `daily.todo` candidate persistence/publication
- existing raw-to-wiki activity events link to extraction run/candidate ids
- action-shaped tool/status output such as `search: 999` is rejected by the shared TODO suppressions before it reaches `wiki/actions/`

### Post-Slice 6 - Backfill Quality Pass

Run representative day-by-day TODO backfills against recent local wiki/raw content and compare the review queue against known good/false-positive samples before broad publication.

Status: first deterministic pass complete on 2026-05-29. Forced dry runs over 2026-05-11..2026-05-12 and 2026-05-29 drove shared daily.todo fixes for Slack snapshot dedupe, raw/curated source dedupe, terse acknowledgements, service-ticket payloads, preference questions, weak assigned-commitment matches, and `Update:` status reports. The next quality pass should use `--verify` on selected days and inspect remaining ambiguous direct asks.

Acceptance:

- `strata extract daily-todos backfill --from ... --to ... --dry-run --json` produces inspectable per-day candidate/rejection counts
- `/actions` review remains usable with candidates produced both by backfill and raw-to-wiki
- any new false-positive fixes land in the shared `daily.todo` definition or taxonomy, not as source-specific browser code

## Open Decisions

- Resolved: core owns SQLite schema/migrations, while `@strata/ingest/extraction` owns the extraction store API and daily TODO persistence semantics.
- Whether pending candidates should be stored only in SQLite or also represented as `Proposal` records. Initial recommendation: SQLite for candidate lifecycle, `Proposal` only for broad or risky wiki edits.
- Resolved for the first verifier slice: verifier calls are opt-in and use the existing model factory with explicit `--provider`/`--model` overrides. Deterministic fake verification remains the default for dry runs and tests until live model preferences are clearer.
- Whether `daily.todo` should eventually sync into runtime `Todo` learning artifacts. Initial recommendation: no. Wiki action ledgers remain user-facing commitments; runtime Todos remain agent-run task state.

## Validation Strategy

Start with golden fixtures from real Slack false positives already present in the wiki:

- agent investigation summaries
- Sentry triage reports
- release status reports
- "what have we been talking about" summaries
- vague "we should" discussion

For each fixture, assert:

- deterministic candidate status
- verifier input packet shape
- verification result handling
- publication decision

Then add true-positive fixtures:

- direct human ask to a named person or bot
- self commitment from a human-readable speaker
- explicit `Action item:` / `Owner:` / `Due:` line
- meeting follow-up assigned to a person

The framework is not done until rerunning a representative day produces fewer false positives than current raw-to-wiki action extraction while preserving real asks.
