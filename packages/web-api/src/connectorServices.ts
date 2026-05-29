import {
  type ConnectorCapability,
  type ConnectorConfig,
  type ConnectorConfigProfileRecord,
  type ConnectorName,
  type ConnectorStatus,
  connectorErrorStatus,
  getConnectorDefinition,
  listConnectorConfigProfiles,
  readDefaultConnectorConfigProfile,
  deleteConnectorConfigProfile as removeConnectorConfigProfile,
  runConnectorOperation,
  runConnectorWorkflow,
  setDefaultConnectorConfigProfile as setDefaultConnectorProfile,
  writeConnectorConfigProfile,
} from "@strata/ingest/connectors";
import { hasGranolaCredentialsSync } from "@strata/ingest/granola-connector";
import { type NotionConnectorConfig, notionConnector } from "@strata/ingest/notion-connector";
import { hasNotionMcpAuthSync, startNotionMcpAuth } from "./notionMcp.js";
import { repoRoot, runtime, runtimeEnv, type WebApiOptions } from "./runtime.js";
import type {
  ConnectorConfigProfileIdRpcInput,
  ConnectorConfigProfileSaveRpcInput,
  ConnectorConfigProfilesResult,
  ConnectorConfigProfilesRpcInput,
  ConnectorRunResult,
  ConnectorRunRpcInput,
  ConnectorSessionResult,
  ConnectorSummary,
  NotionConnectorInput,
  NotionMcpStartInput,
} from "./trpc.js";

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

export async function runConnectorSession(
  input: ConnectorRunRpcInput,
  options: WebApiOptions,
): Promise<ConnectorRunResult> {
  return runConnectorWorkflow({
    connector: input.connector,
    operation: input.operation,
    config: connectorConfig(input.config),
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    ...(input.configProfileId === undefined ? {} : { configProfileId: input.configProfileId }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(input.lookbackMinutes === undefined ? {} : { lookbackMinutes: input.lookbackMinutes }),
    index: input.index,
    refreshSearchIndex: input.refreshSearchIndex,
    title: input.title ?? defaultConnectorRunTitle(input),
  });
}

export async function listConnectorConfigProfilesForWeb(
  input: ConnectorConfigProfilesRpcInput,
  options: WebApiOptions,
): Promise<ConnectorConfigProfilesResult> {
  return connectorConfigProfilesResult(input.connector, options);
}

export async function saveConnectorConfigProfileForWeb(
  input: ConnectorConfigProfileSaveRpcInput,
  options: WebApiOptions,
): Promise<ConnectorConfigProfilesResult> {
  await writeConnectorConfigProfile({
    connector: input.connector,
    config: connectorConfig(input.config),
    repoRoot: repoRoot(options),
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.label === undefined ? {} : { label: input.label }),
    makeDefault: input.makeDefault,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return connectorConfigProfilesResult(input.connector, options);
}

export async function deleteConnectorConfigProfileForWeb(
  input: ConnectorConfigProfileIdRpcInput,
  options: WebApiOptions,
): Promise<ConnectorConfigProfilesResult> {
  await removeConnectorConfigProfile({
    connector: input.connector,
    id: input.id,
    repoRoot: repoRoot(options),
  });
  return connectorConfigProfilesResult(input.connector, options);
}

export async function setDefaultConnectorConfigProfileForWeb(
  input: ConnectorConfigProfileIdRpcInput,
  options: WebApiOptions,
): Promise<ConnectorConfigProfilesResult> {
  await setDefaultConnectorProfile({
    connector: input.connector,
    id: input.id,
    repoRoot: repoRoot(options),
  });
  return connectorConfigProfilesResult(input.connector, options);
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

function connectorConfig(input: ConnectorConfig): ConnectorConfig {
  return { ...input };
}

async function connectorConfigProfilesResult(
  connector: ConnectorName,
  options: WebApiOptions,
): Promise<ConnectorConfigProfilesResult> {
  const [profiles, defaultProfile] = await Promise.all([
    listConnectorConfigProfiles(connector, repoRoot(options)),
    readDefaultConnectorConfigProfile(connector, repoRoot(options)),
  ]);
  return {
    connector,
    profiles: profiles.map(profileForBrowser),
    defaultProfile: defaultProfile === null ? null : profileForBrowser(defaultProfile),
  };
}

function profileForBrowser(profile: ConnectorConfigProfileRecord): ConnectorConfigProfileRecord {
  return { ...profile, config: connectorConfig(profile.config) };
}

function defaultConnectorRunTitle(input: ConnectorRunRpcInput): string {
  const operation = input.operation === "dry_run" ? "Dry-run" : "Pull";
  return `${operation} ${input.connector}`;
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
