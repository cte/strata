# Cortex — Schema and Operating Manual

This wiki exists so the user never loses track of priorities and can quickly recall past work, decisions, and commitments.

The user curates sources and asks questions. You (Claude) do everything else.

## Read first, every session
1. `priorities.md` — what matters right now.
2. `me.md` — role, active projects, current focus, preferences.
3. `index.md` — what's in the wiki.

## Sources (raw/, immutable)
- `raw/granola/` — meeting transcripts.
- `raw/slack/` — captured threads matching filter rules.
- `raw/notion/` — Notion doc snapshots.

You read from `raw/`. You never write to it.

## Entity types
- **People** — `people/<name>.md`. Role, what they own, current focus, recent interactions, open threads.
- **Projects** — `projects/<slug>.md`. Goal, status, decisions, open threads, key people.
- **Decisions** — `decisions/YYYY-MM-DD-<slug>.md`. Atomic. Outcome on top, context below, source linked. Never deleted; superseded by linking forward.
- **Threads** — `threads/<slug>.md`. Open questions in flight. Closed by linking forward to the decision that resolved them.
- **Meetings** — `meetings/YYYY-MM-DD-<slug>.md`. Summary, decisions, actions, threads.
- **Actions** — `actions/mine.md` (what I owe) and `actions/theirs.md` (what's owed to me).

All pages have YAML frontmatter (see project plan §6).

## Workflows

### Ingest — Granola meeting
1. Read `raw/granola/<file>`.
2. Write `meetings/<date>-<slug>.md` with summary.
3. Update affected `projects/` and `people/` pages.
4. Extract decisions → `decisions/`.
5. Extract action items → `actions/mine.md` or `actions/theirs.md`.
6. Open or close threads → `threads/`.
7. Update `index.md`. Append `log.md`.
8. Commit. Tell the user: what changed, what they should know about, anything that contradicts prior wiki claims.

### Ingest — Slack thread
Same shape. But: many threads add nothing — that's correct, skip them. Surface only material content (decisions, commitments, new threads, factual updates).

### Ingest — Notion doc
Same shape. Notion is already curated, so most updates are: link from project page, extract any decisions or new commitments, snapshot into `raw/notion/`.

### Query
1. Read `priorities.md`, `me.md`, `index.md`.
2. Identify candidate pages, read them and one hop of links.
3. Synthesize answer with wiki-page citations.
4. If reusable, offer to file the synthesis back as a new wiki page.

### Lint (weekly or on request)
- Open threads >30 days old.
- Stale priorities.
- Decisions referenced but no page exists.
- Orphan pages.
- Contradictions across pages.
- Action items past due.

Output to `meta/lint/lint-YYYY-MM-DD.md`. Discuss with user.

## Conventions
- Wikilinks: `[[Canonical Name]]`.
- Filenames: lowercase kebab-case; date-prefix decisions and meetings.
- Frontmatter on every page.
- `log.md` entries: `## [YYYY-MM-DD HH:MM] <op> | <title>`.
- Commits: `ingest: <source> | <title>`.

## Don'ts
- Never edit `raw/`.
- Never delete a decision page; supersede.
- Never auto-ingest Slack threads outside filter rules without asking.
- Never silently overwrite — surface contradictions.
- Never write secrets into the wiki.
- Never skip `index.md` / `log.md` updates.

## When in doubt
Ask the user. The schema co-evolves with use; flag things that don't fit, propose updates to this file.
