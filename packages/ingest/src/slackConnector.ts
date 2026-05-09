import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  asObject,
  asObjects,
  firstString,
  frontmatter,
  type JsonObject,
  type JsonValue,
  slugify,
  utcNow,
  writeOnce,
} from "./common.js";
import { readConnectorCheckpoint, writeConnectorCheckpoint } from "./connectors/checkpointStore.js";
import type {
  ConnectorConfig,
  ConnectorDefinition,
  ConnectorFailure,
  ConnectorPullItem,
  ConnectorPullResult,
  ConnectorRuntime,
  SourceDocument,
} from "./connectors/types.js";
import { SlackApiClient, type SlackConversation, type SlackMessage } from "./slackClient.js";

type SlackConnectorMode = "sync" | "thread";

export interface SlackConnectorConfig extends ConnectorConfig {
  allHistory?: boolean | string;
  appToken?: string;
  botToken?: string;
  channel?: string;
  channelRegex?: string;
  channels?: string;
  fromJson?: string;
  includeBotMessages?: boolean | string;
  includeDms?: boolean | string;
  includePrivateChannels?: boolean | string;
  lookbackMinutes?: number | string;
  maxChannels?: number | string;
  maxMessagesPerChannel?: number | string;
  maxThreads?: number | string;
  mode?: SlackConnectorMode;
  since?: string;
  threadTs?: string;
  title?: string;
  userToken?: string;
  workspaceUrl?: string;
}

interface SlackChannelCheckpoint {
  latestTs?: string;
  name?: string;
  syncedAt?: string;
}

interface SlackSyncCheckpoint {
  version: 1;
  channels: Record<string, SlackChannelCheckpoint>;
}

interface SlackThreadSnapshot {
  channel: string;
  channelName?: string;
  date: string;
  document: SourceDocument;
  item: ConnectorPullItem;
  latestTs: string;
  messageCount: number;
  rawPath: string;
  sourceId: string;
  sourceUrl: string | null;
  threadTs: string;
  title: string;
  written: boolean;
  skipped: boolean;
}

const DISALLOWED_MESSAGE_SUBTYPES = new Set([
  "channel_archive",
  "channel_join",
  "channel_leave",
  "channel_name",
  "channel_posting_permissions",
  "channel_unarchive",
  "ekm_access_denied",
  "group_archive",
  "group_join",
  "group_leave",
  "group_unarchive",
  "pinned_item",
  "unpinned_item",
]);

