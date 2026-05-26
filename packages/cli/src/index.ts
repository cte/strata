#!/usr/bin/env bun
import process from "node:process";
import { createInterface } from "node:readline/promises";
import {
  clearAnthropicCredentials,
  clearChatGptCredentials,
  createModelAdapter,
  getAnthropicCredentials,
  getChatGptCredentials,
  listMaintenanceJobs,
  loginAnthropic,
  loginChatGpt,
  type ModelProviderName,
  runAgentLoop,
  runMaintenanceJob,
  runReflection,
  setAnthropicCredentials,
  setChatGptCredentials,
} from "@strata/agent";

import {
  ensureRuntimeDirs,
  getStrataPaths,
  refreshWikiSearchIndex,
  type SessionRecord,
  SessionStore,
  searchWikiSearchIndex,
  type WikiSearchIndexSource,
} from "@strata/core";
import { loadDotenv } from "@strata/ingest/common";
import {
  type ConnectorConfig,
  type ConnectorSessionResult,
  runConnectorOperation,
} from "@strata/ingest/connectors";
import {
  type GranolaRawToWikiIndexResult,
  type GranolaRawToWikiResult,
  type RawToWikiIndexResult,
  type RawToWikiSourceFilter,
  runGranolaRawToWikiIndex,
  runGranolaRawToWikiProposals,
  runRawToWikiIndex,
} from "@strata/ingest/raw-to-wiki";
import { runSlackSocketModeListener } from "@strata/ingest/slack-socket-mode";
import { archiveGeneratedSlackThreads, compactWikiIndex } from "@strata/ingest/wiki-index";
import { createConfiguredMcpToolPack } from "@strata/integration-mcp/exa";

import {
  createDefaultToolRegistry,
  createToolRegistryWithPacks,
  type ToolPack,
  type ToolProfile,
} from "@strata/tools";

import { type RunTuiOptions, runTui } from "@strata/tui";

type CommandResult = number;

function usage(): string {
  return `usage: strata <command>

commands:
    auth status                  show configured model auth without exposing tokens
  auth login openai-codex      sign in with ChatGPT for Codex model access
  auth login anthropic-claude  sign in with Claude for Anthropic model access
  auth logout openai-codex     remove stored ChatGPT credentials
  auth logout anthropic-claude remove stored Claude credentials

  init                         initialize .strata runtime directories
  ingest raw index              index raw source snapshots into wiki pages
  ingest notion --page-id ID    snapshot a Notion page or URL into wiki/raw/notion
  ingest granola [options]      snapshot Granola meetings into wiki/raw/granola
  ingest granola index          index raw Granola snapshots into wiki pages
  ingest granola propose        stage wiki proposals from raw Granola snapshots
  ingest slack [options]        snapshot an explicit Slack thread into wiki/raw/slack
  wiki compact-index            rebuild the human wiki index without raw-source fanout
  wiki search-index refresh     refresh the local wiki/raw retrieval index
  wiki search <query>           search the local retrieval index with curated-first ranking
  query [options] <question>   run an agent query using the default dangerous tool profile
  learn reflect [options] <id>  reflect on a completed session trace
  maintain list                list maintenance jobs
  maintain run <job>           run one maintenance job and persist a trace
  tui [options]                launch the interactive Strata TUI
  trace <title>                write a dummy trace session for harness smoke tests
  sessions list [--limit N]    list recent sessions
  sessions search <query>      search sessions using the current simple index
  sessions delete <id> [--yes] delete a session and its trace
  tools list [--profile P]     list registered harness tools
  tools call [--profile P] <name> [json]
`;
}

type ProviderName = ModelProviderName;

interface TuiCliOptions {
  help?: boolean;
  initialSession?: RunTuiOptions["initialSession"];
}

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
  index: boolean;
}

interface GranolaIngestOptions {
  dryRun: boolean;
  fixture?: string;
  index: boolean;
  maxPages?: string;
  meetingsUrl?: string;
  pageSize?: string;
  since?: string;
  transcriptUrlTemplate?: string;
}

