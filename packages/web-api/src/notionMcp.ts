import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getStrataPaths } from "@strata/core";
import { redactConnectorMessage } from "@strata/ingest/connectors";

const DEFAULT_NOTION_MCP_URL = "https://mcp.notion.com/mcp";
const FLOW_TTL_MS = 15 * 60 * 1000;

export interface NotionMcpOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface NotionMcpStatus {
  authenticated: boolean;
  state: "connected" | "not_connected" | "auth_pending" | "requires_reconnect";
  message: string;
  serverUrl: string;
  expiresAt?: string;
}

export interface NotionMcpStartResult {
  authenticated: boolean;
  authorizationUrl?: string;
  callbackUrl: string;
  message: string;
}

export interface NotionMcpCallbackResult {
  authenticated: boolean;
  message: string;
}

export interface NotionMcpToolSummary {
  name: string;
  description: string;
}

interface NotionMcpFlow {
  state: string;
  redirectUrl: string;
  createdAt: string;
  codeVerifier?: string;
}

interface StoredOAuthTokens extends OAuthTokens {
  savedAt: string;
  expiresAt?: string;
}

interface NotionMcpStoreData {
  version: 1;
  clientInformation?: OAuthClientInformationMixed;
  discoveryState?: OAuthDiscoveryState;
  flow?: NotionMcpFlow;
  tokens?: StoredOAuthTokens;
  updatedAt?: string;
}

export function getNotionMcpStorePath(repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "secrets", "notion-mcp.json");
}

export function hasNotionMcpAuthSync(options: NotionMcpOptions = {}): boolean {
  const file = getNotionMcpStorePath(options.repoRoot);
  if (!existsSync(file)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return (
      isStoreData(parsed) && Boolean(parsed.tokens?.refresh_token || parsed.tokens?.access_token)
    );
  } catch {
    return false;
  }
}

export async function getNotionMcpStatus(options: NotionMcpOptions = {}): Promise<NotionMcpStatus> {
  const data = await loadStore(options.repoRoot);
  const serverUrl = notionMcpServerUrl(options);
  if (data.tokens) {
    return {
      authenticated: true,
      state: "connected",
      message: data.tokens.refresh_token
        ? "Notion MCP is connected. Strata can refresh the access token when needed."
        : "Notion MCP has an access token but no refresh token; reconnect may be required soon.",
      serverUrl,
      ...(data.tokens.expiresAt === undefined ? {} : { expiresAt: data.tokens.expiresAt }),
    };
  }
  if (data.flow && !flowExpired(data.flow, options)) {
    return {
      authenticated: false,
      state: "auth_pending",
      message: "Notion MCP authorization is waiting for browser completion.",
      serverUrl,
    };
  }
  if (data.clientInformation) {
    return {
      authenticated: false,
      state: "requires_reconnect",
      message: "Notion MCP was registered locally but needs a fresh authorization.",
      serverUrl,
    };
  }
  return {
    authenticated: false,
    state: "not_connected",
    message: "Notion MCP is not connected.",
    serverUrl,
  };
}

export async function startNotionMcpAuth(
  origin: string | undefined,
  options: NotionMcpOptions = {},
): Promise<NotionMcpStartResult> {
  const callbackUrl = notionMcpCallbackUrl(origin, options);
  const state = randomToken();
  await updateStore(options.repoRoot, (data) => {
    data.flow = {
      state,
      redirectUrl: callbackUrl,
      createdAt: now(options).toISOString(),
    };
  });

  const provider = new FileNotionMcpOAuthProvider(options, callbackUrl, state);
  const result = await auth(provider, {
    serverUrl: notionMcpServerUrl(options),
    resourceMetadataUrl: notionMcpResourceMetadataUrl(options),
    ...authFetchOption(options),
  });

  if (result === "AUTHORIZED") {
    return {
      authenticated: true,
      callbackUrl,
      message: "Notion MCP is already connected.",
    };
  }

  const authorizationUrl = provider.authorizationUrl;
  if (!authorizationUrl) {
    throw new Error("Notion MCP authorization did not return a redirect URL.");
  }
  return {
    authenticated: false,
    authorizationUrl,
    callbackUrl,
    message: "Open the authorization URL to connect Notion MCP.",
  };
}