export const slackConnector = {
  name: "slack",
  displayName: "Slack",
  description:
    "Continuously capture accessible Slack conversations into wiki/raw/slack with checkpoints.",
  mode: "sync",
  capabilities: ["validate", "dry_run", "pull", "discover", "poll", "checkpoint"],
  configSchema: {
    fields: {
      mode: {
        type: "string",
        label: "Mode",
        description:
          "Use `thread` for one explicit thread or `sync` for checkpointed channel sync.",
        placeholder: "sync",
      },
      botToken: {
        type: "string",
        label: "Bot token",
        description: "Slack bot token. Captures conversations the bot can access.",
        secret: true,
        env: "SLACK_BOT_TOKEN",
      },
      userToken: {
        type: "string",
        label: "User token",
        description:
          "Slack user OAuth token. Preferred for mirroring conversations the installing user can access.",
        secret: true,
        env: "SLACK_USER_TOKEN",
      },
      appToken: {
        type: "string",
        label: "App token",
        description: "Slack app-level token for Socket Mode event tailing.",
        secret: true,
        env: "SLACK_APP_TOKEN",
      },
      channel: {
        type: "string",
        label: "Channel ID",
        description: "Channel ID for explicit thread pulls.",
        placeholder: "C0123456789",
      },
      threadTs: {
        type: "string",
        label: "Thread timestamp",
        description: "Slack thread timestamp for explicit thread pulls.",
        placeholder: "1715102030.123456",
      },
      channels: {
        type: "string",
        label: "Channels",
        description: "Comma-separated channel names or IDs to sync.",
        placeholder: "general,engineering,C0123456789",
      },
      channelRegex: {
        type: "string",
        label: "Channel regex",
        description: "Optional full-match regular expression for channel names.",
      },
      since: {
        type: "string",
        label: "Since",
        description: "ISO date/time to use for the first sync.",
        placeholder: "2026-05-01",
      },
      allHistory: {
        type: "boolean",
        label: "All history",
        description: "Allow first sync without a `since` bound.",
      },
      includePrivateChannels: {
        type: "boolean",
        label: "Include private channels",
        description: "Include private channels visible to the selected Slack token.",
      },
      includeDms: {
        type: "boolean",
        label: "Include DMs",
        description: "Include DMs and group DMs visible to the selected Slack token.",
      },
      includeBotMessages: {
        type: "boolean",
        label: "Include bot messages",
        description: "Keep bot/app messages instead of filtering them out.",
      },
      lookbackMinutes: {
        type: "number",
        label: "Lookback minutes",
        description: "Re-scan a recent window on incremental sync to catch late thread updates.",
      },
      maxChannels: {
        type: "number",
        label: "Max channels",
        description: "Optional cap for testing or staged rollout.",
      },
      maxMessagesPerChannel: {
        type: "number",
        label: "Max messages per channel",
        description: "Optional cap for testing or staged rollout.",
      },
      maxThreads: {
        type: "number",
        label: "Max threads",
        description: "Optional total cap for testing or staged rollout.",
      },
      title: {
        type: "string",
        label: "Title",
        description: "Optional title override for explicit thread snapshots.",
      },
      workspaceUrl: {
        type: "string",
        label: "Workspace URL",
        description: "Used to render source links for captured threads.",
        env: "SLACK_WORKSPACE_URL",
        placeholder: "https://your-workspace.slack.com",
      },
      fromJson: {
        type: "string",
        label: "Fixture file",
        description: "Local Slack thread JSON fixture for offline pulls.",
      },
    },
  },
  getStatus(runtime) {
    const tokens = slackTokens({}, runtime);
    if (tokens.historyToken === "") {
      return {
        name: "slack",
        state: "not_configured",
        configured: false,
        message:
          "Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN to enable Slack sync. Use SLACK_APP_TOKEN later for Socket Mode.",
      };
    }
    return {
      name: "slack",
      state: "ready",
      configured: true,
      message: tokens.userToken
        ? "Slack user token configured. Strata can sync conversations visible to that user."
        : "Slack bot token configured. Strata can sync conversations the bot can access.",
      details: {
        hasAppToken: tokens.appToken !== "",
        tokenMode: tokens.userToken ? "user" : "bot",
      },
    };
  },
  async validate(config, runtime) {
    if (config.fromJson?.trim()) {
      return {
        name: "slack",
        state: "ready",
        configured: true,
        message: "Slack fixture is configured.",
      };
    }

    const mode = slackMode(config);
    const tokens = slackTokens(config, runtime);
    if (tokens.historyToken === "") {
      return {
        name: "slack",
        state: "not_configured",
        configured: false,
        message: "Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN in .env, or pass a token override.",
      };
    }
    if (mode === "thread" && (!config.channel?.trim() || !config.threadTs?.trim())) {
      return {
        name: "slack",
        state: "invalid",
        configured: true,
        message: "Explicit Slack thread pulls require both channel and thread timestamp.",
      };
    }

    const client = new SlackApiClient({
      token: tokens.historyToken,
      fetchImpl: runtime.fetchImpl ?? globalThis.fetch,
    });
    const auth = await client.authTest();
    return {
      name: "slack",
      state: "ready",
      configured: true,
      message: `Slack token is valid${auth.team ? ` for ${auth.team}` : ""}.`,
      details: {
        teamId: auth.team_id ?? null,
        tokenMode: tokens.userToken ? "user" : "bot",
      },
    };
  },
  async dryRun(config, runtime) {
    return runSlack(config, runtime, true);
  },
  async pull(config, runtime) {
    return runSlack(config, runtime, false);
  },
} satisfies ConnectorDefinition<SlackConnectorConfig> &
  Required<Pick<ConnectorDefinition<SlackConnectorConfig>, "dryRun" | "pull">>;

