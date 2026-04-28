# Cortex — Personal Work Wiki Build Plan

A plan for Claude Code to build and maintain a personal work wiki, following the LLM Wiki pattern (Karpathy, 2026).

---

## 1. Goal

Build a persistent, LLM-maintained knowledge base for the user. Two non-negotiable outcomes:

1. **Priority awareness** — the user never loses track of what's important right now.
2. **Fast recall** — past work, decisions, commitments, and context are retrievable in seconds.

The wiki is a compounding artifact. The user curates sources and asks questions. You (the agent) do all the bookkeeping: summarizing, cross-referencing, filing, updating, and maintaining consistency across pages.

**Sources:** Granola meeting transcripts, Slack threads, Notion documents.

**User environment:** macOS (Granola, Obsidian for browsing). Agent runs on a Linux sandbox.

---

## 2. Architecture

Three layers, per the LLM Wiki pattern:

| Layer | Owns | Mutability |
|---|---|---|
| **Raw sources** | The user (via tools / sync) | Immutable. The agent reads but never edits. |
| **The wiki** | The agent | The agent creates, updates, cross-references. |
| **The schema** (`CLAUDE.md`) | Co-evolved by user + agent | Updated as conventions stabilize. |

---

## 3. Decisions to Resolve in the First Session

Before building, ask the user and record the answers in `me.md`:

1. **Granola access path** — does the user have a Granola API token?
   - If **yes**: build a Linux-side puller (Phase 2a).
   - If **no**: default to a Mac-side `launchd` job that rsyncs new transcripts into `raw/granola/` over a shared path or git remote (Phase 2b).
2. **Wiki location** — pick one:
   - **Default**: wiki lives in the sandbox; user runs `git pull` on Mac to browse in Obsidian (one-cycle delay, simplest).
   - **Alternative**: wiki lives in a synced folder (Syncthing / iCloud / Dropbox) so Obsidian sees agent edits in real time.
3. **Slack scope** — which workspaces and channels are in scope? Confirm filter rules (defaults below in §7).
4. **Notion scope** — full workspace, or specific top-level pages / databases?
5. **Bootstrap depth** — backfill the last 2–4 weeks of sources, or start fresh from today?

Do not begin Phase 1 until at least decisions 1, 2, and 5 are settled. Decisions 3 and 4 can be refined during Phase 2.

---

## 4. Directory Structure

```
cortex/
├── CLAUDE.md                   # Schema — read on every session start
├── priorities.md               # Current priorities — read first every session
├── me.md                       # Role, active projects, current focus, prefs
├── index.md                    # Catalog of all wiki pages
├── log.md                      # Append-only chronological history
│
├── raw/                        # IMMUTABLE source material
│   ├── granola/                # Meeting transcripts (YYYY-MM-DD-slug.md)
│   ├── slack/                  # Captured threads (YYYY-MM-DD-channel-slug.md)
│   └── notion/                 # Notion doc snapshots at ingest time
│
├── people/                     # One page per colleague
├── projects/                   # One page per active project
├── teams/                      # One page per team / org unit
├── meetings/                   # One summary page per meeting
├── decisions/                  # One page per decision (atomic, dated)
├── threads/                    # Open questions still in flight
└── actions/
    ├── mine.md                 # What I owe others
    └── theirs.md               # What others owe me
```

Initialize as a git repo. Every ingest is a commit. The log message is the source title.

---

## 5. Build Phases

### Phase 0 — Decisions

Resolve the items in §3. Write `me.md` with the user's role, active projects, top-of-mind concerns, and the resolved decisions. This is the agent's session-start context anchor for everything that follows.

### Phase 1 — Skeleton

Create the directory structure in §4. Materialize:

- `CLAUDE.md` (full content in §10 below)
- `priorities.md` — start as a placeholder; the user will populate or dictate.
- `me.md` — populated from the Phase 0 conversation.
- `index.md` — empty catalog with section headers (People, Projects, Teams, Meetings, Decisions, Threads).
- `log.md` — empty, with header `# Cortex — Activity Log`.
- `actions/mine.md`, `actions/theirs.md` — empty checklists.
- `.gitignore` — exclude `raw/.cache/`, `.env`, anything secret.

Initialize git. First commit: "Initial wiki skeleton."

