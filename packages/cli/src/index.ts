#!/usr/bin/env bun
import process from "node:process";
import { createInterface } from "node:readline/promises";
import {
  clearChatGptCredentials,
  createModelAdapter,
  getChatGptCredentials,
  listMaintenanceJobs,
  loginChatGpt,
  type ModelProviderName,
  runAgentLoop,
  runMaintenanceJob,
  runReflection,
  setChatGptCredentials,
} from "@strata/agent";
import { ensureRuntimeDirs, getStrataPaths, type SessionRecord, SessionStore } from "@strata/core";
import { loadDotenv } from "@strata/ingest/common";
import {
  type ConnectorConfig,
  type ConnectorSessionResult,
  runConnectorOperation,
} from "@strata/ingest/connectors";
import { runSlackSocketModeListener } from "@strata/ingest/slack-socket-mode";
import { createDefaultToolRegistry, type ToolProfile } from "@strata/tools";
import { runTui } from "@strata/tui";

type CommandResult = number;

function usage(): string {
  return `usage: strata <command>

commands:
  auth status                  show configured model auth without exposing tokens
  auth login openai-codex      sign in with ChatGPT for Codex model access
  auth logout openai-codex     remove stored ChatGPT credentials
  init                         initialize .strata runtime directories
  ingest notion --page-id ID    snapshot a Notion page or URL into wiki/raw/notion
  ingest granola [options]      snapshot Granola meetings into wiki/raw/granola
  ingest slack [options]        snapshot an explicit Slack thread into wiki/raw/slack
  query [options] <question>   run an agent query using the default dangerous tool profile
  learn reflect [options] <id>  reflect on a completed session trace
  maintain list                list maintenance jobs
  maintain run <job>           run one maintenance job and persist a trace
  tui                          launch the interactive Strata TUI
  trace <title>                write a dummy trace session for harness smoke tests
  sessions list [--limit N]    list recent sessions
  sessions search <query>      search sessions using the current simple index
  tools list [--profile P]     list registered harness tools
  tools call [--profile P] <name> [json]
`;
}

type ProviderName = ModelProviderName;

interface ModelOptions {
  provider?: ProviderName;
  model?: string;
}

interface QueryOptions extends ModelOptions {
  question: string;
}

interface ReflectOptions extends ModelOptions {
  sessionId: string;
}

interface NotionIngestOptions {
  pageId: string;
  dryRun: boolean;
}

interface GranolaIngestOptions {
  dryRun: boolean;
  fixture?: string;
  meetingsUrl?: string;
  since?: string;
  transcriptUrlTemplate?: string;
}

interface SlackIngestOptions {
  dryRun: boolean;
  allHistory?: boolean;
  appToken?: string;
  botToken?: string;
  channel?: string;
  channelRegex?: string;
  channels?: string;
  fromJson?: string;
  includeBotMessages?: boolean;
  includeDms?: boolean;
  includePrivateChannels?: boolean;
  lookbackMinutes?: number;
  maxChannels?: number;
  maxMessagesPerChannel?: number;
  maxThreads?: number;
  mode: "listen" | "sync" | "thread";
  since?: string;
  threadTs?: string;
  title?: string;
  userToken?: string;
  workspaceUrl?: string;
}

const INGEST_USAGE = `usage:
  strata ingest notion --page-id PAGE_ID_OR_URL [--dry-run]
  strata ingest granola [--since ISO] [--fixture FILE] [--meetings-url URL] [--transcript-url-template URL] [--dry-run]
  strata ingest slack thread [--channel CHANNEL --thread-ts TS | --from-json FILE] [--title TITLE] [--dry-run]
  strata ingest slack sync [--since ISO | --all-history] [--channels LIST | --channel-regex REGEX]
                           [--include-private | --no-private] [--include-dms]
                           [--include-bot-messages] [--lookback-minutes N]
                           [--max-channels N] [--max-messages-per-channel N] [--max-threads N]
                           [--dry-run]
  strata ingest slack listen [--include-bot-messages]`;

function parseLimit(args: string[], fallback = 20): number {
  const index = args.indexOf("--limit");
  if (index === -1) {
    return fallback;
  }
  const raw = args[index + 1];
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("--limit requires a positive integer");
  }
  args.splice(index, 2);
  return parsed;
}