export function slackTokens(
  config: Pick<SlackConnectorConfig, "appToken" | "botToken" | "userToken">,
  runtime: ConnectorRuntime,
): { appToken: string; botToken: string; historyToken: string; userToken: string } {
  const appToken = config.appToken?.trim() || runtime.env.SLACK_APP_TOKEN?.trim() || "";
  const botToken = config.botToken?.trim() || runtime.env.SLACK_BOT_TOKEN?.trim() || "";
  const userToken = config.userToken?.trim() || runtime.env.SLACK_USER_TOKEN?.trim() || "";
  return {
    appToken,
    botToken,
    historyToken: userToken || botToken,
    userToken,
  };
}

async function runSlack(
  config: SlackConnectorConfig,
  runtime: ConnectorRuntime,
  dryRun: boolean,
): Promise<ConnectorPullResult> {
  const mode = slackMode(config);
  if (mode === "thread") {
    return runSlackThread(config, runtime, dryRun);
  }
  return runSlackSync(config, runtime, dryRun);
}

function slackMode(config: SlackConnectorConfig): SlackConnectorMode {
  if (config.mode === "thread" || config.fromJson?.trim() || config.threadTs?.trim()) {
    return "thread";
  }
  return "sync";
}

async function runSlackThread(
  config: SlackConnectorConfig,
  runtime: ConnectorRuntime,
  dryRun: boolean,
): Promise<ConnectorPullResult> {
  const { messages, meta } = await loadThreadMessages(config, runtime);
  if (messages.length === 0) {
    throw new Error("No Slack messages found.");
  }

  const first = requireMessage(messages[0]);
  const channel = config.channel ?? meta.channel ?? meta.channel_id ?? "slack";
  const threadTs = config.threadTs ?? meta.thread_ts ?? String(first.thread_ts ?? first.ts);
  const workspaceUrl = resolveWorkspaceUrl(config, runtime, meta.workspace_url);
  const snapshot = await writeThreadSnapshot({
    channel,
    config,
    dryRun,
    messages,
    runtime,
    threadTs,
    workspaceUrl,
    ...(meta.channel_name === undefined ? {} : { channelName: meta.channel_name }),
  });

  return {
    connector: "slack",
    sourceId: `${channel}:${threadTs}`,
    title: snapshot.title,
    rawPath: snapshot.rawPath,
    sourceUrl: snapshot.sourceUrl,
    written: snapshot.written,
    skipped: snapshot.skipped,
    dryRun,
    metadata: {
      channel,
      date: snapshot.date,
      latestTs: snapshot.latestTs,
      messageCount: snapshot.messageCount,
      mode: "thread",
      threadTs,
    },
    items: [snapshot.item],
    documents: [snapshot.document],
  };
}

