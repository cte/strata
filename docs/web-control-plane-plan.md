# Cortex Web Control Plane Plan

Status: planned, not yet implemented.

This plan covers a future local web app for configuring and operating Cortex connectors. It is subordinate to [roadmap.md](./roadmap.md), [agent-harness-plan.md](./agent-harness-plan.md), and [wiki-plan.md](./wiki-plan.md). The web app should not be started until connector contracts and at least one raw-to-wiki ingestion workflow are stable.

## Objective

Build a local browser UI that makes Cortex easier to set up and operate without turning Cortex into a cloud service.

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
  ingest/      Connector contracts and source-specific pullers
  core/        Paths, session store, runtime state, shared types
  agent/       Maintenance, reflection, proposal workflows
  web-api/     Future local HTTP API over shared packages
apps/
  web/         Future browser UI
```

The CLI, TUI, scheduler, and web app should all call the same connector APIs. Do not fork connector behavior into HTTP route handlers or React components.

Target connector contract:

```ts
export interface ConnectorDefinition<TConfig> {
  name: "notion" | "granola" | "slack";
  displayName: string;
  configSchema: JsonSchema;
  validate(config: TConfig): Promise<ConnectorStatus>;
  dryRun(config: TConfig): Promise<ConnectorPullPreview>;
  pull(config: TConfig): Promise<ConnectorPullResult>;
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
- Prefer OS keychain or encrypted-at-rest storage later; until then, `.env` or a gitignored `.cortex/secrets` path is acceptable.
- Redact bearer tokens, OAuth codes, API keys, and private URLs from errors before returning them to the browser.

## Connector UX

### Notion

Initial UI:

- Explain how to create a Notion internal connection.
- Accept `NOTION_TOKEN` through the chosen secret storage path.
- Accept a page ID or pasted Notion URL.
- Validate that the connection can read the page.
- Run a dry-run that shows the target raw snapshot path.
- Run a pull that writes `wiki/raw/notion/YYYY-MM-DD-<slug>.md` through the shared connector.

Later UI:

- Search accessible pages.
- Select top-level pages or databases for recurring pulls.
- Show recent edits eligible for ingestion.

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

- Configure workspace metadata and bot token/OAuth state.
- Select allowed channels and default filter rules.
- Validate that the bot can read configured channels.
- Pull an explicitly selected thread or fixture into `wiki/raw/slack/`.

Later UI:

- OAuth install flow.
- Channel picker.
- Saved materiality filters.
- Backfill controls scoped by channel and time range.

## Sequencing

Do not build the web app first. The implementation order should be:

1. Stabilize a shared connector result contract in `packages/ingest`.
2. Convert Notion to that contract.
3. Add Notion raw-to-wiki ingestion and proposal staging for ambiguous changes.
4. Convert Granola and Slack to the same connector contract.
5. Add proposal review/apply/reject commands.
6. Add recurring scheduler execution for stable connector and maintenance jobs.
7. Add `packages/web-api` as a thin local HTTP layer over shared packages.
8. Add `apps/web` as the local browser UI.

The web app becomes useful once there are multiple connector states, schedules, traces, and proposals to inspect. Before that, it risks becoming UI around unstable backend concepts.

## Acceptance Criteria

The first useful web milestone is complete when:

- The web server starts locally and binds to loopback.
- The Notion connector setup page can validate a token/page configuration.
- The Notion page can run a dry-run and display the exact raw snapshot path that would be written.
- The Notion page can trigger the same trace-backed pull as `cortex ingest notion`.
- Recent ingest sessions are visible with status, source, raw path, and trace link.
- Secrets are redacted from browser responses, traces, reports, and logs.

The second useful milestone is complete when:

- Granola and Slack appear in the same connector framework.
- The UI can configure recurring pull schedules.
- The UI can show pending proposals and apply/reject/defer them through the same proposal APIs as the CLI.

