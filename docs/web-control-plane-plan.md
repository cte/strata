# Strata Web Control Plane Plan

Status: initial skeleton present.

This plan covers a local web app for configuring and operating Strata connectors. It is subordinate to [roadmap.md](./roadmap.md), [agent-harness-plan.md](./agent-harness-plan.md), and [wiki-plan.md](./wiki-plan.md).

The first skeleton exists under `apps/web` with a thin Hono + tRPC local API in `packages/web-api`. The current UI is intentionally narrow: connector list, Notion validate/dry-run/pull, Granola API key configuration, Slack status, and an experimental Notion MCP OAuth/tool-discovery path. Granola raw pulls and Slack thread pulls exist in the shared connector runner and CLI. Slack also has checkpointed sync and a basic Socket Mode listener in the CLI. Web pull controls, schedules, proposal review, and persisted non-secret connector config remain planned.

## Objective

Build a local browser UI that makes Strata easier to set up and operate without turning Strata into a cloud service.

The web control plane should help the user:

- Configure Notion, Granola, Slack, and future connectors.
- Validate connector credentials and permissions.
- Select source scopes such as Notion pages, Slack channels, and Granola sync locations.
- Run dry-runs and one-off pulls.
- Inspect recent ingest sessions, failures, reports, and raw snapshot paths.
- Configure recurring connector pulls and maintenance jobs.
- Review and apply or reject proposals created by ingest, reflection, and maintenance.

The web app is an operations surface. It is not the agent runtime, not the connector implementation, and not the wiki.

## Product Shape

The initial web app should be a local control plane with these sections:

- `Overview`: connector health, last pulls, pending proposals, recent failures, next scheduled jobs.
- `Connectors`: setup and status pages for Notion, Granola, and Slack.
- `Ingest`: dry-run and pull controls, recent raw snapshots, raw-to-wiki ingest status.
- `Schedules`: local recurring jobs for source pulls, wiki lint, stale actions, memory review, and skill inventory.
- `Proposals`: staged wiki/schema/skill/memory changes with diff, apply, reject, and defer actions.
- `Sessions`: searchable ingest, maintenance, reflection, and agent traces.
- `Settings`: model provider summary, local paths, and non-secret connector metadata.

The UI should optimize for clarity and auditability over breadth. Every operation that mutates wiki content or learning artifacts should link to the session trace or proposal that explains it.

## Architecture

Connector logic belongs in shared packages:

```text
packages/
  ingest/      Connector contracts, registry, runner, secret store, and source-specific pullers
  core/        Paths, session store, runtime state, shared types
  agent/       Maintenance, reflection, proposal workflows
  web-api/     Hono + tRPC local HTTP API over shared packages
apps/
  web/         Browser UI
```

The CLI, TUI, scheduler, and web app should all call the same connector APIs. Do not fork connector behavior into HTTP route handlers or React components.

The current connector runtime foundation lives under `packages/ingest/src/connectors/`:

- `types.ts`: connector definitions, capabilities, statuses, normalized source document/checkpoint/failure types, and redaction helpers.
- `registry.ts`: source connector registry for Notion, Granola, and Slack.
- `runner.ts`: trace-backed dry-run/pull execution that owns ingest sessions and redacts secret config before writing events.
- `store.ts`: local gitignored connector secret records under `.strata/secrets/<connector>.json`.
- `checkpointStore.ts`: local connector checkpoints under `.strata/connectors/<connector>/checkpoint.json`.

The browser should consume typed tRPC procedures from `packages/web-api/src/trpc.ts`. Keep that router module browser-safe for type imports: router shape and shared DTO types belong there, while Bun, SQLite, filesystem, connector runtime, and session-writing implementation belong in server-side service modules.

The Notion MCP experiment lives alongside the deterministic Notion API connector. Use the hosted MCP server first to validate user-based OAuth and agent-friendly tool discovery. Do not replace raw snapshot ingestion until we confirm MCP can produce stable source IDs, durable content, and traceable raw artifacts that are at least as reliable as the direct Notion API path.

Target connector contract:

```ts
export interface ConnectorDefinition<TConfig> {
  name: "notion" | "granola" | "slack";
  displayName: string;
  mode: "page" | "api" | "sync" | "thread";
  capabilities: ConnectorCapability[];
  configSchema: ConnectorConfigSchema;
  getStatus?(): Promise<ConnectorStatus> | ConnectorStatus;
  validate(config: TConfig): Promise<ConnectorStatus>;
  dryRun?(config: TConfig): Promise<ConnectorPullResult>;
  pull?(config: TConfig): Promise<ConnectorPullResult>;
}
```

The exact type names can change, but the contract should preserve these concepts:

- `configSchema`: enough metadata for CLI validation and future form generation.
- `validate`: checks credentials, permissions, scopes, and external reachability without writing snapshots.
- `dryRun`: previews what would be fetched or written.
- `pull`: writes immutable raw snapshots and returns stable traceable result records.
- `result`: includes source ID, title, raw path, written/skipped status, timestamps, and session ID where applicable.