function printSessions(sessions: SessionRecord[]): void {
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  for (const session of sessions) {
    const ended = session.endedAt ? session.endedAt : "running";
    console.log(
      `${session.startedAt}  ${session.status.padEnd(11)}  ${session.kind.padEnd(7)}  ${session.id}  ${session.title}  (${ended})`,
    );
  }
}

async function withStore<T>(fn: (store: SessionStore) => Promise<T> | T): Promise<T> {
  const store = await SessionStore.open();
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

async function cmdInit(): Promise<CommandResult> {
  const paths = getStrataPaths();
  await ensureRuntimeDirs(paths);
  console.log(`initialized ${paths.runtimeDir}`);
  return 0;
}

async function cmdTrace(args: string[]): Promise<CommandResult> {
  const title = args.join(" ").trim() || "Harness smoke trace";
  return withStore(async (store) => {
    const session = await store.createSession({ kind: "trace", title });
    await store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: `Trace smoke test: ${title}`,
    });
    await store.appendEvent(session.id, "trace.smoke_test", { title });
    await store.endSession(session.id, "completed");
    console.log(`created ${session.id}`);
    return 0;
  });
}

async function cmdQuery(args: string[]): Promise<CommandResult> {
  const options = parseQueryOptions(args);
  if (!options.question) {
    throw new Error("query requires a question");
  }

  const result = await runAgentLoop({
    question: options.question,
    model: await createModelAdapter(options),
    repoRoot: getStrataPaths().repoRoot,
  });

  if (result.finalAnswer.trim() !== "") {
    console.log(result.finalAnswer.trim());
  } else {
    console.log(`No final answer produced before stop reason: ${result.stoppedReason}`);
  }
  console.log(
    `\n[session: ${result.sessionId}; status: ${result.status}; iterations: ${result.iterations}; tool calls: ${result.toolCalls}]`,
  );
  return result.status === "failed" ? 1 : 0;
}

async function cmdIngest(args: string[]): Promise<CommandResult> {
  const source = args.shift();
  if (!source || source === "--help" || source === "-h") {
    console.log(INGEST_USAGE);
    return 0;
  }

  if (source === "notion") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(INGEST_USAGE);
      return 0;
    }
    const options = parseNotionIngestOptions(args);
    await loadDotenv();
    const token = Bun.env.NOTION_TOKEN ?? "";
    if (token === "") {
      throw new Error("Set NOTION_TOKEN in .env or the environment.");
    }
    const repoRoot = getStrataPaths().repoRoot;
    const result = await runConnectorOperation({
      name: "notion",
      operation: options.dryRun ? "dry_run" : "pull",
      config: { pageId: options.pageId },
      repoRoot,
      env: Bun.env,
      title: `Ingest Notion page ${options.pageId}`,
    });
    printConnectorResult(result);
    return 0;
  }

  if (source === "granola") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(INGEST_USAGE);
      return 0;
    }
    const options = parseGranolaIngestOptions(args);
    await loadDotenv();
    const result = await runConnectorOperation({
      name: "granola",
      operation: options.dryRun ? "dry_run" : "pull",
      config: compactConfig({
        fixture: options.fixture,
        meetingsUrl: options.meetingsUrl,
        since: options.since,
        transcriptUrlTemplate: options.transcriptUrlTemplate,
      }),
      repoRoot: getStrataPaths().repoRoot,
      env: Bun.env,
      title: "Ingest Granola meetings",
    });
    printConnectorResult(result);
    return 0;
  }

  if (source === "slack") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(INGEST_USAGE);
      return 0;
    }
    const options = parseSlackIngestOptions(args);
    await loadDotenv();
    const config = compactConfig({
      allHistory: options.allHistory,
      appToken: options.appToken,
      botToken: options.botToken,
      channel: options.channel,
      channelRegex: options.channelRegex,
      channels: options.channels,
      fromJson: options.fromJson,
      includeBotMessages: options.includeBotMessages,
      includeDms: options.includeDms,
      includePrivateChannels: options.includePrivateChannels,
      lookbackMinutes: options.lookbackMinutes,
      maxChannels: options.maxChannels,
      maxMessagesPerChannel: options.maxMessagesPerChannel,
      maxThreads: options.maxThreads,
      mode: options.mode === "listen" ? "thread" : options.mode,
      since: options.since,
      threadTs: options.threadTs,
      title: options.title,
      userToken: options.userToken,
      workspaceUrl: options.workspaceUrl,
    });
    if (options.mode === "listen") {
      await runSlackSocketModeListener({
        config,
        runtime: {
          repoRoot: getStrataPaths().repoRoot,
          env: Bun.env,
        },
        onEvent: (event) => {
          const state = event.written ? "wrote" : event.skipped ? "skipped" : "processed";
          console.log(`${state} ${event.rawPath ?? `${event.channel}:${event.threadTs}`}`);
        },
        onStatus: (message) => console.log(message),
      });
      return 0;
    }
    const result = await runConnectorOperation({
      name: "slack",
      operation: options.dryRun ? "dry_run" : "pull",
      config,
      repoRoot: getStrataPaths().repoRoot,
      env: Bun.env,
      title: options.mode === "sync" ? "Sync Slack conversations" : "Ingest Slack thread",
    });
    printConnectorResult(result);
    return 0;
  }

  throw new Error(`Unknown ingest source: ${source}`);
}

