import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrataPaths } from "@strata/core";

export const EXA_MCP_SLUG = "exa" as const;
export const EXA_MCP_DISPLAY_NAME = "Exa";
export const DEFAULT_EXA_MCP_URL = "https://mcp.exa.ai/mcp";
export const DEFAULT_EXA_MCP_TOOLS = ["web_search_exa", "web_fetch_exa"] as const;

export interface McpServerConfig {
  slug: string;
  displayName: string;
  serverUrl: string;
  enabled: boolean;
  selectedTools: string[];
  headers?: Record<string, string>;
  updatedAt: string;
}

export interface McpServerConfigStore {
  version: 1;
  servers: McpServerConfig[];
}

export interface SafeMcpServerConfig {
  slug: string;
  displayName: string;
  serverUrl: string;
  enabled: boolean;
  selectedTools: string[];
  headerNames: string[];
  apiKeyConfigured: boolean;
  updatedAt?: string;
}

export interface McpServerUpdateInput {
  repoRoot?: string;
  slug: string;
  displayName?: string;
  serverUrl?: string;
  enabled?: boolean;
  selectedTools?: string[];
  apiKey?: string;
  clearApiKey?: boolean;
  headers?: Record<string, string>;
  clearHeaders?: string[];
  now?: Date;
}

export function getMcpConfigPath(repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "secrets", "mcp-servers.json");
}

export async function readMcpConfigStore(repoRoot?: string): Promise<McpServerConfigStore> {
  const file = getMcpConfigPath(repoRoot);
  if (!existsSync(file)) {
    return emptyStore();
  }
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isMcpServerConfigStore(parsed)) {
    throw new Error(`Invalid MCP server config store: ${file}`);
  }
  return parsed;
}

export async function writeMcpConfigStore(
  store: McpServerConfigStore,
  repoRoot?: string,
): Promise<void> {
  const file = getMcpConfigPath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await chmod(file, 0o600);
}

export async function listMcpServerConfigs(repoRoot?: string): Promise<McpServerConfig[]> {
  const store = await readMcpConfigStore(repoRoot);
  const hasExa = store.servers.some((server) => server.slug === EXA_MCP_SLUG);
  return hasExa ? store.servers : [defaultExaConfig(), ...store.servers];
}

export async function listSafeMcpServerConfigs(repoRoot?: string): Promise<SafeMcpServerConfig[]> {
  return (await listMcpServerConfigs(repoRoot)).map(toSafeMcpServerConfig);
}

export async function getMcpServerConfig(
  slug: string,
  repoRoot?: string,
): Promise<McpServerConfig | null> {
  const store = await readMcpConfigStore(repoRoot);
  return store.servers.find((server) => server.slug === slug) ?? null;
}

export async function updateMcpServerConfig(
  input: McpServerUpdateInput,
): Promise<SafeMcpServerConfig> {
  const slug = sanitizeSlug(input.slug);
  const store = await readMcpConfigStore(input.repoRoot);
  const previous = store.servers.find((server) => server.slug === slug);
  const serverUrl = sanitizeServerUrl(
    input.serverUrl ?? previous?.serverUrl ?? defaultServerUrl(slug),
  );
  const previousHeaders = previous?.headers ?? {};
  const headers = mergeHeaders({
    previous: previousHeaders,
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.clearApiKey === undefined ? {} : { clearApiKey: input.clearApiKey }),
    ...(input.headers === undefined ? {} : { headers: input.headers }),
    ...(input.clearHeaders === undefined ? {} : { clearHeaders: input.clearHeaders }),
  });

  const next: McpServerConfig = {
    slug,
    displayName: sanitizeDisplayName(
      input.displayName ?? previous?.displayName ?? defaultDisplayName(slug),
    ),
    serverUrl,
    enabled: input.enabled ?? previous?.enabled ?? false,
    selectedTools: sanitizeSelectedTools(
      input.selectedTools ?? previous?.selectedTools ?? defaultTools(slug),
    ),
    updatedAt: (input.now ?? new Date()).toISOString(),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
  };

  const servers = store.servers.filter((server) => server.slug !== slug);
  servers.push(next);
  await writeMcpConfigStore({ version: 1, servers: sortServers(servers) }, input.repoRoot);
  return toSafeMcpServerConfig(next);
}

export async function deleteMcpServerConfig(slugParam: string, repoRoot?: string): Promise<void> {
  const slug = sanitizeSlug(slugParam);
  const store = await readMcpConfigStore(repoRoot);
  await writeMcpConfigStore(
    { version: 1, servers: store.servers.filter((server) => server.slug !== slug) },
    repoRoot,
  );
}