export async function finishNotionMcpAuth(
  callbackRequestUrl: string,
  options: NotionMcpOptions = {},
): Promise<NotionMcpCallbackResult> {
  const url = new URL(callbackRequestUrl);
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(redactConnectorMessage(url.searchParams.get("error_description") ?? error));
  }

  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !returnedState) {
    throw new Error("Notion MCP callback is missing code or state.");
  }

  const data = await loadStore(options.repoRoot);
  if (!data.flow || flowExpired(data.flow, options)) {
    throw new Error("Notion MCP authorization flow expired. Start the connection again.");
  }
  if (data.flow.state !== returnedState) {
    throw new Error("Notion MCP authorization state did not match.");
  }

  const provider = new FileNotionMcpOAuthProvider(options, data.flow.redirectUrl, returnedState);
  await auth(provider, {
    serverUrl: notionMcpServerUrl(options),
    authorizationCode: code,
    resourceMetadataUrl: notionMcpResourceMetadataUrl(options),
    ...authFetchOption(options),
  });

  return {
    authenticated: true,
    message: "Notion MCP connected.",
  };
}

export async function listNotionMcpTools(
  options: NotionMcpOptions = {},
): Promise<NotionMcpToolSummary[]> {
  const provider = new FileNotionMcpOAuthProvider(
    options,
    fallbackCallbackUrl(options),
    randomToken(),
  );
  const client = new Client(
    {
      name: "strata",
      version: "0.1.0",
    },
    {
      capabilities: {},
    },
  );
  const transport = new StreamableHTTPClientTransport(new URL(notionMcpServerUrl(options)), {
    authProvider: provider,
    ...transportFetchOption(options),
  });

  try {
    await client.connect(transport as unknown as Transport);
    const result = await client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
    }));
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function disconnectNotionMcp(
  options: NotionMcpOptions = {},
): Promise<NotionMcpStatus> {
  await rm(getNotionMcpStorePath(options.repoRoot), { force: true });
  return getNotionMcpStatus(options);
}

function notionMcpServerUrl(options: NotionMcpOptions): string {
  return options.env?.NOTION_MCP_URL ?? DEFAULT_NOTION_MCP_URL;
}

function notionMcpResourceMetadataUrl(options: NotionMcpOptions): URL {
  const url = new URL(notionMcpServerUrl(options));
  return new URL("/.well-known/oauth-protected-resource", url.origin);
}