async function cmdAuth(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: strata auth <status|login|logout> [openai-codex]`);
    return 0;
  }

  if (subcommand === "status") {
    const credentials = await getChatGptCredentials();
    if (credentials === undefined) {
      console.log("openai-codex: not logged in");
    } else {
      console.log(
        `openai-codex: logged in, token expires ${new Date(credentials.expiresAt).toISOString()}`,
      );
    }
    const apiKeyConfigured = Boolean(Bun.env.STRATA_API_KEY ?? Bun.env.OPENAI_API_KEY);
    console.log(`openai-compatible: ${apiKeyConfigured ? "API key configured" : "not configured"}`);
    return 0;
  }

  const provider = args.shift() ?? "openai-codex";
  if (provider !== "openai-codex") {
    throw new Error(`Unsupported auth provider: ${provider}`);
  }

  if (subcommand === "login") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const credentials = await loginChatGpt({
        onAuth(info) {
          console.log(`Open this URL in your browser:\n${info.url}\n`);
          console.log(info.instructions);
        },
        onManualCodeInput: async () => {
          const value = await rl.question(
            "Paste redirect URL/code, or press Enter to wait for callback: ",
          );
          if (value.trim() === "") {
            return new Promise<string>(() => {});
          }
          return value;
        },
        onPrompt: (prompt) => rl.question(`${prompt} `),
        onProgress: (message) => console.log(message),
      });
      await setChatGptCredentials(credentials);
      console.log(
        `Logged in to openai-codex. Token expires ${new Date(credentials.expiresAt).toISOString()}`,
      );
      return 0;
    } finally {
      rl.close();
    }
  }

  if (subcommand === "logout") {
    await clearChatGptCredentials();
    console.log("Logged out of openai-codex.");
    return 0;
  }

  throw new Error(`Unknown auth subcommand: ${subcommand}`);
}

async function cmdSessions(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: strata sessions <list|search>`);
    return 0;
  }

  if (subcommand === "list") {
    const limit = parseLimit(args);
    if (args.length !== 0) {
      throw new Error(`Unknown sessions list argument: ${args.join(" ")}`);
    }
    return withStore((store) => {
      printSessions(store.listSessions(limit));
      return 0;
    });
  }

  if (subcommand === "search") {
    const limit = parseLimit(args);
    const query = args.join(" ").trim();
    if (!query) {
      throw new Error("sessions search requires a query");
    }
    return withStore((store) => {
      printSessions(store.searchSessions(query, limit));
      return 0;
    });
  }

  throw new Error(`Unknown sessions subcommand: ${subcommand}`);
}