### Phase 2 — Source connectors

Set up each source. Test each one with a single sample fetch before moving on.

#### 2a. Granola (API path)
Build a small Python or Node script `tools/pull_granola.py`:
- Authenticates with the API token from `.env`.
- Lists meetings since `--since` (default: last 24h).
- Writes each transcript to `raw/granola/YYYY-MM-DD-<slug>.md` with frontmatter (date, attendees, source URL).
- Idempotent — re-running does not duplicate.

#### 2b. Granola (sync path)
If no API access, document the Mac-side setup in `tools/granola-sync-setup.md`:
- A `launchd` plist that runs every 15 minutes.
- Fetches new transcripts from Granola's local export folder.
- `git push`es into the wiki repo, or rsyncs into the synced folder.

#### 2c. Slack
Use the official Slack MCP server (or a community one with read access). Configure in the agent's MCP config:
- Read access to the channels in scope.
- A `tools/pull_slack.py` script that, given filter rules from `me.md`, pulls matching threads and writes them to `raw/slack/`.
- Each thread written as a single file with all messages, threaded, including reactions.

#### 2d. Notion
Use the official Notion MCP server. Configure with the workspace token. Build a `tools/pull_notion.py` that, given a page ID or recent-edits query, snapshots the doc into `raw/notion/`.

### Phase 3 — Ingest workflows

Implement each ingest workflow as documented in §10. The pattern is the same for all three sources:

1. Read the raw item.
2. Identify which entities it touches (people, projects, teams).
3. Write or update the relevant pages (meeting summary, project, person).
4. Extract decisions → `decisions/`.
5. Extract action items → `actions/mine.md` or `actions/theirs.md`.
6. Surface open threads → `threads/`.
7. Update `index.md`. Append to `log.md`.
8. Commit. Discuss with the user what changed and what they should attend to.

A single Granola or Notion ingest typically touches 8–15 files. A single Slack ingest may touch 0 files (most threads add nothing). That's correct behavior.

### Phase 4 — Query workflow

When the user asks a question:

1. Read `priorities.md`, `me.md`, and `index.md` first for context.
2. Identify candidate pages from `index.md`.
3. Read those pages and any pages they link to (one hop).
4. Synthesize an answer with citations to the wiki pages used.
5. **If the answer is reusable**, offer to file it back as a new wiki page (e.g., `projects/foo/comparison.md`, `decisions/YYYY-MM-DD-bar.md`). Don't let useful synthesis disappear into chat history.

For larger queries (more than ~5 candidate pages), shell out to a search tool over the wiki — `grep -r`, `ripgrep`, or a local search index — rather than reading `index.md` linearly.

### Phase 5 — Lint workflow

Weekly (or on user request), run a wiki health-check:

- Open threads older than 30 days — still open?
- Priorities that haven't been touched in recent ingests — still real?
- Decisions referenced from other pages but with no decision page?
- Orphan pages with no inbound links.
- Concepts mentioned across many pages but lacking a page of their own.
- Contradictions across pages.
- Action items past their due date.

Output a `lint-YYYY-MM-DD.md` report in `meta/lint/`. Discuss findings with the user.

### Phase 6 — Bootstrap

If the user opted into backfill (decision 5), pull the last N weeks of Granola transcripts, in-scope Slack threads, and recent Notion edits. Ingest them in chronological order — older first — so that later events can update earlier-derived entities. Commit after each ingest, not as one giant commit.

---

## 6. Entity Schemas

All wiki pages have YAML frontmatter so Obsidian Dataview can query them.

### People (`people/<name>.md`)
```yaml
---
type: person
role: <their role>
team: <team name>
last_interaction: YYYY-MM-DD
status: active | dormant
---
```
Sections: **Owns / Leads**, **Current focus**, **Recent interactions** (most recent first), **Open threads with this person**, **Notes**.

### Projects (`projects/<slug>.md`)
```yaml
---
type: project
status: active | paused | done | dropped
priority: P0 | P1 | P2
key_people: [name, name]
last_updated: YYYY-MM-DD
---
```
Sections: **Goal**, **Status** (current state, one paragraph), **Decisions** (links), **Open threads**, **Timeline**, **Source meetings/docs**.

