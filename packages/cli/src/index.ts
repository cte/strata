#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import process from "node:process";
import {
  clearChatGptCredentials,
  getChatGptCredentials,
  getValidChatGptCredentials,
  loginChatGpt,
  OpenAICodexModelAdapter,
  OpenAICompatibleChatModelAdapter,
  runAgentLoop,
  setChatGptCredentials,
} from "@cortex/agent";
import { ensureRuntimeDirs, getCortexPaths, SessionStore, type SessionRecord } from "@cortex/core";
import { createDefaultToolRegistry, type ToolProfile } from "@cortex/tools";
import { runTui } from "@cortex/tui";

type CommandResult = number;

function usage(): string {
  return `usage: cortex <command>

commands:
  auth status                  show configured model auth without exposing tokens
  auth login openai-codex      sign in with ChatGPT for Codex model access
  auth logout openai-codex     remove stored ChatGPT credentials
  init                         initialize .cortex runtime directories
  query [options] <question>   run an agent query using the default dangerous tool profile
  tui                          launch the interactive Cortex TUI
  trace <title>                write a dummy trace session for harness smoke tests
  sessions list [--limit N]    list recent sessions
  sessions search <query>      search sessions using the current simple index
  tools list [--profile P]     list registered harness tools
  tools call [--profile P] <name> [json]
`;
}

type ProviderName = "openai-codex" | "openai-compatible";

interface QueryOptions {
  provider?: ProviderName;
  model?: string;
  question: string;
}

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
  const paths = getCortexPaths();
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
    repoRoot: getCortexPaths().repoRoot,
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

async function cmdAuth(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`usage: cortex auth <status|login|logout> [openai-codex]`);
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
    const apiKeyConfigured = Boolean(Bun.env.CORTEX_API_KEY ?? Bun.env.OPENAI_API_KEY);
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
    console.log(`usage: cortex sessions <list|search>`);
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

async function cmdTools(args: string[]): Promise<CommandResult> {
  const subcommand = args.shift();

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(
      `usage: cortex tools <list|call> [--profile read-only|maintenance|learning|dangerous]`,
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
      repoRoot: getCortexPaths().repoRoot,
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
  if (command === "query") {
    return cmdQuery(argv);
  }
  if (command === "tui") {
    await runTui({ repoRoot: getCortexPaths().repoRoot });
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

async function createModelAdapter(
  options: QueryOptions,
): Promise<OpenAICodexModelAdapter | OpenAICompatibleChatModelAdapter> {
  const provider =
    options.provider ??
    parseProviderName(Bun.env.CORTEX_PROVIDER) ??
    (await inferDefaultProvider());
  if (provider === "openai-codex") {
    const credentials = await getValidChatGptCredentials();
    const codexOptions = {
      credentials,
      model: options.model ?? Bun.env.CORTEX_MODEL ?? "gpt-5.5",
    };
    if (Bun.env.CORTEX_CODEX_BASE_URL !== undefined) {
      return new OpenAICodexModelAdapter({
        ...codexOptions,
        baseUrl: Bun.env.CORTEX_CODEX_BASE_URL,
      });
    }
    return new OpenAICodexModelAdapter(codexOptions);
  }
  return createOpenAICompatibleAdapter(options);
}

async function inferDefaultProvider(): Promise<ProviderName> {
  if ((await getChatGptCredentials()) !== undefined) {
    return "openai-codex";
  }
  if (Bun.env.CORTEX_API_KEY !== undefined || Bun.env.OPENAI_API_KEY !== undefined) {
    return "openai-compatible";
  }
  return "openai-codex";
}

function parseProviderName(value: string | undefined): ProviderName | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "openai-codex" || value === "openai-compatible") {
    return value;
  }
  throw new Error("CORTEX_PROVIDER must be openai-codex or openai-compatible");
}

function createOpenAICompatibleAdapter(options: QueryOptions): OpenAICompatibleChatModelAdapter {
  const apiKey = Bun.env.CORTEX_API_KEY ?? Bun.env.OPENAI_API_KEY;
  const model = options.model ?? Bun.env.CORTEX_MODEL ?? Bun.env.OPENAI_MODEL;
  const baseUrl = Bun.env.CORTEX_BASE_URL ?? Bun.env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("Missing model API key. Set CORTEX_API_KEY or OPENAI_API_KEY.");
  }
  if (!model) {
    throw new Error("Missing model name. Set CORTEX_MODEL or OPENAI_MODEL.");
  }

  const adapterOptions = {
    apiKey,
    model,
  };
  if (baseUrl !== undefined) {
    return new OpenAICompatibleChatModelAdapter({
      ...adapterOptions,
      baseUrl,
    });
  }
  return new OpenAICompatibleChatModelAdapter(adapterOptions);
}