async function cmdLearn(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: strata learn reflect [--provider P] [--model M] <session-id>`);
    return 0;
  }

  if (subcommand === "reflect") {
    const options = parseReflectOptions(args);
    const result = await runReflection({
      sessionId: options.sessionId,
      repoRoot: getStrataPaths().repoRoot,
      model: await createModelAdapter(options),
    });
    console.log(`reflection report: ${result.reportPath}`);
    console.log(`applied: ${result.applied.length}`);
    console.log(`proposals: ${result.proposals.length}`);
    console.log(`skipped: ${result.skipped.length}`);
    if (result.noops.length > 0) {
      console.log(`noops: ${result.noops.length}`);
    }
    for (const proposal of result.proposals) {
      console.log(`proposal: ${proposal.path}`);
    }
    return 0;
  }

  throw new Error(`Unknown learn subcommand: ${subcommand}`);
}

async function cmdMaintain(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: strata maintain <list|run> [job]`);
    return 0;
  }

  if (subcommand === "list") {
    if (args.length !== 0) {
      throw new Error(`Unknown maintain list argument: ${args.join(" ")}`);
    }
    for (const job of listMaintenanceJobs()) {
      console.log(`${job.name.padEnd(18)} ${job.description}`);
    }
    return 0;
  }

  if (subcommand === "run") {
    const jobName = args.shift();
    if (jobName === undefined || jobName.trim() === "") {
      throw new Error("maintain run requires a job name");
    }
    if (args.length !== 0) {
      throw new Error(`Unknown maintain run argument: ${args.join(" ")}`);
    }
    const result = await runMaintenanceJob({
      jobName,
      repoRoot: getStrataPaths().repoRoot,
    });
    console.log(`${result.job}: ${result.status}`);
    console.log(result.summary);
    console.log(`session: ${result.sessionId}`);
    console.log(`report: ${result.reportPath}`);
    console.log(`findings: ${result.findings.length}`);
    console.log(`proposals: ${result.proposals.length}`);
    for (const proposal of result.proposals) {
      console.log(`proposal: ${proposal.path}`);
    }
    return result.status === "ok" ? 0 : 2;
  }

  throw new Error(`Unknown maintain subcommand: ${subcommand}`);
}

async function cmdTools(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(
      `usage: strata tools <list|call> [--profile read-only|maintenance|learning|dangerous]`,
    );
    return 0;
  }

  const profile = parseToolProfile(args);
  const registry = createDefaultToolRegistry({ profile });

  if (subcommand === "list") {
    if (args.length !== 0) {
      throw new Error(`Unknown tools list argument: ${args.join(" ")}`);
    }
    for (const tool of registry.list()) {
      console.log(`${tool.name.padEnd(16)} ${tool.mode.padEnd(8)} ${tool.description}`);
    }
    return 0;
  }

  if (subcommand === "call") {
    const name = args.shift();
    if (!name) {
      throw new Error("tools call requires a tool name");
    }
    if (args.length > 1) {
      throw new Error("tools call accepts at most one JSON argument object");
    }
    const result = await registry.safeExecuteText(name, args[0] ?? "{}", {
      repoRoot: getStrataPaths().repoRoot,
    });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  }

  throw new Error(`Unknown tools subcommand: ${subcommand}`);
}