interface GranolaProposalOptions {
  limit?: number;
  rawPaths: string[];
}

interface GranolaIndexOptions extends GranolaProposalOptions {
  dryRun: boolean;
}

interface RawIndexOptions extends GranolaIndexOptions {
  source: RawToWikiSourceFilter;
}

interface SlackIngestOptions {
  dryRun: boolean;
  index: boolean;
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

interface WikiSearchOptions {
  includeRaw: boolean;
  limit: number;
  query: string;
}

interface WikiSearchIndexRefreshOptions {
  source: WikiSearchIndexSource;
  includeRaw: boolean;
}

interface WikiCompactIndexOptions {
  dryRun: boolean;
}

interface WikiArchiveGeneratedSlackThreadsOptions {
  dryRun: boolean;
  rewriteLinks: boolean;
}

const INGEST_USAGE = `usage:
  strata ingest raw index [--source all|granola|notion|slack] [--raw-path FILE] [--limit N] [--dry-run]
  strata ingest notion --page-id PAGE_ID_OR_URL [--index] [--dry-run]
  strata ingest granola [--since ISO] [--fixture FILE] [--meetings-url URL] [--page-size N] [--max-pages N] [--transcript-url-template URL] [--index] [--dry-run]
  strata ingest granola index [--raw-path FILE] [--limit N] [--dry-run]
  strata ingest granola propose [--raw-path FILE] [--limit N]
  strata ingest slack thread [--channel CHANNEL --thread-ts TS | --from-json FILE] [--title TITLE] [--index] [--dry-run]
  strata ingest slack sync [--since ISO | --all-history] [--channels LIST | --channel-regex REGEX]
                           [--include-private | --no-private] [--include-dms]
                           [--include-bot-messages] [--lookback-minutes N]
                           [--max-channels N] [--max-messages-per-channel N] [--max-threads N]
                           [--index] [--dry-run]
  strata ingest slack listen [--include-bot-messages]`;

const WIKI_USAGE = `usage:
  strata wiki compact-index [--dry-run]
  strata wiki archive-generated-slack-threads [--dry-run] [--no-rewrite-links]
  strata wiki search-index refresh [--source all|granola|notion|slack] [--no-raw]
  strata wiki search [--include-raw] [--limit N] <query>`;

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

function consumeBooleanFlag(args: string[], ...names: string[]): boolean {
  let found = false;
  for (let index = args.length - 1; index >= 0; index -= 1) {
    if (names.includes(args[index] ?? "")) {
      args.splice(index, 1);
      found = true;
    }
  }
  return found;
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

function resolveSessionSelector(store: SessionStore, selector: string): SessionRecord {
  const exact = store.getSession(selector);
  if (exact !== undefined) {
    return exact;
  }

  const matches = store.findSessionsByIdPrefix(selector, 20);
  if (matches.length === 0) {
    throw new Error(`Session not found: ${selector}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Session id prefix is ambiguous: ${selector} (${matches.map((session) => session.id).join(", ")})`,
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw new Error(`Session not found: ${selector}`);
  }
  return match;
}

async function confirmSessionDeletion(session: SessionRecord): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error("sessions delete requires --yes when stdin is not a TTY");
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Delete session ${session.id} "${session.title || session.kind}"? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
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

  const repoRoot = getStrataPaths().repoRoot;
  const result = await runAgentLoop({
    question: options.question,
    model: await createModelAdapter(options),
    repoRoot,
    tools: await createAgentToolRegistry({ repoRoot, env: Bun.env }),
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

async function createAgentToolRegistry(options: {
  repoRoot: string;
  env: Record<string, string | undefined>;
}) {
  const packs: ToolPack[] = [createConfiguredMcpToolPack()];

  return createToolRegistryWithPacks({
    context: {
      repoRoot: options.repoRoot,
      env: options.env,
    },
    packs,
  });
}

async function cmdIngest(args: string[]): Promise<CommandResult> {
  const source = args.shift();
  if (!source || source === "--help" || source === "-h") {
    console.log(INGEST_USAGE);
    return 0;
  }

  if (source === "raw") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(INGEST_USAGE);
      return 0;
    }
    if (args[0] !== "index") {
      throw new Error("Unknown ingest raw command. Expected: ingest raw index");
    }
    args.shift();
    const options = parseRawIndexOptions(args);
    const result = await runRawToWikiIndex({
      repoRoot: getStrataPaths().repoRoot,
      source: options.source,
      rawPaths: options.rawPaths,
      dryRun: options.dryRun,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    });
    printRawIndexResult(result);
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
    if (options.index && !options.dryRun) {
      const indexed = await runRawToWikiIndex({
        repoRoot,
        source: "notion",
        rawPaths: [result.rawPath],
      });
      printRawIndexResult(indexed);
    }
    return 0;
  }

  if (source === "granola") {
    if (args.includes("--help") || args.includes("-h")) {
      console.log(INGEST_USAGE);
      return 0;
    }
    if (args[0] === "propose") {
      args.shift();
      const options = parseGranolaProposalOptions(args);
      const result = await runGranolaRawToWikiProposals({
        repoRoot: getStrataPaths().repoRoot,
        rawPaths: options.rawPaths,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      printRawToWikiResult(result);
      return 0;
    }
    if (args[0] === "index") {
      args.shift();
      const options = parseGranolaIndexOptions(args);
      const result = await runGranolaRawToWikiIndex({
        repoRoot: getStrataPaths().repoRoot,
        rawPaths: options.rawPaths,
        dryRun: options.dryRun,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      });
      printGranolaIndexResult(result);
      return 0;
    }
    const options = parseGranolaIngestOptions(args);
    await loadDotenv();
    const repoRoot = getStrataPaths().repoRoot;
    const result = await runConnectorOperation({
      name: "granola",
      operation: options.dryRun ? "dry_run" : "pull",
      config: compactConfig({
        fixture: options.fixture,
        maxPages: options.maxPages,
        meetingsUrl: options.meetingsUrl,
        pageSize: options.pageSize,
        since: options.since,
        transcriptUrlTemplate: options.transcriptUrlTemplate,
      }),
      repoRoot,
      env: Bun.env,
      title: "Ingest Granola meetings",
    });
    printConnectorResult(result);
    if (options.index && !options.dryRun) {
      const rawPaths = (result.items ?? [result]).map((item) => item.rawPath);
      const indexed = await runGranolaRawToWikiIndex({
        repoRoot,
        rawPaths,
      });
      printGranolaIndexResult(indexed);
    }
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
    if (options.index && !options.dryRun) {
      const rawPaths = (result.items ?? [result]).map((item) => item.rawPath);
      const indexed = await runRawToWikiIndex({
        repoRoot: getStrataPaths().repoRoot,
        source: "slack",
        rawPaths,
      });
      printRawIndexResult(indexed);
    }
    return 0;
  }

  throw new Error(`Unknown ingest source: ${source}`);
}

async function cmdWiki(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(WIKI_USAGE);
    return 0;
  }

  if (subcommand === "compact-index") {
    const options = parseWikiCompactIndexOptions(args);
    const result = await compactWikiIndex({
      repoRoot: getStrataPaths().repoRoot,
      dryRun: options.dryRun,
    });
    console.log(`${result.dryRun ? "would write" : "wrote"} ${result.writtenPaths.length} paths`);
    for (const writtenPath of result.writtenPaths) {
      console.log(`- ${writtenPath}`);
    }
    console.log(
      `counts: people=${result.counts.people} projects=${result.counts.projects} meetings=${result.counts.meetings} decisions=${result.counts.decisions} threads=${result.counts.threads} slack_raw=${result.counts.slackRawThreads}`,
    );
    if (result.counts.omittedDecisions > 0 || result.counts.omittedThreads > 0) {
      console.log(
        `omitted from root index: decisions=${result.counts.omittedDecisions} threads=${result.counts.omittedThreads}`,
      );
    }
    return 0;
  }

  if (subcommand === "archive-generated-slack-threads") {
    const options = parseWikiArchiveGeneratedSlackThreadsOptions(args);
    const result = await archiveGeneratedSlackThreads({
      repoRoot: getStrataPaths().repoRoot,
      dryRun: options.dryRun,
      rewriteLinks: options.rewriteLinks,
    });
    console.log(`${result.dryRun ? "would archive" : "archived"} ${result.archived} pages`);
    console.log(`scanned: ${result.scanned}`);
    console.log(`kept: ${result.kept}`);
    console.log(`missing raw sources: ${result.missingRawSources}`);
    console.log(`rewritten files: ${result.rewrittenFiles}`);
    console.log(`rewritten links: ${result.rewrittenLinks}`);
    console.log(`archive: ${result.archiveDir}`);
    if (result.manifestPath !== null) {
      console.log(`manifest: ${result.manifestPath}`);
    }
    return 0;
  }

  if (subcommand === "search-index") {
    const action = args.shift();
    if (action !== "refresh") {
      throw new Error("Unknown wiki search-index command. Expected: wiki search-index refresh");
    }
    const options = parseWikiSearchIndexRefreshOptions(args);
    const result = await refreshWikiSearchIndex({
      repoRoot: getStrataPaths().repoRoot,
      source: options.source,
      includeRaw: options.includeRaw,
    });
    console.log(
      `indexed ${result.indexed} docs (curated=${result.curated}, sources=${result.sources}, raw=${result.raw})`,
    );
    return 0;
  }

  if (subcommand === "search") {
    const options = parseWikiSearchOptions(args);
    const matches = await searchWikiSearchIndex({
      repoRoot: getStrataPaths().repoRoot,
      query: options.query,
      includeRaw: options.includeRaw,
      limit: options.limit,
    });
    const results = matches ?? [];
    for (const match of results) {
      console.log(`${match.path}:${match.line} ${match.preview}`);
    }
    console.log(`matches: ${results.length}${matches === null ? " (search index is empty)" : ""}`);
    return 0;
  }

  throw new Error(`Unknown wiki subcommand: ${subcommand}`);
}

async function cmdAuth(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: strata auth <status|login|logout> [openai-codex|anthropic-claude]`);
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
    const anthropicCredentials = await getAnthropicCredentials();
    if (anthropicCredentials === undefined) {
      console.log("anthropic-claude: not logged in");
    } else {
      console.log(
        `anthropic-claude: logged in, token expires ${new Date(anthropicCredentials.expiresAt).toISOString()}`,
      );
    }
    const apiKeyConfigured = Boolean(Bun.env.STRATA_API_KEY ?? Bun.env.OPENAI_API_KEY);
    console.log(`openai-compatible: ${apiKeyConfigured ? "API key configured" : "not configured"}`);
    return 0;
  }

  const provider = args.shift() ?? "openai-codex";
  if (provider !== "openai-codex" && provider !== "anthropic-claude") {
    throw new Error(`Unsupported auth provider: ${provider}`);
  }

  if (subcommand === "login") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const callbacks = {
        onAuth(info: { url: string; instructions: string }) {
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
        onPrompt: (prompt: string) => rl.question(`${prompt} `),
        onProgress: (message: string) => console.log(message),
      };
      if (provider === "anthropic-claude") {
        const credentials = await loginAnthropic(callbacks);
        await setAnthropicCredentials(credentials);
        console.log(
          `Logged in to ${provider}. Token expires ${new Date(credentials.expiresAt).toISOString()}`,
        );
      } else {
        const credentials = await loginChatGpt(callbacks);
        await setChatGptCredentials(credentials);
        console.log(
          `Logged in to ${provider}. Token expires ${new Date(credentials.expiresAt).toISOString()}`,
        );
      }

      return 0;
    } finally {
      rl.close();
    }
  }

  if (subcommand === "logout") {
    if (provider === "anthropic-claude") {
      await clearAnthropicCredentials();
    } else {
      await clearChatGptCredentials();
    }
    console.log(`Logged out of ${provider}.`);
    return 0;
  }

  throw new Error(`Unknown auth subcommand: ${subcommand}`);
}

async function cmdSessions(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: strata sessions <list|search|delete>`);
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

  if (subcommand === "delete" || subcommand === "rm") {
    const assumeYes = consumeBooleanFlag(args, "--yes", "-y");
    const selector = args.shift();
    if (selector === undefined || selector.trim() === "") {
      throw new Error("sessions delete requires a session id or unique id prefix");
    }
    if (args.length !== 0) {
      throw new Error(`Unknown sessions delete argument: ${args.join(" ")}`);
    }
    return withStore(async (store) => {
      const session = resolveSessionSelector(store, selector);
      if (!assumeYes) {
        const confirmed = await confirmSessionDeletion(session);
        if (!confirmed) {
          console.log("cancelled");
          return 1;
        }
      }
      const result = await store.deleteSession(session.id);
      const traceSummary =
        result.traceMethod === "trash"
          ? "trace moved to trash"
          : result.traceMethod === "unlink"
            ? "trace deleted"
            : "trace already missing";
      console.log(`deleted session ${result.id} (${traceSummary})`);
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

function tuiUsage(): string {
  return `usage: strata tui [options]

options:
  --continue, -c        continue the most recent session
  --resume, -r          select a session to resume
  --session <id>        resume a specific session by id or unique id prefix
  --fork <id>           fork a specific session by id or unique id prefix
  --help, -h            show this help
`;
}

function parseTuiOptions(args: string[]): TuiCliOptions {
  let showHelp = false;
  let continueRequested = false;
  let resumeRequested = false;
  let sessionSelector: string | undefined;
  let forkSelector: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--continue" || arg === "-c") {
      continueRequested = true;
    } else if (arg === "--resume" || arg === "-r") {
      resumeRequested = true;
    } else if (arg === "--session") {
      sessionSelector = requireArgValue(args[++index], "--session requires a session id");
    } else if (arg === "--fork") {
      forkSelector = requireArgValue(args[++index], "--fork requires a session id");
    } else {
      throw new Error(`Unknown tui argument: ${arg}`);
    }
  }

  if (
    forkSelector !== undefined &&
    (sessionSelector !== undefined || resumeRequested || continueRequested)
  ) {
    throw new Error("--fork cannot be combined with --session, --resume, or --continue");
  }

  const parsed: TuiCliOptions = {};
  if (showHelp) {
    parsed.help = true;
  }
  if (forkSelector !== undefined) {
    parsed.initialSession = { type: "fork", selector: forkSelector };
  } else if (sessionSelector !== undefined) {
    parsed.initialSession = { type: "session", selector: sessionSelector };
  } else if (resumeRequested) {
    parsed.initialSession = { type: "resume" };
  } else if (continueRequested) {
    parsed.initialSession = { type: "continue" };
  }
  return parsed;
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
  if (command === "wiki") {
    return cmdWiki(argv);
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
    const options = parseTuiOptions(argv);
    if (options.help) {
      console.log(tuiUsage());
      return 0;
    }
    const runOptions: RunTuiOptions = { repoRoot: getStrataPaths().repoRoot };
    if (options.initialSession !== undefined) {
      runOptions.initialSession = options.initialSession;
    }
    await runTui(runOptions);
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
  const parsed: Partial<NotionIngestOptions> = { dryRun: false, index: false };
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
    } else if (arg === "--index") {
      parsed.index = true;
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
    index: parsed.index ?? false,
  };
}

function parseGranolaIngestOptions(args: string[]): GranolaIngestOptions {
  const parsed: GranolaIngestOptions = { dryRun: false, index: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--since") {
      parsed.since = requireArgValue(args[++index], "--since requires a value");
    } else if (arg === "--fixture") {
      parsed.fixture = requireArgValue(args[++index], "--fixture requires a value");
    } else if (arg === "--meetings-url") {
      parsed.meetingsUrl = requireArgValue(args[++index], "--meetings-url requires a value");
    } else if (arg === "--page-size") {
      parsed.pageSize = requireArgValue(args[++index], "--page-size requires a value");
    } else if (arg === "--max-pages") {
      parsed.maxPages = requireArgValue(args[++index], "--max-pages requires a value");
    } else if (arg === "--transcript-url-template") {
      parsed.transcriptUrlTemplate = requireArgValue(
        args[++index],
        "--transcript-url-template requires a value",
      );
    } else if (arg === "--index") {
      parsed.index = true;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown ingest granola argument: ${arg}`);
    }
  }
  return parsed;
}

function parseGranolaProposalOptions(args: string[]): GranolaProposalOptions {
  const parsed: GranolaProposalOptions = { rawPaths: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--raw-path") {
      parsed.rawPaths.push(requireArgValue(args[++index], "--raw-path requires a value"));
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveIntegerArg(args[++index], "--limit requires a positive integer");
    } else {
      throw new Error(`Unknown ingest granola propose argument: ${arg}`);
    }
  }
  return parsed;
}

function parseGranolaIndexOptions(args: string[]): GranolaIndexOptions {
  const parsed: GranolaIndexOptions = { rawPaths: [], dryRun: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--raw-path") {
      parsed.rawPaths.push(requireArgValue(args[++index], "--raw-path requires a value"));
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveIntegerArg(args[++index], "--limit requires a positive integer");
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown ingest granola index argument: ${arg}`);
    }
  }
  return parsed;
}

function parseRawIndexOptions(args: string[]): RawIndexOptions {
  const parsed: RawIndexOptions = { rawPaths: [], dryRun: false, source: "all" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--raw-path") {
      parsed.rawPaths.push(requireArgValue(args[++index], "--raw-path requires a value"));
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveIntegerArg(args[++index], "--limit requires a positive integer");
    } else if (arg === "--source") {
      parsed.source = parseRawToWikiSource(
        requireArgValue(args[++index], "--source requires a value"),
      );
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown ingest raw index argument: ${arg}`);
    }
  }
  return parsed;
}

function parseRawToWikiSource(value: string): RawToWikiSourceFilter {
  if (value === "all" || value === "granola" || value === "notion" || value === "slack") {
    return value;
  }
  throw new Error("--source must be one of: all, granola, notion, slack");
}

function parseWikiSearchIndexSource(value: string): WikiSearchIndexSource {
  if (value === "all" || value === "granola" || value === "notion" || value === "slack") {
    return value;
  }
  throw new Error("--source must be one of: all, granola, notion, slack");
}

function parseWikiSearchIndexRefreshOptions(args: string[]): WikiSearchIndexRefreshOptions {
  const parsed: WikiSearchIndexRefreshOptions = { source: "all", includeRaw: true };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--source") {
      parsed.source = parseWikiSearchIndexSource(
        requireArgValue(args[++index], "--source requires a value"),
      );
    } else if (arg === "--no-raw") {
      parsed.includeRaw = false;
    } else {
      throw new Error(`Unknown wiki search-index refresh argument: ${arg}`);
    }
  }
  return parsed;
}

function parseWikiCompactIndexOptions(args: string[]): WikiCompactIndexOptions {
  const parsed: WikiCompactIndexOptions = { dryRun: false };
  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else {
      throw new Error(`Unknown wiki compact-index argument: ${arg}`);
    }
  }
  return parsed;
}

function parseWikiArchiveGeneratedSlackThreadsOptions(
  args: string[],
): WikiArchiveGeneratedSlackThreadsOptions {
  const parsed: WikiArchiveGeneratedSlackThreadsOptions = { dryRun: false, rewriteLinks: true };
  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--no-rewrite-links") {
      parsed.rewriteLinks = false;
    } else {
      throw new Error(`Unknown wiki archive-generated-slack-threads argument: ${arg}`);
    }
  }
  return parsed;
}

function parseWikiSearchOptions(args: string[]): WikiSearchOptions {
  const parsed: WikiSearchOptions = { includeRaw: false, limit: 20, query: "" };
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--include-raw") {
      parsed.includeRaw = true;
    } else if (arg === "--limit") {
      parsed.limit = parsePositiveIntegerArg(args[++index], "--limit requires a positive integer");
    } else {
      rest.push(arg ?? "");
    }
  }
  parsed.query = rest.join(" ").trim();
  if (parsed.query === "") {
    throw new Error("wiki search requires a query");
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
  const parsed: SlackIngestOptions = { dryRun: false, index: false, mode };
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
    } else if (arg === "--index") {
      parsed.index = true;
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

function printRawToWikiResult(result: GranolaRawToWikiResult): void {
  console.log(`session: ${result.sessionId}`);
  console.log(`scanned: ${result.scanned}`);
  console.log(`proposals: ${result.proposals.length}`);
  for (const proposal of result.proposals) {
    console.log(`proposal: ${proposal.path}`);
  }
  for (const skipped of result.skipped) {
    console.log(`skipped: ${skipped.rawPath} (${skipped.reason})`);
  }
}

function printGranolaIndexResult(result: GranolaRawToWikiIndexResult): void {
  console.log(`index session: ${result.sessionId}`);
  console.log(`scanned: ${result.scanned}`);
  console.log(`${result.dryRun ? "would index" : "indexed"}: ${result.indexed.length}`);
  for (const item of result.indexed) {
    console.log(`${result.dryRun ? "would write" : "wrote"} ${item.meetingPath}`);
    if (item.peoplePaths.length > 0) {
      console.log(`  people: ${item.peoplePaths.length}`);
    }
    if (item.projectPaths.length > 0) {
      console.log(`  projects: ${item.projectPaths.length}`);
    }
    if (item.decisionPaths.length > 0) {
      console.log(`  decisions: ${item.decisionPaths.length}`);
    }
    if (item.threadPaths.length > 0) {
      console.log(`  threads: ${item.threadPaths.length}`);
    }
    if (item.actionCount > 0) {
      console.log(`  actions: ${item.actionCount}`);
    }
  }
  for (const skipped of result.skipped) {
    console.log(`skipped: ${skipped.rawPath} (${skipped.reason})`);
  }
}

function printRawIndexResult(result: RawToWikiIndexResult): void {
  console.log(`index session: ${result.sessionId}`);
  console.log(`scanned: ${result.scanned}`);
  console.log(`${result.dryRun ? "would index" : "indexed"}: ${result.indexed.length}`);
  for (const item of result.indexed) {
    console.log(
      `${result.dryRun ? "would write" : "wrote"} ${item.primaryKind} ${item.primaryPath}`,
    );
    console.log(`  source: ${item.source}`);
    if (item.peoplePaths.length > 0) {
      console.log(`  people: ${item.peoplePaths.length}`);
    }
    if (item.projectPaths.length > 0) {
      console.log(`  projects: ${item.projectPaths.length}`);
    }
    if (item.decisionPaths.length > 0) {
      console.log(`  decisions: ${item.decisionPaths.length}`);
    }
    if (item.threadPaths.length > 0) {
      console.log(`  threads: ${item.threadPaths.length}`);
    }
    if (item.actionCount > 0) {
      console.log(`  actions: ${item.actionCount}`);
    }
  }
  for (const skipped of result.skipped) {
    console.log(`skipped: ${skipped.rawPath} (${skipped.reason})`);
  }
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
