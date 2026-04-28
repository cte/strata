# Work Wiki Tools

These scripts are small helpers around the workflows in `CLAUDE.md`.

The implementation lives in `src/tools/*.ts`. Build and type-check with the
TypeScript 7 beta native compiler (`tsgo`), provided by
`@typescript/native-preview@beta`.

## Connectors

- `pullGranola.ts` writes meeting transcripts to `raw/granola/` from a documented Granola API endpoint supplied in `.env`.
- `granola-sync-setup.md` documents the Mac-side sync fallback when Granola API access is unavailable.
- `pullSlack.ts` writes one Slack thread to `raw/slack/` from either Slack Web API access or a captured JSON file.
- `pullNotion.ts` snapshots one Notion page to `raw/notion/`.

Connector output is raw source material. Treat generated files under `raw/` as immutable after creation.

## Maintenance

- `lintWiki.ts` writes a health-check report to `meta/lint/lint-YYYY-MM-DD.md`.

Run scripts from the wiki root:

```sh
npm run check
npm run build
npm run lint:wiki
```

If Bun is installed, source files can also be run directly:

```sh
bun src/tools/lintWiki.ts
```