### Decisions (`decisions/YYYY-MM-DD-<slug>.md`)
```yaml
---
type: decision
date: YYYY-MM-DD
project: <slug>
people: [name, name]
status: active | superseded
superseded_by: <link or null>
---
```
Top of page: **Outcome** in one sentence. Then **Context**, **Considered alternatives**, **Source** (link to meeting/thread/doc).

Decisions are never deleted. If reversed, mark `status: superseded` and link forward to the new decision.

### Threads (`threads/<slug>.md`)
```yaml
---
type: thread
opened: YYYY-MM-DD
project: <slug>
people: [name]
status: open | resolved
resolved_by: <decision link or null>
---
```
Sections: **Question**, **What we know**, **What we need**, **History** (chronological updates).

### Meetings (`meetings/YYYY-MM-DD-<slug>.md`)
```yaml
---
type: meeting
date: YYYY-MM-DD
attendees: [name, name]
project: <slug>
source: raw/granola/<file>
---
```
Sections: **Summary** (3–5 sentences), **Decisions surfaced** (links), **Action items** (links), **Open threads opened/closed**, **Notable quotes**.

---

## 7. Slack Filter Defaults

Default filter rules — refine with the user during Phase 2c:

- All threads where the user is `@`-mentioned.
- All DMs and group DMs above 3 messages.
- All threads in starred / favorited channels above 5 messages.
- Skip: bot messages, social channels, anything in muted channels.

Most matched threads will produce **no wiki update**. The agent reads, decides nothing material was added, and skips. Resist over-capturing — wikis rot from noise faster than from gaps.

---

## 8. Conventions

- **Wikilinks**: `[[Project Name]]`, `[[Person Name]]`. Match canonical filenames.
- **Filenames**: lowercase, kebab-case slugs. Decisions and meetings prefix with date: `YYYY-MM-DD-<slug>.md`.
- **Frontmatter**: every wiki page has YAML frontmatter (see §6).
- **Citations**: every wiki claim that comes from a source links back to the raw file (`raw/granola/2026-04-15-q2-planning.md`) or the wiki summary that came from it.
- **Log format**: `## [YYYY-MM-DD HH:MM] <op> | <title>` — keeps `log.md` greppable: `grep "^## \[" log.md | tail -10`.
- **Commit messages**: `ingest: <source> | <title>`, `query: <topic>`, `lint: <date>`, `update: <reason>`.

---

## 9. Don'ts

- Never edit anything in `raw/`. It is the immutable source of truth.
- Never delete a decision page. Mark superseded; link forward.
- Never auto-ingest Slack threads that don't match the filter rules without asking the user first.
- Never silently overwrite a wiki page when ingesting — always diff-and-merge. If a fact contradicts an existing claim, surface the contradiction in the page (and in `log.md`) rather than overwriting.
- Never write secrets, tokens, or PII into the wiki. They go in `.env`, gitignored.
- Never skip the `index.md` and `log.md` updates. They are the navigation backbone.

---

## 10. CLAUDE.md (write this verbatim into the wiki root)

````markdown
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
````

---

## 11. First Session Checklist

When the user runs `claude` in the wiki directory for the first time, the agent should:

1. Greet the user. Acknowledge this is session 1.
2. Walk through the §3 decisions, one at a time.
3. Populate `me.md` based on the conversation.
4. Build the directory skeleton (Phase 1).
5. Confirm Phase 2 connectors with the user before configuring them.
6. If bootstrap was opted into, run Phase 6.
7. End with a summary: what was built, what's connected, what to do next session.

---

## 12. Iteration Plan

This plan is a starting point, not a final spec. Expect to refine:

- **Week 1** — verify the ingest loop works end-to-end on real meetings/threads/docs. Tune filter rules.
- **Week 2** — refine entity schemas based on what queries the user actually asks. If priority recall is weak, strengthen `priorities.md` updates in the ingest workflow.
- **Week 4** — first lint pass. Address whatever the wiki has accumulated. Update `CLAUDE.md` with lessons learned.
- **Ongoing** — `CLAUDE.md` is co-evolved. Whenever the user says "next time, do X instead of Y," propose the corresponding edit to `CLAUDE.md`.

The wiki gets more valuable the longer it runs. Treat the first month as bootstrapping; the compounding starts in month two.