function notionMcpCallbackUrl(origin: string | undefined, options: NotionMcpOptions): string {
  const base = origin?.trim() || options.env?.STRATA_WEB_PUBLIC_URL || "http://127.0.0.1:5173";
  const url = new URL(base);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported Notion MCP callback protocol: ${url.protocol}`);
  }
  return new URL("/api/connectors/notion/mcp/callback", url.origin).toString();
}

function fallbackCallbackUrl(options: NotionMcpOptions): string {
  return (
    options.env?.NOTION_MCP_REDIRECT_URI ??
    "http://127.0.0.1:5173/api/connectors/notion/mcp/callback"
  );
}

function now(options: NotionMcpOptions): Date {
  return options.now ?? new Date();
}

function fetchLike(options: NotionMcpOptions): FetchLike | undefined {
  return options.fetchImpl as FetchLike | undefined;
}

function authFetchOption(options: NotionMcpOptions): { fetchFn?: FetchLike } {
  const fetchFn = fetchLike(options);
  return fetchFn === undefined ? {} : { fetchFn };
}

function transportFetchOption(options: NotionMcpOptions): { fetch?: FetchLike } {
  const fetch = fetchLike(options);
  return fetch === undefined ? {} : { fetch };
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function flowExpired(flow: NotionMcpFlow, options: NotionMcpOptions): boolean {
  return now(options).getTime() - Date.parse(flow.createdAt) > FLOW_TTL_MS;
}

async function loadStore(repoRoot?: string): Promise<NotionMcpStoreData> {
  const file = getNotionMcpStorePath(repoRoot);
  if (!existsSync(file)) {
    return emptyStore();
  }
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isStoreData(parsed)) {
    throw new Error(`Invalid Notion MCP auth store: ${file}`);
  }
  return parsed;
}

async function saveStore(data: NotionMcpStoreData, repoRoot?: string): Promise<void> {
  const file = getNotionMcpStorePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await chmod(file, 0o600);
}

async function updateStore(
  repoRoot: string | undefined,
  mutate: (data: NotionMcpStoreData) => void,
): Promise<NotionMcpStoreData> {
  const data = await loadStore(repoRoot);
  mutate(data);
  data.updatedAt = new Date().toISOString();
  await saveStore(data, repoRoot);
  return data;
}

function emptyStore(): NotionMcpStoreData {
  return { version: 1 };
}

function storedTokens(tokens: OAuthTokens, options: NotionMcpOptions): StoredOAuthTokens {
  const savedAt = now(options).toISOString();
  const expiresAt =
    tokens.expires_in === undefined
      ? undefined
      : new Date(now(options).getTime() + tokens.expires_in * 1000).toISOString();
  return {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    savedAt,
    ...(tokens.id_token === undefined ? {} : { id_token: tokens.id_token }),
    ...(tokens.expires_in === undefined ? {} : { expires_in: tokens.expires_in }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
    ...(tokens.refresh_token === undefined ? {} : { refresh_token: tokens.refresh_token }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

function oauthTokens(tokens: StoredOAuthTokens): OAuthTokens {
  return {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    ...(tokens.id_token === undefined ? {} : { id_token: tokens.id_token }),
    ...(tokens.expires_in === undefined ? {} : { expires_in: tokens.expires_in }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
    ...(tokens.refresh_token === undefined ? {} : { refresh_token: tokens.refresh_token }),
  };
}

function isStoreData(value: unknown): value is NotionMcpStoreData {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<NotionMcpStoreData>).version === 1
  );
}

class FileNotionMcpOAuthProvider implements OAuthClientProvider {
  authorizationUrl: string | undefined;

  constructor(
    private readonly options: NotionMcpOptions,
    private readonly callbackUrl: string,
    private readonly oauthState: string,
  ) {}

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Strata",
      redirect_uris: [this.callbackUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return this.oauthState;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await loadStore(this.options.repoRoot)).clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await updateStore(this.options.repoRoot, (data) => {
      data.clientInformation = clientInformation;
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const tokens = (await loadStore(this.options.repoRoot)).tokens;
    return tokens ? oauthTokens(tokens) : undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await updateStore(this.options.repoRoot, (data) => {
      data.tokens = storedTokens(tokens, this.options);
      delete data.flow;
    });
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl.toString();
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await updateStore(this.options.repoRoot, (data) => {
      data.flow = {
        state: this.oauthState,
        redirectUrl: this.callbackUrl,
        createdAt: data.flow?.createdAt ?? now(this.options).toISOString(),
        codeVerifier,
      };
    });
  }

  async codeVerifier(): Promise<string> {
    const verifier = (await loadStore(this.options.repoRoot)).flow?.codeVerifier;
    if (!verifier) {
      throw new Error("Missing Notion MCP authorization verifier.");
    }
    return verifier;
  }

  async saveDiscoveryState(discoveryState: OAuthDiscoveryState): Promise<void> {
    await updateStore(this.options.repoRoot, (data) => {
      data.discoveryState = discoveryState;
    });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await loadStore(this.options.repoRoot)).discoveryState;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    await updateStore(this.options.repoRoot, (data) => {
      if (scope === "all" || scope === "client") {
        delete data.clientInformation;
      }
      if (scope === "all" || scope === "tokens") {
        delete data.tokens;
      }
      if (scope === "all" || scope === "verifier") {
        delete data.flow;
      }
      if (scope === "all" || scope === "discovery") {
        delete data.discoveryState;
      }
    });
  }
}
