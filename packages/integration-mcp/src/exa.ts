import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JsonObject, JsonValue } from "@strata/core/types";
import type { ToolDefinition, ToolPack, ToolPackContext, ToolRegistry } from "@strata/tools";
import {
  DEFAULT_EXA_MCP_TOOLS,
  DEFAULT_EXA_MCP_URL,
  EXA_MCP_SLUG,
  getExaMcpConfig,
  listMcpServerConfigs,
  type McpServerConfig,
} from "./config.js";

const MCP_TOOL_PREFIX = "mcp";

export interface ExaMcpToolPackOptions {
  enabled?: boolean;
  serverUrl?: string;
  tools?: readonly string[];
  requireConfigured?: boolean;
  maxResultChars?: number;
  fetchImpl?: typeof fetch;
}

export interface ConfiguredMcpToolPackOptions {
  maxResultChars?: number;
  fetchImpl?: typeof fetch;
}

export interface McpRemoteToolSummary {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

interface McpClientOptions {
  serverUrl: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export function createConfiguredMcpToolPack(options: ConfiguredMcpToolPackOptions = {}): ToolPack {
  return {
    name: "configured-mcp",
    async register(registry: ToolRegistry, context: ToolPackContext): Promise<void> {
      for (const server of await listMcpServerConfigs(context.repoRoot)) {
        if (!server.enabled) {
          continue;
        }
        await registerMcpServerTools(registry, server, cleanToolPackOptions(options));
      }
    },
  };
}

export function createExaMcpToolPack(options: ExaMcpToolPackOptions = {}): ToolPack {
  return {
    name: "exa-mcp",
    async register(registry: ToolRegistry, context: ToolPackContext): Promise<void> {
      if (options.enabled === false || !exaMcpEnabled(context.env)) {
        return;
      }
      const config = await getExaMcpConfig(context.repoRoot);
      if (options.requireConfigured !== false && config?.enabled !== true) {
        return;
      }
      const server: McpServerConfig = {
        slug: EXA_MCP_SLUG,
        displayName: "Exa",
        serverUrl:
          options.serverUrl ??
          context.env.STRATA_EXA_MCP_URL ??
          config?.serverUrl ??
          DEFAULT_EXA_MCP_URL,
        enabled: true,
        selectedTools: [...(options.tools ?? config?.selectedTools ?? DEFAULT_EXA_MCP_TOOLS)],
        updatedAt: new Date(0).toISOString(),
        ...headersFromExaConfig(context.env, config),
      };
      await registerMcpServerTools(registry, server, cleanToolPackOptions(options));
    },
  };
}

export async function listExaMcpTools(
  options: McpClientOptions = { serverUrl: DEFAULT_EXA_MCP_URL },
): Promise<McpRemoteToolSummary[]> {
  return listRemoteMcpTools(options);
}

export async function listRemoteMcpTools(
  options: McpClientOptions,
): Promise<McpRemoteToolSummary[]> {
  return withMcpClient(options, async (client) => {
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema as JsonObject,
    }));
  });
}

async function registerMcpServerTools(
  registry: ToolRegistry,
  server: McpServerConfig,
  options: ConfiguredMcpToolPackOptions,
): Promise<void> {
  const remoteTools = await listRemoteMcpTools({
    serverUrl: server.serverUrl,
    ...(server.headers === undefined ? {} : { headers: server.headers }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  const allowed = new Set(server.selectedTools);
  for (const remoteTool of remoteTools) {
    if (allowed.size > 0 && !allowed.has(remoteTool.name)) {
      continue;
    }
    registry.register(mcpToolDefinition(remoteTool, server, cleanToolPackOptions(options)));
  }
}

function cleanToolPackOptions(options: ConfiguredMcpToolPackOptions): ConfiguredMcpToolPackOptions {
  return {
    ...(options.maxResultChars === undefined ? {} : { maxResultChars: options.maxResultChars }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  };
}

function mcpToolDefinition(
  remoteTool: McpRemoteToolSummary,
  server: McpServerConfig,
  options: ConfiguredMcpToolPackOptions,
): ToolDefinition {
  return {
    name: strataToolName(server.slug, remoteTool.name),
    description: `[${server.displayName} MCP] ${remoteTool.description}`,
    mode: "read",
    inputSchema: remoteTool.inputSchema,
    maxResultChars: options.maxResultChars ?? 80_000,
    handler: async (args) => {
      return withMcpClient(
        {
          serverUrl: server.serverUrl,
          ...(server.headers === undefined ? {} : { headers: server.headers }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        },
        async (client) => {
          const result = await client.callTool({ name: remoteTool.name, arguments: args });
          return normalizeMcpToolResult(result);
        },
      );
    },
  };
}

function normalizeMcpToolResult(result: unknown): JsonObject {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return { toolResult: toJsonValue(result) };
  }
  const raw = result as Record<string, unknown>;
  const out: JsonObject = {};
  if (Array.isArray(raw.content)) {
    out.content = raw.content.map(toJsonValue) as JsonValue[];
  }
  if (typeof raw.structuredContent === "object" && raw.structuredContent !== null) {
    out.structuredContent = toJsonValue(raw.structuredContent);
  }
  if (typeof raw.isError === "boolean") {
    out.isError = raw.isError;
  }
  if (raw.toolResult !== undefined) {
    out.toolResult = toJsonValue(raw.toolResult);
  }
  return Object.keys(out).length === 0 ? { result: toJsonValue(result) } : out;
}

async function withMcpClient<T>(
  options: McpClientOptions,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: "strata", version: "0.1.0" }, { capabilities: {} });
  const init = requestInit(options);
  const transport = new StreamableHTTPClientTransport(new URL(options.serverUrl), {
    ...(init === undefined ? {} : { requestInit: init }),
    ...(options.fetchImpl === undefined ? {} : { fetch: options.fetchImpl as FetchLike }),
  });

  try {
    await client.connect(transport as unknown as Transport);
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function requestInit(options: McpClientOptions): RequestInit | undefined {
  if (options.headers === undefined || Object.keys(options.headers).length === 0) {
    return undefined;
  }
  return { headers: options.headers };
}

function headersFromExaConfig(
  env: Record<string, string | undefined>,
  config: McpServerConfig | null,
): { headers?: Record<string, string> } {
  const apiKey = env.EXA_API_KEY ?? env.STRATA_EXA_API_KEY ?? config?.headers?.["x-api-key"];
  return apiKey === undefined || apiKey.trim() === "" ? {} : { headers: { "x-api-key": apiKey } };
}

function exaMcpEnabled(env: Record<string, string | undefined>): boolean {
  const raw = env.STRATA_EXA_MCP_ENABLED;
  if (raw === undefined) {
    return true;
  }
  return !["0", "false", "no", "off"].includes(raw.trim().toLowerCase());
}

function strataToolName(serverSlug: string, remoteName: string): string {
  const normalizedRemoteName =
    serverSlug === EXA_MCP_SLUG && remoteName.endsWith("_exa")
      ? remoteName.slice(0, -"_exa".length)
      : remoteName;
  return `${MCP_TOOL_PREFIX}.${identifierSegment(serverSlug)}.${identifierSegment(normalizedRemoteName)}`;
}

function identifierSegment(value: string): string {
  const words = value
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.trim())
    .filter((word) => word !== "");
  const camel = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`,
    )
    .join("");
  return /^[a-z]/.test(camel) ? camel : "tool";
}

function toJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }
  if (typeof value === "object" && value !== null) {
    const out: JsonObject = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = toJsonValue(nested);
    }
    return out;
  }
  return String(value);
}