async function runSlackSync(
  config: SlackConnectorConfig,
  runtime: ConnectorRuntime,
  dryRun: boolean,
): Promise<ConnectorPullResult> {
  const tokens = slackTokens(config, runtime);
  if (tokens.historyToken === "") {
    throw new Error("Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN in .env before Slack sync.");
  }

  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
  const client = new SlackApiClient({ token: tokens.historyToken, fetchImpl });
  const auth = await client.authTest();
  const workspaceUrl = resolveWorkspaceUrl(config, runtime, auth.url);
  const checkpoint = await readSlackCheckpoint(runtime.repoRoot);
  const nextCheckpoint: SlackSyncCheckpoint = {
    version: 1,
    channels: { ...checkpoint.channels },
  };
  const channels = limitItems(
    filterConversations(await discoverConversations(client, config), config),
    parseOptionalInteger(config.maxChannels, "maxChannels"),
  );

  if (channels.length === 0) {
    throw new Error("No Slack conversations matched the configured filters.");
  }

  const items: ConnectorPullItem[] = [];
  const documents: SourceDocument[] = [];
  const failures: ConnectorFailure[] = [];
  let processedChannels = 0;
  let processedMessages = 0;
  let processedThreads = 0;
  const maxThreads = parseOptionalInteger(config.maxThreads, "maxThreads");
  const maxMessagesPerChannel = parseOptionalInteger(
    config.maxMessagesPerChannel,
    "maxMessagesPerChannel",
  );

  for (const channel of channels) {
    if (maxThreads !== undefined && processedThreads >= maxThreads) {
      break;
    }
    const channelCheckpoint = checkpoint.channels[channel.id] ?? {};
    const oldest = resolveOldestTs(config, channelCheckpoint);
    const channelMessages = limitItems(
      await client.conversationsHistory({
        channel: channel.id,
        inclusive: false,
        ...(oldest === undefined ? {} : { oldest }),
      }),
      maxMessagesPerChannel,
    );
    processedChannels += 1;
    processedMessages += channelMessages.length;

    let channelLatestTs = channelCheckpoint.latestTs ?? "0";
    const seenThreadTs = new Set<string>();
    for (const message of channelMessages) {
      channelLatestTs = maxSlackTs(channelLatestTs, message.ts);
      if (shouldFilterMessage(message, config)) {
        continue;
      }

      const threadTs = String(message.thread_ts ?? message.ts);
      if (seenThreadTs.has(threadTs)) {
        continue;
      }
      seenThreadTs.add(threadTs);

      const messages = shouldFetchThread(message)
        ? await client.conversationsReplies({ channel: channel.id, ts: threadTs })
        : [message];
      const filteredMessages = messages.filter((item) => !shouldFilterMessage(item, config));
      if (filteredMessages.length === 0) {
        continue;
      }
      for (const item of filteredMessages) {
        channelLatestTs = maxSlackTs(channelLatestTs, item.ts);
      }

      const snapshot = await writeThreadSnapshot({
        channel: channel.id,
        channelName: conversationName(channel),
        config,
        dryRun,
        messages: filteredMessages,
        runtime,
        threadTs,
        workspaceUrl,
      });
      items.push(snapshot.item);
      documents.push(snapshot.document);
      processedThreads += 1;
      if (maxThreads !== undefined && processedThreads >= maxThreads) {
        break;
      }
    }

    nextCheckpoint.channels[channel.id] = {
      latestTs: channelLatestTs,
      name: conversationName(channel),
      syncedAt: (runtime.now ?? utcNow()).toISOString(),
    };
  }

  if (!dryRun) {
    await writeSlackCheckpoint(nextCheckpoint, runtime);
  }

  const title = `Slack sync ${channels.length} conversation${channels.length === 1 ? "" : "s"}`;
  const checkpointPayload = {
    connector: "slack" as const,
    updatedAt: (runtime.now ?? utcNow()).toISOString(),
    data: checkpointToJson(nextCheckpoint),
  };

  return {
    connector: "slack",
    sourceId: "slack:sync",
    title,
    rawPath: items[0]?.rawPath ?? "wiki/raw/slack",
    sourceUrl: workspaceUrl || null,
    written: items.some((item) => item.written),
    skipped: items.length > 0 && items.every((item) => item.skipped),
    dryRun,
    metadata: {
      channelCount: channels.length,
      dryRun,
      hasAppToken: tokens.appToken !== "",
      mode: "sync",
      processedChannels,
      processedMessages,
      processedThreads,
      tokenMode: tokens.userToken ? "user" : "bot",
      workspaceUrl: workspaceUrl || null,
    },
    items,
    documents,
    failures,
    checkpoint: checkpointPayload,
  };
}