async function main(argv: string[]): Promise<CommandResult> {
  const command = argv.shift();
  if (!command || command === "--help" || command === "-h") {
    console.log(usage());
    return 0;
  }

  if (command === "init") {
    return cmdInit();
  }
  if (command === "auth") {
    return cmdAuth(argv);
  }
  if (command === "ingest") {
    return cmdIngest(argv);
  }
  if (command === "query") {
    return cmdQuery(argv);
  }
  if (command === "learn") {
    return cmdLearn(argv);
  }
  if (command === "maintain") {
    return cmdMaintain(argv);
  }
  if (command === "tui") {
    await runTui({ repoRoot: getStrataPaths().repoRoot });
    return 0;
  }
  if (command === "trace") {
    return cmdTrace(argv);
  }
  if (command === "sessions") {
    return cmdSessions(argv);
  }
  if (command === "tools") {
    return cmdTools(argv);
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);

function parseToolProfile(args: string[]): ToolProfile {
  const index = args.indexOf("--profile");
  if (index === -1) {
    return "read-only";
  }
  const value = args[index + 1];
  if (
    value !== "read-only" &&
    value !== "maintenance" &&
    value !== "learning" &&
    value !== "dangerous"
  ) {
    throw new Error("--profile must be read-only, maintenance, learning, or dangerous");
  }
  args.splice(index, 2);
  return value;
}

function parseQueryOptions(args: string[]): QueryOptions {
  const { provider, model, rest } = parseModelOptions(args);
  const parsed: QueryOptions = {
    question: rest.join(" ").trim(),
  };
  if (provider !== undefined) {
    parsed.provider = provider;
  }
  if (model !== undefined) {
    parsed.model = model;
  }
  return parsed;
}

function parseReflectOptions(args: string[]): ReflectOptions {
  const { provider, model, rest } = parseModelOptions(args);
  if (rest.length !== 1 || rest[0]?.trim() === "") {
    throw new Error("learn reflect requires exactly one session id");
  }
  const sessionId = rest[0];
  if (sessionId === undefined) {
    throw new Error("learn reflect requires exactly one session id");
  }
  const parsed: ReflectOptions = {
    sessionId,
  };
  if (provider !== undefined) {
    parsed.provider = provider;
  }
  if (model !== undefined) {
    parsed.model = model;
  }
  return parsed;
}

function parseNotionIngestOptions(args: string[]): NotionIngestOptions {
  const parsed: Partial<NotionIngestOptions> = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") {
      const value = args[index + 1];
      if (value === undefined || value.trim() === "") {
        throw new Error("--page-id requires a value");
      }
      parsed.pageId = value;
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown ingest notion argument: ${arg}`);
    }
  }
  if (parsed.pageId === undefined || parsed.pageId.trim() === "") {
    throw new Error("ingest notion requires --page-id");
  }
  return {
    pageId: parsed.pageId,
    dryRun: parsed.dryRun ?? false,
  };
}

function parseGranolaIngestOptions(args: string[]): GranolaIngestOptions {
  const parsed: GranolaIngestOptions = { dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--since") {
      parsed.since = requireArgValue(args[++index], "--since requires a value");
    } else if (arg === "--fixture") {
      parsed.fixture = requireArgValue(args[++index], "--fixture requires a value");
    } else if (arg === "--meetings-url") {
      parsed.meetingsUrl = requireArgValue(args[++index], "--meetings-url requires a value");
    } else if (arg === "--transcript-url-template") {
      parsed.transcriptUrlTemplate = requireArgValue(
        args[++index],
        "--transcript-url-template requires a value",
      );
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown ingest granola argument: ${arg}`);
    }
  }
  return parsed;
}

