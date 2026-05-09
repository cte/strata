import { getStrataPaths } from "@strata/core";
import {
  type ConnectorCapability,
  type ConnectorName,
  type ConnectorStatus,
  connectorErrorStatus,
  getConnectorDefinition,
  runConnectorOperation,
} from "@strata/ingest/connectors";
import {
  configureGranola,
  disconnectGranola,
  getGranolaStatus,
  hasGranolaCredentialsSync,
} from "@strata/ingest/granola-connector";
import { type NotionConnectorConfig, notionConnector } from "@strata/ingest/notion-connector";
import {
  disconnectNotionMcp,
  getNotionMcpStatus,
  hasNotionMcpAuthSync,
  listNotionMcpTools,
  startNotionMcpAuth,
} from "./notionMcp.js";
import type {
  ConnectorSessionResult,
  ConnectorSummary,
  GranolaConfigureRpcInput,
  NotionConnectorInput,
  NotionMcpStartInput,
  WebApiServices,
} from "./trpc.js";

export interface WebApiOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export function createWebApiServices(options: WebApiOptions = {}): WebApiServices {
  return {
    health: () => ({
      ok: true,
      repoRoot: repoRoot(options),
    }),
    connectorSummaries: () => connectorSummaries(options),
    validateNotion: (config) => validateNotion(config, options),
    runNotionSession: (operation, config) => runNotionSession(operation, config, options),
    notionMcpStatus: () => getNotionMcpStatus(options),
    startNotionMcp: (input) => startNotionMcp(input, options),
    listNotionMcpTools: async () => ({ tools: await listNotionMcpTools(options) }),
    disconnectNotionMcp: () => disconnectNotionMcp(options),
    granolaStatus: () => getGranolaStatus(options),
    configureGranola: (input: GranolaConfigureRpcInput) => configureGranola(input, options),
    disconnectGranola: () => disconnectGranola(options),
  };
}

export function connectorSummaries(options: WebApiOptions): ConnectorSummary[] {
  const env = runtimeEnv(options);
  const notionTokenConfigured = Boolean(env.NOTION_TOKEN);
  const notionMcpConfigured = hasNotionMcpAuthSync(options);
  const notionDefinition = requiredConnectorDefinition("notion");
  const granolaDefinition = requiredConnectorDefinition("granola");
  const slackDefinition = requiredConnectorDefinition("slack");
  return [
    {
      name: "notion",
      displayName: notionDefinition.displayName,
      description: notionDefinition.description,
      state: notionTokenConfigured || notionMcpConfigured ? "ready" : "not_configured",
      configured: notionTokenConfigured || notionMcpConfigured,
      message: notionMcpConfigured
        ? "Notion MCP connected. Page snapshots still use the Notion API connector."
        : notionTokenConfigured
          ? "Token configured. Provide a page ID or URL to validate access."
          : "Connect Notion MCP or set NOTION_TOKEN in .env to enable Notion.",
      capabilities: mergeCapabilities(notionDefinition.capabilities, ["mcp_auth", "mcp_tools"]),
    },
    granolaSummary(granolaDefinition, env, options),
    slackSummary(slackDefinition, env),
  ];
}

export function startNotionMcp(input: NotionMcpStartInput, options: WebApiOptions) {
  return startNotionMcpAuth(input.origin, options);
}

export async function validateNotion(
  config: NotionConnectorInput,
  options: WebApiOptions,
): Promise<ConnectorStatus> {
  try {
    return await notionConnector.validate(notionConfig(config), runtime(options));
  } catch (error: unknown) {
    return connectorErrorStatus("notion", error);
  }
}

export async function runNotionSession(
  operation: "dry_run" | "pull",
  config: NotionConnectorInput,
  options: WebApiOptions,
): Promise<ConnectorSessionResult> {
  return runConnectorOperation({
    name: "notion",
    operation,
    config: notionConfig(config),
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    title: `${operation === "dry_run" ? "Dry-run" : "Pull"} Notion page ${
      config.pageId.trim() || "unknown"
    }`,
  });
}

export function runtime(options: WebApiOptions) {
  return {
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

export function runtimeEnv(options: WebApiOptions): Record<string, string | undefined> {
  return options.env ?? Bun.env;
}

export function repoRoot(options: WebApiOptions): string {
  return getStrataPaths(options.repoRoot).repoRoot;
}

function slackSummary(
  definition: ReturnType<typeof requiredConnectorDefinition>,
  env: Record<string, string | undefined>,
): ConnectorSummary {
  const configured = Boolean(env.SLACK_USER_TOKEN || env.SLACK_BOT_TOKEN);
  const tokenMode = env.SLACK_USER_TOKEN ? "user" : env.SLACK_BOT_TOKEN ? "bot" : "none";
  return {
    name: "slack",
    displayName: definition.displayName,
    description: definition.description,
    state: configured ? "ready" : "not_configured",
    configured,
    message: configured
      ? tokenMode === "user"
        ? "Slack user token configured. Strata can run checkpointed sync for accessible conversations."
        : "Slack bot token configured. Strata can run checkpointed sync for bot-accessible conversations."
      : "Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN to enable Slack sync.",
    capabilities: [...definition.capabilities],
  };
}

function granolaSummary(
  definition: ReturnType<typeof requiredConnectorDefinition>,
  env: Record<string, string | undefined>,
  options: WebApiOptions,
): ConnectorSummary {
  const persisted = hasGranolaCredentialsSync(options);
  const envConfigured = Boolean(env.GRANOLA_API_TOKEN);
  const configured = persisted || envConfigured;
  return {
    name: "granola",
    displayName: definition.displayName,
    description: definition.description,
    state: configured ? "ready" : "not_configured",
    configured,
    message: persisted
      ? "Granola API key saved locally. Strata can pull meeting transcripts on demand."
      : envConfigured
        ? "Granola API token is loaded from the GRANOLA_API_TOKEN environment variable."
        : "Granola is not connected. Paste a personal API key to configure.",
    capabilities: [...definition.capabilities],
  };
}

function notionConfig(input: NotionConnectorInput): NotionConnectorConfig {
  return {
    pageId: input.pageId,
    ...(input.token === undefined ? {} : { token: input.token }),
    ...(input.version === undefined ? {} : { version: input.version }),
  };
}

function requiredConnectorDefinition(name: ConnectorName) {
  const definition = getConnectorDefinition(name);
  if (definition === undefined) {
    throw new Error(`Missing connector definition: ${name}`);
  }
  return definition;
}

function mergeCapabilities(
  first: readonly ConnectorCapability[],
  second: readonly ConnectorCapability[],
): ConnectorCapability[] {
  return [...new Set([...first, ...second])];
}