async function loadThreadMessages(
  config: SlackConnectorConfig,
  runtime: ConnectorRuntime,
): Promise<{ messages: SlackMessage[]; meta: Record<string, string> }> {
  if (config.fromJson?.trim()) {
    const payload = JSON.parse(await readFile(config.fromJson.trim(), "utf8")) as unknown;
    if (Array.isArray(payload)) {
      return { messages: asObjects(payload).flatMap(toSlackMessage), meta: {} };
    }
    const object = asObject(payload);
    if (!object) {
      return { messages: [], meta: {} };
    }
    const messages = asObjects(object.messages ?? object.replies).flatMap(toSlackMessage);
    const meta: Record<string, string> = {};
    for (const [key, value] of Object.entries(object)) {
      if (key !== "messages" && key !== "replies" && typeof value !== "object") {
        meta[key] = String(value);
      }
    }
    return { messages, meta };
  }

  const tokens = slackTokens(config, runtime);
  if (tokens.historyToken === "") {
    throw new Error("Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN in .env or use --from-json.");
  }
  if (!config.channel?.trim() || !config.threadTs?.trim()) {
    throw new Error("Direct Slack fetch requires channel and thread timestamp.");
  }
  const client = new SlackApiClient({
    token: tokens.historyToken,
    fetchImpl: runtime.fetchImpl ?? globalThis.fetch,
  });
  const messages = await client.conversationsReplies({
    channel: config.channel,
    ts: config.threadTs,
  });
  return { messages, meta: { channel: config.channel, thread_ts: config.threadTs } };
}

async function writeThreadSnapshot(input: {
  channel: string;
  channelName?: string;
  config: SlackConnectorConfig;
  dryRun: boolean;
  messages: SlackMessage[];
  runtime: ConnectorRuntime;
  threadTs: string;
  workspaceUrl: string;
}): Promise<SlackThreadSnapshot> {
  const first = requireMessage(input.messages[0]);
  const sorted = [...input.messages].sort(
    (a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts),
  );
  const latestTs = sorted.reduce((latest, message) => maxSlackTs(latest, message.ts), "0");
  const date = messageDate(first.ts);
  const title = input.config.title ?? inferThreadTitle(first);
  const sourceUrl =
    input.workspaceUrl && input.channel && input.threadTs
      ? `${input.workspaceUrl}/archives/${input.channel}/p${input.threadTs.replace(".", "")}`
      : null;
  const sourceId = `${input.channel}:${input.threadTs}:${latestTs}`;
  const filePath = path.join(
    input.runtime.repoRoot,
    "wiki",
    "raw",
    "slack",
    `${date}-${slugify(input.channel)}-${slackTsSlug(input.threadTs)}-${slackTsSlug(
      latestTs,
    )}-${slugify(title, "thread")}.md`,
  );
  const rawPath = path.relative(input.runtime.repoRoot, filePath);
  const content =
    frontmatter({
      type: "raw_slack_thread",
      source: "slack",
      date,
      channel: input.channel,
      channel_name: input.channelName ?? null,
      thread_ts: input.threadTs,
      latest_ts: latestTs,
      title,
      source_url: sourceUrl,
      message_count: sorted.length,
      pulled_at: (input.runtime.now ?? utcNow()).toISOString(),
    }) + `\n# ${title}\n\n${renderMessages(sorted)}`;

  const written = input.dryRun ? false : await writeOnce(filePath, content);
  const skipped = input.dryRun ? false : !written;
  const metadata = {
    channel: input.channel,
    channelName: input.channelName ?? null,
    date,
    latestTs,
    messageCount: sorted.length,
    threadTs: input.threadTs,
  };
  const item: ConnectorPullItem = {
    sourceId,
    title,
    rawPath,
    sourceUrl,
    written,
    skipped,
    metadata,
  };
  const document: SourceDocument = {
    connector: "slack",
    sourceId,
    title,
    sourceUrl,
    sections: sorted.map((message) => {
      const link =
        input.workspaceUrl && input.channel && message.ts
          ? `${input.workspaceUrl}/archives/${input.channel}/p${message.ts.replace(".", "")}`
          : undefined;
      return {
        title: `${message.ts} | ${renderUser(message)}`,
        text: String(message.text ?? "").trim() || "_No text_",
        ...(link === undefined ? {} : { link }),
        metadata: {
          ts: message.ts,
          user: renderUser(message),
          subtype: typeof message.subtype === "string" ? message.subtype : null,
        },
      };
    }),
    metadata,
    updatedAt: new Date(Number.parseFloat(latestTs) * 1000).toISOString(),
    parentSourceId: input.channel,
    raw: sorted as unknown as JsonValue,
  };
  return {
    channel: input.channel,
    date,
    document,
    item,
    latestTs,
    messageCount: sorted.length,
    rawPath,
    sourceId,
    sourceUrl,
    threadTs: input.threadTs,
    title,
    written,
    skipped,
    ...(input.channelName === undefined ? {} : { channelName: input.channelName }),
  };
}

