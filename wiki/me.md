---
type: profile
last_updated: 2026-04-28
wiki_location: sandbox
granola_access_path: sync
bootstrap_depth: start_fresh
---

# Me

## Role

TBD by the user.

## Active Projects

- TBD by the user.

## Current Focus

- TBD by the user.

## Preferences

- Keep source material immutable under `raw/`.
- Prefer concise, citation-backed summaries over exhaustive capture.
- Avoid storing secrets, tokens, or sensitive personal data in the wiki.

## Phase 0 Decisions

| Decision | Status | Current value | Notes |
|---|---|---|---|
| Granola access path | Resolved for scaffold | Sync path | No API token or documented API base URL is configured in this repo. Use `docs/granola-sync-setup.md` until the user provides API details. |
| Wiki location | Resolved | Sandbox repo at `/home/exedev/Documents/cortex` | User can clone or pull this repo on macOS for Obsidian browsing. |
| Bootstrap depth | Resolved for scaffold | Start fresh from 2026-04-28 | Backfill should be explicitly opted into before ingesting historical sources. |
| Slack scope | Pending | TBD | Confirm workspaces, channels, DMs, and exclusions before enabling Slack pulls. |
| Notion scope | Pending | TBD | Confirm full workspace vs. specific pages/databases before enabling Notion pulls. |

## Source Scope Defaults

### Slack

- Include threads where the user is mentioned.
- Include DMs and group DMs above 3 messages.
- Include starred or favorited channels above 5 messages.
- Skip bot messages, social channels, and muted channels.

### Notion

- No default scope. The user must provide page IDs, database IDs, or workspace rules.
