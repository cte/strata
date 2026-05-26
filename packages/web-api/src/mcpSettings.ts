import {
  deleteMcpServerConfig,
  listMcpServerConfigs,
  listRemoteMcpTools,
  type SafeMcpServerConfig,
  toSafeMcpServerConfig,
  updateMcpServerConfig,
} from "@strata/integration-mcp";
import { runtime, type WebApiOptions } from "./runtime.js";

export interface McpServerStatus extends SafeMcpServerConfig {
  state: "enabled" | "disabled";
  message: string;
}

export interface McpSettingsStatus {
  servers: McpServerStatus[];
}

export interface McpToolSummary {
  name: string;
  description: string;
}

export interface McpUpdateInput {
  slug: string;
  displayName?: string | undefined;
  enabled?: boolean | undefined;
  serverUrl?: string | undefined;
  selectedTools?: string[] | undefined;
  apiKey?: string | undefined;
  clearApiKey?: boolean | undefined;
}

export interface McpDeleteInput {
  slug: string;
}

export async function getMcpSettingsStatus(
  options: WebApiOptions = {},
): Promise<McpSettingsStatus> {
  const rt = runtime(options);
  return {
    servers: (await listMcpServerConfigs(rt.repoRoot)).map(toSafeMcpServerConfig).map(toStatus),
  };
}

export async function updateMcpSettings(
  input: McpUpdateInput,
  options: WebApiOptions = {},
): Promise<McpSettingsStatus> {
  const rt = runtime(options);
  await updateMcpServerConfig(cleanUpdateInput(input, rt.repoRoot, options.now));
  return getMcpSettingsStatus(options);
}

export async function deleteMcpSettings(
  input: McpDeleteInput,
  options: WebApiOptions = {},
): Promise<McpSettingsStatus> {
  await deleteMcpServerConfig(input.slug, runtime(options).repoRoot);
  return getMcpSettingsStatus(options);
}

export async function listMcpTools(
  input: { slug: string; serverUrl?: string | undefined },
  options: WebApiOptions = {},
): Promise<{ tools: McpToolSummary[] }> {
  const rt = runtime(options);
  const config = (await listMcpServerConfigs(rt.repoRoot)).find(
    (server) => server.slug === input.slug,
  );
  const serverUrl = input.serverUrl ?? config?.serverUrl;
  if (serverUrl === undefined) {
    throw new Error("MCP server URL is required before listing tools.");
  }
  const tools = await listRemoteMcpTools({
    serverUrl,
    ...(config?.headers === undefined ? {} : { headers: config.headers }),
    ...(rt.fetchImpl === undefined ? {} : { fetchImpl: rt.fetchImpl }),
  });
  return {
    tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
  };
}

function cleanUpdateInput(input: McpUpdateInput, repoRoot: string, now: Date | undefined) {
  return {
    repoRoot,
    slug: input.slug,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.serverUrl === undefined ? {} : { serverUrl: input.serverUrl }),
    ...(input.selectedTools === undefined ? {} : { selectedTools: input.selectedTools }),
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.clearApiKey === undefined ? {} : { clearApiKey: input.clearApiKey }),
    ...(now === undefined ? {} : { now }),
  };
}

function toStatus(config: SafeMcpServerConfig): McpServerStatus {
  return {
    ...config,
    state: config.enabled ? "enabled" : "disabled",
    message: config.enabled
      ? `${config.displayName} MCP tools are enabled.`
      : `${config.displayName} MCP tools are disabled.`,
  };
}