async function discoverConversations(
  client: SlackApiClient,
  config: SlackConnectorConfig,
): Promise<SlackConversation[]> {
  const types = ["public_channel"];
  const includePrivateChannels = parseBoolean(config.includePrivateChannels, true);
  if (includePrivateChannels) {
    types.push("private_channel");
  }
  if (parseBoolean(config.includeDms, false)) {
    types.push("im", "mpim");
  }
  try {
    return await client.conversationsList({ excludeArchived: true, types });
  } catch (error: unknown) {
    if (includePrivateChannels && config.includePrivateChannels === undefined) {
      return client.conversationsList({ excludeArchived: true, types: ["public_channel"] });
    }
    throw error;
  }
}

function filterConversations(
  conversations: SlackConversation[],
  config: SlackConnectorConfig,
): SlackConversation[] {
  const requested = new Set(splitCsv(config.channels).map((item) => item.replace(/^#/, "")));
  const regex = config.channelRegex?.trim() ? new RegExp(config.channelRegex.trim()) : null;
  return conversations.filter((conversation) => {
    if (conversation.is_archived) {
      return false;
    }
    const name = conversationName(conversation);
    if (requested.size > 0 && !requested.has(conversation.id) && !requested.has(name)) {
      return false;
    }
    if (regex && !regex.test(name)) {
      return false;
    }
    return true;
  });
}

function resolveOldestTs(
  config: SlackConnectorConfig,
  checkpoint: SlackChannelCheckpoint,
): string | undefined {
  const sinceTs = isoToSlackTs(config.since);
  if (checkpoint.latestTs) {
    const lookbackMinutes = parseOptionalInteger(config.lookbackMinutes, "lookbackMinutes") ?? 60;
    const lookbackTs = shiftSlackTs(checkpoint.latestTs, -lookbackMinutes * 60);
    return maxDefinedSlackTs(sinceTs, lookbackTs);
  }
  if (sinceTs !== undefined) {
    return sinceTs;
  }
  if (parseBoolean(config.allHistory, false)) {
    return undefined;
  }
  throw new Error("First Slack sync requires --since ISO_DATE or --all-history.");
}

async function readSlackCheckpoint(repoRoot: string): Promise<SlackSyncCheckpoint> {
  const record = await readConnectorCheckpoint("slack", repoRoot);
  if (!record) {
    return { version: 1, channels: {} };
  }
  return checkpointFromJson(record.data);
}

async function writeSlackCheckpoint(
  checkpoint: SlackSyncCheckpoint,
  runtime: ConnectorRuntime,
): Promise<void> {
  await writeConnectorCheckpoint({
    connector: "slack",
    data: checkpointToJson(checkpoint),
    repoRoot: runtime.repoRoot,
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
  });
}

function checkpointFromJson(data: JsonObject): SlackSyncCheckpoint {
  const channels: Record<string, SlackChannelCheckpoint> = {};
  const rawChannels = asObject(data.channels);
  for (const [id, value] of Object.entries(rawChannels ?? {})) {
    const item = asObject(value);
    if (!item) {
      continue;
    }
    channels[id] = {
      ...(typeof item.latestTs === "string" ? { latestTs: item.latestTs } : {}),
      ...(typeof item.name === "string" ? { name: item.name } : {}),
      ...(typeof item.syncedAt === "string" ? { syncedAt: item.syncedAt } : {}),
    };
  }
  return { version: 1, channels };
}

function checkpointToJson(checkpoint: SlackSyncCheckpoint): JsonObject {
  const channels: JsonObject = {};
  for (const [id, value] of Object.entries(checkpoint.channels)) {
    channels[id] = {
      ...(value.latestTs === undefined ? {} : { latestTs: value.latestTs }),
      ...(value.name === undefined ? {} : { name: value.name }),
      ...(value.syncedAt === undefined ? {} : { syncedAt: value.syncedAt }),
    };
  }
  return {
    version: checkpoint.version,
    channels,
  };
}

function shouldFetchThread(message: SlackMessage): boolean {
  const threadTs = message.thread_ts ?? message.ts;
  return threadTs !== message.ts || Number(message.reply_count ?? 0) > 0;
}

function shouldFilterMessage(message: SlackMessage, config: SlackConnectorConfig): boolean {
  if (!parseBoolean(config.includeBotMessages, false) && (message.bot_id || message.app_id)) {
    return true;
  }
  return typeof message.subtype === "string" && DISALLOWED_MESSAGE_SUBTYPES.has(message.subtype);
}

function renderUser(message: SlackMessage): string {
  return firstString(message, ["user", "username", "bot_id"], "unknown");
}

function renderMessages(messages: SlackMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const ts = message.ts;
    const user = renderUser(message);
    const text = String(message.text ?? "").trim();
    lines.push(`## ${ts} | ${user}`, "", text || "_No text_");
    if (message.reactions) {
      lines.push("", `Reactions: \`${JSON.stringify(message.reactions)}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function inferThreadTitle(message: SlackMessage): string {
  const text = String(message.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? "Slack thread" : text.slice(0, 80);
}

function messageDate(ts: string): string {
  const value = Number.parseFloat(ts);
  if (!Number.isFinite(value)) {
    return utcNow().toISOString().slice(0, 10);
  }
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function resolveWorkspaceUrl(
  config: Pick<SlackConnectorConfig, "workspaceUrl">,
  runtime: ConnectorRuntime,
  fallback?: string,
): string {
  return (
    config.workspaceUrl?.trim() ||
    runtime.env.SLACK_WORKSPACE_URL?.trim() ||
    fallback ||
    ""
  ).replace(/\/$/, "");
}

function conversationName(conversation: SlackConversation): string {
  return typeof conversation.name === "string" && conversation.name.trim() !== ""
    ? conversation.name.trim()
    : conversation.id;
}

function toSlackMessage(value: unknown): SlackMessage[] {
  const object = asObject(value);
  const ts = typeof object?.ts === "string" ? object.ts : "";
  return ts === "" ? [] : [{ ...object, ts } as SlackMessage];
}

function requireMessage(message: SlackMessage | undefined): SlackMessage {
  if (message === undefined) {
    throw new Error("No Slack messages found.");
  }
  return message;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function parseBoolean(value: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseOptionalInteger(
  value: number | string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function limitItems<T>(items: T[], limit: number | undefined): T[] {
  return limit === undefined ? items : items.slice(0, limit);
}

function isoToSlackTs(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T00:00:00.000Z`
    : value.trim();
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Slack since value: ${value}`);
  }
  return (date.getTime() / 1000).toFixed(6);
}

function shiftSlackTs(ts: string, seconds: number): string {
  const value = Number.parseFloat(ts);
  if (!Number.isFinite(value)) {
    return ts;
  }
  return Math.max(0, value + seconds).toFixed(6);
}

function maxDefinedSlackTs(
  first: string | undefined,
  second: string | undefined,
): string | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  return maxSlackTs(first, second);
}

function maxSlackTs(first: string, second: string): string {
  return Number.parseFloat(second) > Number.parseFloat(first) ? second : first;
}

function slackTsSlug(ts: string): string {
  return ts.replace(/[^0-9]+/g, "") || "0";
}