function parseSlackIngestOptions(args: string[]): SlackIngestOptions {
  const first = args[0];
  let mode: SlackIngestOptions["mode"] = "thread";
  if (first === "listen") {
    mode = "listen";
  } else if (first === "sync" || args.some((arg) => SLACK_SYNC_FLAGS.has(arg))) {
    mode = "sync";
  }
  if (first === "listen" || first === "sync" || first === "thread") {
    args.shift();
    mode = first;
  }
  const parsed: SlackIngestOptions = { dryRun: false, mode };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--channel") {
      parsed.channel = requireArgValue(args[++index], "--channel requires a value");
    } else if (arg === "--thread-ts") {
      parsed.threadTs = requireArgValue(args[++index], "--thread-ts requires a value");
    } else if (arg === "--from-json") {
      parsed.fromJson = requireArgValue(args[++index], "--from-json requires a value");
    } else if (arg === "--title") {
      parsed.title = requireArgValue(args[++index], "--title requires a value");
    } else if (arg === "--channels") {
      parsed.channels = requireArgValue(args[++index], "--channels requires a value");
    } else if (arg === "--channel-regex") {
      parsed.channelRegex = requireArgValue(args[++index], "--channel-regex requires a value");
    } else if (arg === "--since") {
      parsed.since = requireArgValue(args[++index], "--since requires a value");
    } else if (arg === "--all-history") {
      parsed.allHistory = true;
    } else if (arg === "--include-private") {
      parsed.includePrivateChannels = true;
    } else if (arg === "--no-private") {
      parsed.includePrivateChannels = false;
    } else if (arg === "--include-dms") {
      parsed.includeDms = true;
    } else if (arg === "--include-bot-messages") {
      parsed.includeBotMessages = true;
    } else if (arg === "--lookback-minutes") {
      parsed.lookbackMinutes = parsePositiveIntegerArg(
        args[++index],
        "--lookback-minutes requires a positive integer",
      );
    } else if (arg === "--max-channels") {
      parsed.maxChannels = parsePositiveIntegerArg(
        args[++index],
        "--max-channels requires a positive integer",
      );
    } else if (arg === "--max-messages-per-channel") {
      parsed.maxMessagesPerChannel = parsePositiveIntegerArg(
        args[++index],
        "--max-messages-per-channel requires a positive integer",
      );
    } else if (arg === "--max-threads") {
      parsed.maxThreads = parsePositiveIntegerArg(
        args[++index],
        "--max-threads requires a positive integer",
      );
    } else if (arg === "--bot-token") {
      parsed.botToken = requireArgValue(args[++index], "--bot-token requires a value");
    } else if (arg === "--user-token") {
      parsed.userToken = requireArgValue(args[++index], "--user-token requires a value");
    } else if (arg === "--app-token") {
      parsed.appToken = requireArgValue(args[++index], "--app-token requires a value");
    } else if (arg === "--workspace-url") {
      parsed.workspaceUrl = requireArgValue(args[++index], "--workspace-url requires a value");
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown ingest slack argument: ${arg}`);
    }
  }
  if (parsed.mode === "thread" && !parsed.fromJson && (!parsed.channel || !parsed.threadTs)) {
    throw new Error("ingest slack thread requires --from-json or both --channel and --thread-ts");
  }
  return parsed;
}

const SLACK_SYNC_FLAGS = new Set([
  "--all-history",
  "--channel-regex",
  "--channels",
  "--include-bot-messages",
  "--include-dms",
  "--include-private",
  "--lookback-minutes",
  "--max-channels",
  "--max-messages-per-channel",
  "--max-threads",
  "--no-private",
  "--since",
]);

function requireArgValue(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(message);
  }
  return value;
}

function parsePositiveIntegerArg(value: string | undefined, message: string): number {
  const raw = requireArgValue(value, message);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(message);
  }
  return parsed;
}

function compactConfig(input: Record<string, ConnectorConfig[string]>): ConnectorConfig {
  const config: ConnectorConfig = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim() !== "") {
      config[key] = value;
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      config[key] = value;
    }
  }
  return config;
}

function printConnectorResult(result: ConnectorSessionResult): void {
  const itemCount = result.items?.length ?? 0;
  if (itemCount > 1) {
    const written = result.items?.filter((item) => item.written).length ?? 0;
    const skipped = result.items?.filter((item) => item.skipped).length ?? 0;
    if (result.dryRun) {
      console.log(`would write ${itemCount} items`);
    } else {
      console.log(`processed ${itemCount} items (${written} written, ${skipped} skipped)`);
    }
    for (const item of result.items ?? []) {
      console.log(
        `${result.dryRun ? "would write" : item.written ? "wrote" : "skipped"} ${item.rawPath}`,
      );
    }
  } else if (result.dryRun) {
    console.log(`would write ${result.rawPath}`);
  } else if (result.written) {
    console.log(`wrote ${result.rawPath}`);
  } else {
    console.log(`skipped existing ${result.rawPath}`);
  }
  console.log(`session: ${result.sessionId}`);
}

function parseModelOptions(args: string[]): ModelOptions & { rest: string[] } {
  const rest: string[] = [];
  let provider: ProviderName | undefined;
  let model: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--provider") {
      const value = args[index + 1];
      if (value !== "openai-codex" && value !== "openai-compatible") {
        throw new Error("--provider must be openai-codex or openai-compatible");
      }
      provider = value;
      index += 1;
    } else if (arg === "--model") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--model requires a model name");
      }
      model = value;
      index += 1;
    } else {
      rest.push(arg ?? "");
    }
  }

  const parsed: ModelOptions & { rest: string[] } = { rest };
  if (provider !== undefined) {
    parsed.provider = provider;
  }
  if (model !== undefined) {
    parsed.model = model;
  }
  return parsed;
}
