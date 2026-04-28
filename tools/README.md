# Work Wiki Tools

These scripts are small helpers around the workflows in `CLAUDE.md`.

## Connectors

- `pull_granola.py` writes meeting transcripts to `raw/granola/` from a documented Granola API endpoint supplied in `.env`.
- `granola-sync-setup.md` documents the Mac-side sync fallback when Granola API access is unavailable.
- `pull_slack.py` writes one Slack thread to `raw/slack/` from either Slack Web API access or a captured JSON file.
- `pull_notion.py` snapshots one Notion page to `raw/notion/`.

Connector output is raw source material. Treat generated files under `raw/` as immutable after creation.

## Maintenance

- `lint_wiki.py` writes a health-check report to `meta/lint/lint-YYYY-MM-DD.md`.

Run scripts from the wiki root:

```sh
python3 tools/lint_wiki.py
```
