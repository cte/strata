# Slack Connector

Status: initial implementation present.

The Slack connector is designed to become a continuous source for Strata: initial backfill, checkpointed polling/reconciliation, and Socket Mode event tailing.

## Current Shape

- `strata ingest slack thread` snapshots one explicit Slack thread.
- `strata ingest slack sync` discovers conversations, pulls history with `conversations.history`, expands threads with `conversations.replies`, writes immutable Markdown snapshots under `wiki/raw/slack/`, and stores progress in `.strata/connectors/slack/checkpoint.json`.
- `strata ingest slack listen` opens Slack Socket Mode, acknowledges event envelopes, and materializes the affected thread when message events arrive.

The implementation lives entirely in Strata. Onyx is only a reference for Slack API mechanics; gBrain is only a reference for deterministic collector and recurring-job architecture.

## Token Model

Use environment variables for now. Runtime scripts wrap dotenvx automatically, so encrypted
values in the ignored root `.env` work with `bun run strata ...` and `bun run web:api`.

- `SLACK_USER_TOKEN`: recommended for mirroring the installing user's accessible Slack content.
- `SLACK_BOT_TOKEN`: usable for bot-accessible channels and thread snapshots.
- `SLACK_APP_TOKEN`: required for Socket Mode event tailing.
- `SLACK_WORKSPACE_URL`: optional, used to render source links if Slack `auth.test` does not return a workspace URL.

For the target "all Slack information I have access to" use case, the user token matters. A bot token only sees conversations the bot is a member of.

## Slack App Setup

Create a Slack app with Socket Mode enabled.

Recommended OAuth scopes:

- User or bot history scopes: `channels:history`, `groups:history`, `im:history`, `mpim:history`.
- Conversation discovery scopes: `channels:read`, `groups:read`, `im:read`, `mpim:read`.
- User metadata scopes for the next enrichment pass: `users:read`, `users.profile:read`, optionally `users:read.email`.
- App-level token scope for Socket Mode: `connections:write`.

Recommended event subscriptions:

- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

## Commands

First sync requires an explicit bound or an explicit all-history crawl:

```bash
bun run strata ingest slack sync --since 2026-05-01 --channels engineering
bun run strata ingest slack sync --all-history --include-private --include-dms
```

Polling/reconciliation uses the checkpoint plus a recent lookback window:

```bash
bun run strata ingest slack sync --lookback-minutes 360
```

Socket Mode tailing:

```bash
bun run strata ingest slack listen
```

During local development, `bun dev` starts the Slack listener together with the web API and
web UI through PM2. Use `bun run dev:logs` to inspect listener output and `bun run dev:stop`
to stop all Strata PM2 services.

The PM2 Slack listener enables `SLACK_SOCKET_DEBUG=1`, so its logs show Socket Mode envelope
summaries such as `hello`, `events_api`, and ignored event reasons without printing message text.

## Follow-Up Work

- Add web control-plane token setup and channel picker controls.
- Add scheduled polling jobs once the scheduler/proposal milestone is ready.
- Add user/profile resolution so raw snapshots show names in addition to Slack IDs.
- Add explicit edit/delete tombstone handling from message subtypes.
- Route raw Slack snapshots into the wiki proposal pipeline instead of only storing raw source material.
