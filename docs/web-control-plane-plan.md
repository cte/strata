# Strata Web Control Plane Plan

Status: skeleton plus activity, wiki action management, retrieval-index management, automation-first schedules, scheduled agent prompts, connector schedule controls, one-off connector operations, saved connector defaults, ingest taxonomy controls, and proposal review with guarded exact consolidation apply present.

This plan covers a local web app for configuring and operating Strata connectors and local automations. It is subordinate to [roadmap.md](./roadmap.md), [routines-plan.md](./routines-plan.md), [agent-harness-plan.md](./agent-harness-plan.md), [wiki-plan.md](./wiki-plan.md), and [ingest-activity-log-plan.md](./ingest-activity-log-plan.md).

The first skeleton exists under `apps/web` with a thin Hono + tRPC local API in `packages/web-api`. The current UI is intentionally narrow: connector list, Notion page snapshot controls, Granola API key configuration plus bounded one-off backfill controls, Slack token status plus checkpointed one-off sync controls, saved non-secret defaults for Notion/Granola/Slack one-offs, an experimental Notion MCP OAuth/tool-discovery path, an automation-first schedules page over `@strata/jobs` that leads with source sync, wiki upkeep presets, and scheduled agent prompt sessions, a System retrieval-index page for table counts and on-demand rebuilds, an ingest activity page, a wiki action manager backed by `wiki/actions/mine.md` and `wiki/actions/theirs.md`, an ingest taxonomy page for workspace-local classification vocabulary, a proposal review page with taxonomy schema apply plus consolidation validation, canonical/mechanical diff previews, and guarded exact consolidation accept support, and connector-specific Granola/Slack schedule panels. Granola and Slack can be scheduled as interval `connector.pull` jobs with raw-to-wiki indexing and search-index refresh presets, while `agent.prompt` schedules start normal agent sessions from arbitrary prompts through the shared agent loop. Browser one-offs, CLI ingests, and scheduled pulls now share the same connector workflow for dry-run/pull, optional config-profile resolution, optional raw-to-wiki indexing, and optional search-index refresh. Persisted config profiles exist, and connector schedule presets bind to the current default profile when one exists so recurring pulls can follow updated saved scopes while retaining schedule-specific safety overrides.

## Objective

Build a local browser UI that makes Strata easier to set up and operate without turning Strata into a cloud service.

The web control plane should help the user:

- Configure Notion, Granola, Slack, and future connectors.
- Validate connector credentials and permissions.
- Select source scopes such as Notion pages, Slack channels, and Granola sync locations.
- Run dry-runs and one-off pulls.
- Save and reload non-secret connector defaults without storing credentials in config profiles.
- Inspect recent ingest sessions, failures, reports, raw snapshot paths, and trace-backed source-to-wiki organization details.
- Review and manage wiki-backed action items discovered by ingestion or added manually.
- Inspect and evolve the local ingest taxonomy without putting workspace vocabulary in product code.
- Configure recurring connector pulls, maintenance jobs, and scheduled agent prompt sessions.
- Configure and inspect Routines: structured agent automations with schemas, skills, pre-run Jobs, triggers, run history, and artifacts.
- Review and apply or reject proposals created by ingest, reflection, and maintenance.

The web app is an operations surface. It is not the agent runtime, not the connector implementation, and not the wiki.

## Product Shape

The initial web app should be a local control plane with these sections:

- `Overview`: connector health, last pulls, pending proposals, recent failures, next scheduled jobs.
- `Connectors`: setup and status pages for Notion, Granola, and Slack.
- `Ingest`: dry-run and pull controls, recent raw snapshots, raw-to-wiki ingest status, and the activity feed defined in [ingest-activity-log-plan.md](./ingest-activity-log-plan.md).
- `Actions`: open/done filters over `wiki/actions/mine.md` and `wiki/actions/theirs.md`, manual additions, completion toggles, and context notes that write back to the Markdown ledgers.
- `Schedules`: local recurring automations for source syncs, search refresh, wiki hygiene, and scheduled agent prompt sessions.
- `System / Index`: local retrieval-index status, source/kind distribution, related schedules, and manual trace-backed rebuilds.
- `Routines`: reusable structured agent workflows, including run-now, schedule trigger, run history, artifact inspection, and trace links.
- `Proposals`: staged wiki/schema/skill/memory changes with diff, apply, reject, and defer actions.
- `Sessions`: searchable ingest, maintenance, reflection, and agent traces.
- `Settings`: model provider summary, local paths, and non-secret connector metadata.

The UI should optimize for clarity and auditability over breadth. Every operation that mutates wiki content or learning artifacts should link to the session trace or proposal that explains it. Ingest history should be built from structured session events, not by parsing `wiki/log.md`; `wiki/log.md` remains the compact human chronology.

## Architecture

Connector logic belongs in shared packages:

```text
packages/
  ingest/      Connector contracts, registry, runner, secret store, and source-specific pullers
  jobs/        Job registry, trace-backed runner, durable schedules, and scheduler loop
  core/        Paths, session store, runtime state, shared types
  agent/       Maintenance, reflection, proposal workflows
  web-api/     Hono + tRPC local HTTP API over shared packages
apps/
  web/         Browser UI
```

The CLI, TUI, scheduler, and web app should all call the same connector APIs. Do not fork connector behavior into HTTP route handlers or React components.

Recurring work should go through `@strata/jobs`: `JobRegistry` declares typed jobs, `runJob()` creates trace-backed `job` sessions, `ScheduleStore` persists interval/cron records in SQLite, and the scheduler worker claims due schedules before running them. Connector-specific pollers should be expressed as scheduled `connector.pull` jobs unless the source exposes a true event listener such as Slack Socket Mode. Higher-level reusable prompt workflows should move from ad hoc scheduled `agent.prompt` inputs toward Routines executed by the registered `routine.run` job, with schedules remaining the trigger mechanism.

The current connector runtime foundation lives under `packages/ingest/src/connectors/`:

- `types.ts`: connector definitions, capabilities, statuses, normalized source document/checkpoint/failure types, and redaction helpers.
- `registry.ts`: source connector registry for Notion, Granola, and Slack.
- `runner.ts`: trace-backed dry-run/pull execution that owns ingest sessions and redacts secret config before writing events.
- `workflow.ts`: shared dry-run/pull workflow that layers optional config-profile resolution, raw-to-wiki indexing, and search-index refresh over the connector runner for CLI, jobs, and web one-offs.
- `store.ts`: local gitignored connector secret records under `.strata/secrets/<connector>.json`.
- `checkpointStore.ts`: local connector checkpoints under `.strata/connectors/<connector>/checkpoint.json`.
- `configStore.ts`: local non-secret connector config profiles under `.strata/connectors/<connector>/config.json`; schema secret fields and secret-looking keys are rejected so credentials stay in the secret store.

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
- Optionally index the written raw page and refresh local retrieval through the shared connector workflow.
- List hosted MCP tools to confirm the OAuth connection is usable.
- Save/reload the page snapshot default without storing tokens.

Later UI:

- Search accessible pages.
- Select top-level pages or databases for recurring pulls.
- Show recent edits eligible for ingestion.
- Decide whether Notion MCP should power agent-only browsing/search, ingestion snapshots, or both.

### Granola

Initial UI:

- Show API credential state and validate/save/disconnect the local API key.
- Configure a bounded one-off backfill with `since`, page size, and max pages.
- Run dry-run/pull through the shared connector workflow, optionally creating wiki pages and refreshing retrieval.
- Configure recurring near-real-time/backstop schedules through `connector.pull` presets.
- Save/reload non-secret backfill defaults.

Later UI:

- Mac-side setup helper for launchd or synced-folder workflows.
- Richer date-range ergonomics and explicit schedule profile picker/override controls.

### Slack

Initial UI:

- Configure workspace metadata and Slack token state.
- Show whether Strata is using user-token access or bot-token access.
- Select allowed channels, private-channel inclusion, DM inclusion, and default filter rules.
- Validate that the selected token can read configured channels.
- Pull an explicitly selected thread or fixture into `wiki/raw/slack/`.
- Run checkpointed sync dry-runs with `since`, `all-history`, and channel filters.
- Run checkpointed one-off sync/backfill from the web with channel filters, privacy/DM/bot-message toggles, safety caps, optional raw-to-wiki indexing, and optional search-index refresh.
- Configure recurring staged/low-impact sync schedules through `connector.pull` presets.
- Save/reload non-secret sync defaults such as channels, channel regex, privacy toggles, and safety caps.

Later UI:

- OAuth install flow.
- Channel picker.
- Saved materiality filters.
- Backfill controls scoped by channel and time range.
- Explicit schedule profile picker/override controls so recurring pulls can switch saved scopes without recreating schedules.
- Socket Mode listener status and event-tail controls.

## Sequencing

Do not build the web app first. The implementation order should be:

1. Stabilize a shared connector result contract in `packages/ingest`. Status: connector types, registry, runner, and secret store exist.
2. Convert Notion to that contract. Status: Notion validation, dry-run, and pull use the shared connector definition; CLI and web pull paths now use the shared runner.
3. Add raw-to-wiki ingestion and proposal staging for ambiguous changes. Status: generalized automation exists in `@strata/ingest/raw-to-wiki`: `strata ingest raw index --source all|granola|notion|slack` writes curated wiki pages directly, `strata ingest granola index` remains as a compatibility shortcut, connector pulls can pass `--index`, and `strata ingest granola propose` remains available for review-first experiments. Slack raw-to-wiki now dedupes snapshots, filters low-signal material, records classification reasons, and has been applied to the current local raw Slack corpus. Workspace vocabulary lives in `@strata/ingest/ingest-taxonomy`; web controls should expose dry-run/apply/taxonomy results rather than reimplementing filter logic.
4. Convert Granola and Slack to the same connector contract. Status: Granola credential configuration/status and raw pulls are registered, including official cursor pagination and detail transcript fetches; Slack explicit-thread pulls, checkpointed sync, and basic Socket Mode tailing are registered in the CLI; and web one-off controls now call the shared connector workflow for Notion, Granola, and Slack.
5. Add a trace-backed ingest activity log over connector and raw-to-wiki session events. Status: browser/read-only slice present in [ingest-activity-log-plan.md](./ingest-activity-log-plan.md): `@strata/ingest/activity`, `activity.list/get`, and `/activity` show recent source pulls and raw-to-wiki organization without parsing `wiki/log.md`, with run-list filters backed by the local `ingest_activity_runs` projection.
6. Add proposal review/apply/reject commands. Status: `packages/core/src/proposalStore.ts` has list/read/status/apply helpers, `strata proposals list/show/apply/reject/defer` exposes them through the CLI, `proposals.*` tRPC procedures expose them to the web API, and the `/review` inbox provides list/detail/accept/defer/reject controls (alongside the classification review queue; see [ADR-0003](./adr/0003-unified-review-inbox.md)). Apply is intentionally narrow and currently supports explicit wiki-page creation payloads, exact old-text wiki patch payloads, `ingest.taxonomy.*` schema operations, and exact `wiki.consolidateEntity` operation plans whose reviewed preview fingerprint still matches at apply time. Consolidation proposals can show validated operation-plan previews, exact canonical merge patch diffs, superseded redirect diffs, and backlink rewrite diffs; manual-review or unsafe plans remain unavailable for accept.
7. Add recurring scheduler execution for stable connector, maintenance, and prompt-driven agent jobs. Status: initial `@strata/jobs` implementation exists with CLI, PM2 worker, tRPC, automation-first `/schedules` web controls, scheduled agent prompt controls, and connector-specific Granola/Slack schedule status/presets. `connector.pull` can resolve saved config profiles at run time through `configProfileId`, `agent.prompt` starts shared-loop agent sessions from scheduled prompts, and connector-specific presets bind the current default profile when applied.
8. Add `packages/web-api` as a thin Hono + tRPC local HTTP layer over shared packages. Status: connector list, generic connector runs, Notion compatibility operations, activity, ingest taxonomy, proposal, schedule, model-auth, MCP, and wiki procedures are present.
9. Add `apps/web` as the local browser UI. Status: connector setup/status pages, Notion/Granola/Slack one-off operation panels, Granola/Slack schedule panels, automation-first schedules with scheduled agent prompts, System retrieval-index management, activity, wiki action management, ingest taxonomy, proposals, wiki browsing, MCP settings, and web chat are present.
10. Persist non-secret connector scopes/config in shared code. Status: `packages/ingest/src/connectors/configStore.ts` stores local config profiles, `strata connectors config` exposes the CLI path, `connectors.config.*` exposes tRPC procedures, Notion/Granola/Slack one-off panels have saved-default controls, and connector schedules can reference saved profiles by id through the shared workflow while retaining schedule-specific safety overrides.

The web app becomes useful once there are multiple connector states, schedules, traces, and proposals to inspect. Before that, it risks becoming UI around unstable backend concepts.

## Acceptance Criteria

The first useful web milestone is complete when:

- The web server starts locally and binds to loopback.
- The Notion connector setup page can validate a token/page configuration.
- The Notion page can run a dry-run and display the exact raw snapshot path that would be written.
- The Notion page can trigger the same trace-backed pull as `strata ingest notion`.
- Recent ingest sessions are visible with status, source, raw path, trace link, and source-to-wiki organization details when raw-to-wiki indexing ran.
- Secrets are redacted from browser responses, traces, reports, and logs.

The second useful milestone is complete enough to operate locally: Granola/Slack are in the shared connector framework, recurring schedule controls exist, and proposal review is available. Further work should deepen controls rather than fork backend behavior.

- Granola and Slack appear in the same connector framework.
- Notion, Granola, and Slack can run one-off dry-run/pull operations from the browser through the same workflow used by CLI and schedules.
- The UI can configure recurring pull schedules through source sync cards, wiki upkeep presets, and scheduled agent prompt sessions through a purpose-built scheduler.
- The UI can inspect/stage/update local ingest taxonomy entries through shared ingest APIs.
- The UI can list, add, complete, reopen, and annotate wiki action items while keeping `wiki/actions/mine.md` and `wiki/actions/theirs.md` as the source of truth.
- The UI can show pending proposals and apply/reject/defer them through the same proposal APIs as the CLI, including supported create/patch wiki proposal shapes, ingest taxonomy schema operations, and guarded exact consolidation apply previews.
- The UI and CLI can save/load non-secret connector defaults without exposing or persisting secrets outside `.strata/secrets`.
- Scheduled connector pulls can reference a saved non-secret profile by id and resolve it at run time, with the schedule UI showing the tracked or missing profile state.