## Security And Locality

The web control plane handles private work content and connector credentials. Treat it as a local-only privileged UI.

Requirements:

- Bind to `127.0.0.1` by default.
- Do not expose a public network listener unless the user explicitly opts in.
- Do not render secrets into client-side pages.
- Do not write connector tokens to traces, wiki pages, proposals, or logs.
- Store secrets separately from non-secret connector config.
- Prefer OS keychain or encrypted-at-rest storage later; until then, `.env` or a gitignored `.strata/secrets` path is acceptable.
- Redact bearer tokens, OAuth codes, API keys, and private URLs from errors before returning them to the browser.

## Connector UX

### Notion

Initial UI:

- Offer a Notion MCP connect button for user-based OAuth against `https://mcp.notion.com/mcp`.
- Store MCP refresh credentials server-side only under a gitignored local secret path.
- Keep `NOTION_TOKEN` as a fallback for deterministic direct-API snapshots.
- Accept a page ID or pasted Notion URL.
- Validate that the connection can read the page.
- Run a dry-run that shows the target raw snapshot path.
- Run a pull that writes `wiki/raw/notion/YYYY-MM-DD-<slug>.md` through the shared connector.
- List hosted MCP tools to confirm the OAuth connection is usable.

Later UI:

- Search accessible pages.
- Select top-level pages or databases for recurring pulls.
- Show recent edits eligible for ingestion.
- Decide whether Notion MCP should power agent-only browsing/search, ingestion snapshots, or both.

### Granola

Initial UI:

- Show whether the configured path is API-based or Mac sync-based.
- Validate required env/config values.
- Show the most recent raw transcript snapshots.
- Trigger fixture/API/sync dry-runs through the shared connector.

Later UI:

- Mac-side setup helper for launchd or synced-folder workflows.
- Backfill controls with date range selection.

### Slack

Initial UI:

- Configure workspace metadata and Slack token state.
- Show whether Strata is using user-token access or bot-token access.
- Select allowed channels, private-channel inclusion, DM inclusion, and default filter rules.
- Validate that the selected token can read configured channels.
- Pull an explicitly selected thread or fixture into `wiki/raw/slack/`.
- Run checkpointed sync dry-runs with `since`, `all-history`, and channel filters.

Later UI:

- OAuth install flow.
- Channel picker.
- Saved materiality filters.
- Backfill controls scoped by channel and time range.
- Socket Mode listener status and event-tail controls.

## Sequencing

Do not build the web app first. The implementation order should be:

1. Stabilize a shared connector result contract in `packages/ingest`. Status: connector types, registry, runner, and secret store exist.
2. Convert Notion to that contract. Status: Notion validation, dry-run, and pull use the shared connector definition; CLI and web pull paths now use the shared runner.
3. Add raw-to-wiki ingestion and proposal staging for ambiguous changes. Status: generalized automation exists in `@strata/ingest/raw-to-wiki`: `strata ingest raw index --source all|granola|notion|slack` writes curated wiki pages directly, `strata ingest granola index` remains as a compatibility shortcut, connector pulls can pass `--index`, and `strata ingest granola propose` remains available for review-first experiments. Slack raw-to-wiki now dedupes snapshots, filters low-signal material, and has been applied to the current local raw Slack corpus; future web controls should expose dry-run/apply results rather than reimplementing filter logic.
4. Convert Granola and Slack to the same connector contract. Status: Granola credential configuration/status and raw pulls are registered, including official cursor pagination and detail transcript fetches; Slack explicit-thread pulls, checkpointed sync, and basic Socket Mode tailing are registered in the CLI. Web controls for those pulls remain to be added.
5. Add proposal review/apply/reject commands.
6. Add recurring scheduler execution for stable connector and maintenance jobs.
7. Add `packages/web-api` as a thin Hono + tRPC local HTTP layer over shared packages. Status: initial Notion-focused slice present.
8. Add `apps/web` as the local browser UI. Status: initial Notion-focused slice present.

The web app becomes useful once there are multiple connector states, schedules, traces, and proposals to inspect. Before that, it risks becoming UI around unstable backend concepts.

## Acceptance Criteria

The first useful web milestone is complete when:

- The web server starts locally and binds to loopback.
- The Notion connector setup page can validate a token/page configuration.
- The Notion page can run a dry-run and display the exact raw snapshot path that would be written.
- The Notion page can trigger the same trace-backed pull as `strata ingest notion`.
- Recent ingest sessions are visible with status, source, raw path, and trace link.
- Secrets are redacted from browser responses, traces, reports, and logs.

The second useful milestone is complete when:

- Granola and Slack appear in the same connector framework.
- The UI can configure recurring pull schedules.
- The UI can show pending proposals and apply/reject/defer them through the same proposal APIs as the CLI.