export function toSafeMcpServerConfig(config: McpServerConfig): SafeMcpServerConfig {
  const headers = config.headers ?? {};
  return {
    slug: config.slug,
    displayName: config.displayName,
    serverUrl: config.serverUrl,
    enabled: config.enabled,
    selectedTools: config.selectedTools,
    headerNames: Object.keys(headers).sort(),
    apiKeyConfigured: headers["x-api-key"] !== undefined && headers["x-api-key"].trim() !== "",
    ...(config.updatedAt === undefined ? {} : { updatedAt: config.updatedAt }),
  };
}

export async function getExaMcpConfig(repoRoot?: string): Promise<McpServerConfig | null> {
  return getMcpServerConfig(EXA_MCP_SLUG, repoRoot);
}

export async function getSafeExaMcpConfig(repoRoot?: string): Promise<SafeMcpServerConfig> {
  return toSafeMcpServerConfig((await getExaMcpConfig(repoRoot)) ?? defaultExaConfig());
}

export async function updateExaMcpConfig(
  input: Omit<McpServerUpdateInput, "slug" | "displayName">,
): Promise<SafeMcpServerConfig> {
  return updateMcpServerConfig({ ...input, slug: EXA_MCP_SLUG, displayName: EXA_MCP_DISPLAY_NAME });
}

function defaultExaConfig(): McpServerConfig {
  return {
    slug: EXA_MCP_SLUG,
    displayName: EXA_MCP_DISPLAY_NAME,
    serverUrl: DEFAULT_EXA_MCP_URL,
    enabled: false,
    selectedTools: [...DEFAULT_EXA_MCP_TOOLS],
    updatedAt: new Date(0).toISOString(),
  };
}

function emptyStore(): McpServerConfigStore {
  return { version: 1, servers: [] };
}

function sortServers(servers: McpServerConfig[]): McpServerConfig[] {
  return [...servers].sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function defaultServerUrl(slug: string): string {
  if (slug === EXA_MCP_SLUG) {
    return DEFAULT_EXA_MCP_URL;
  }
  throw new Error("Server URL is required for new MCP servers.");
}

function defaultDisplayName(slug: string): string {
  return slug === EXA_MCP_SLUG ? EXA_MCP_DISPLAY_NAME : titleFromSlug(slug);
}

function defaultTools(slug: string): string[] {
  return slug === EXA_MCP_SLUG ? [...DEFAULT_EXA_MCP_TOOLS] : [];
}

function mergeHeaders(input: {
  previous: Record<string, string>;
  apiKey?: string;
  clearApiKey?: boolean;
  headers?: Record<string, string>;
  clearHeaders?: string[];
}): Record<string, string> {
  const headers: Record<string, string> = { ...input.previous };
  for (const key of input.clearHeaders ?? []) {
    delete headers[normalizeHeaderName(key)];
  }
  if (input.clearApiKey === true) {
    delete headers["x-api-key"];
  }
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    const normalized = normalizeHeaderName(key);
    const secret = sanitizeOptionalSecret(value);
    if (secret === undefined) {
      delete headers[normalized];
    } else {
      headers[normalized] = secret;
    }
  }
  const apiKey = sanitizeOptionalSecret(input.apiKey);
  if (apiKey !== undefined) {
    headers["x-api-key"] = apiKey;
  }
  return headers;
}

function sanitizeServerUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported MCP server URL protocol: ${url.protocol}`);
  }
  return url.toString();
}

function sanitizeSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error(
      "MCP server slug must start with a letter and contain letters, numbers, or dashes.",
    );
  }
  return slug;
}

function sanitizeDisplayName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("MCP server display name is required.");
  }
  return trimmed.slice(0, 80);
}

function sanitizeSelectedTools(value: string[] | readonly string[] | undefined): string[] {
  const tools = value?.map((tool) => tool.trim()).filter((tool) => tool !== "") ?? [];
  return [...new Set(tools)];
}

function sanitizeOptionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function normalizeHeaderName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(normalized)) {
    throw new Error(`Invalid MCP header name: ${value}`);
  }
  return normalized;
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter((part) => part !== "")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function isMcpServerConfigStore(value: unknown): value is McpServerConfigStore {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<McpServerConfigStore>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.servers) &&
    candidate.servers.every(isMcpServerConfig)
  );
}

function isMcpServerConfig(value: unknown): value is McpServerConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<McpServerConfig>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.displayName === "string" &&
    typeof candidate.serverUrl === "string" &&
    typeof candidate.enabled === "boolean" &&
    Array.isArray(candidate.selectedTools) &&
    candidate.selectedTools.every((tool) => typeof tool === "string") &&
    (candidate.headers === undefined || isStringRecord(candidate.headers)) &&
    typeof candidate.updatedAt === "string"
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((nested) => typeof nested === "string");
}
