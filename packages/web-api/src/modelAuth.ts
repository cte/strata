import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  ANTHROPIC_CLAUDE_PROVIDER_ID,
  ANTHROPIC_OAUTH_MANUAL_REDIRECT_URI,
  type ApiKeyTarget,
  clearAnthropicCredentials,
  clearChatGptCredentials,
  clearModelApiKey as clearStoredModelApiKey,
  completeAnthropicAuthorizationCode,
  completeChatGptAuthorizationCode,
  createAnthropicAuthorizationRequest,
  createChatGptAuthorizationRequest,
  getAnthropicCredentials,
  getChatGptCredentials,
  getModelApiKey,
  type ModelProviderName,
  OPENAI_CODEX_PROVIDER_ID,
  setAnthropicCredentials,
  setChatGptCredentials,
  setModelApiKey as setStoredModelApiKey,
} from "@strata/agent";

export type ModelAuthProviderName = Extract<ModelProviderName, "openai-codex" | "anthropic-claude">;

export interface ModelAuthProviderStatus {
  provider: ModelAuthProviderName;
  displayName: string;
  authenticated: boolean;
  state: "connected" | "not_connected" | "auth_pending";
  message: string;
  expiresAt?: number;
}

/** Browser-safe status for a stored API key — never includes the key itself. */
export interface ModelApiKeyStatus {
  target: ApiKeyTarget;
  displayName: string;
  configured: boolean;
  /** Masked last-4 hint (e.g. "…ab12"), present only when configured. */
  hint?: string;
  baseUrl?: string;
  /** Whether this target accepts a custom base URL (OpenAI-compatible). */
  supportsBaseUrl: boolean;
}

export interface ModelAuthStatus {
  providers: ModelAuthProviderStatus[];
  apiKeys: ModelApiKeyStatus[];
}

export interface ModelApiKeySetInput {
  target: ApiKeyTarget;
  apiKey: string;
  baseUrl?: string | undefined;
}

export interface ModelApiKeyClearInput {
  target: ApiKeyTarget;
}

export interface ModelAuthStartInput {
  provider: ModelAuthProviderName;
}

export interface ModelAuthCompleteInput {
  provider: ModelAuthProviderName;
  authorizationResponse: string;
}

export interface ModelAuthStartResult {
  provider: ModelAuthProviderName;
  authenticated: false;
  authorizationUrl: string;
  callbackUrl: string;
  message: string;
}

export interface ModelAuthCompleteResult {
  provider: ModelAuthProviderName;
  authenticated: boolean;
  message: string;
}

export interface ModelAuthOptions {
  repoRoot?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}

interface ModelAuthFlow {
  provider: ModelAuthProviderName;
  state: string;
  verifier: string;
  callbackUrl: string;
  createdAt: string;
  server?: Server;
}

const FLOW_TTL_MS = 15 * 60 * 1000;
const flows = new Map<string, ModelAuthFlow>();

const API_KEY_DISPLAY: Record<ApiKeyTarget, string> = {
  openai: "OpenAI API key",
  anthropic: "Anthropic API key",
};

// OAuth and a stored API key for the same provider are mutually exclusive:
// connecting one clears the other so the credential store never holds both.
const TARGET_FOR_PROVIDER: Record<ModelAuthProviderName, ApiKeyTarget> = {
  "openai-codex": "openai",
  "anthropic-claude": "anthropic",
};
const PROVIDER_FOR_TARGET: Record<ApiKeyTarget, ModelAuthProviderName> = {
  openai: "openai-codex",
  anthropic: "anthropic-claude",
};

async function clearOAuthCredentials(
  provider: ModelAuthProviderName,
  options: ModelAuthOptions,
): Promise<void> {
  clearProviderFlows(provider);
  if (provider === OPENAI_CODEX_PROVIDER_ID) {
    await clearChatGptCredentials(options.repoRoot);
  } else {
    await clearAnthropicCredentials(options.repoRoot);
  }
}

function maskApiKey(apiKey: string): string {
  const tail = apiKey.slice(-4);
  return `…${tail}`;
}

async function apiKeyStatus(
  target: ApiKeyTarget,
  options: ModelAuthOptions,
): Promise<ModelApiKeyStatus> {
  const stored = await getModelApiKey(target, options.repoRoot);
  return {
    target,
    displayName: API_KEY_DISPLAY[target],
    configured: stored !== undefined,
    supportsBaseUrl: target === "openai",
    ...(stored === undefined ? {} : { hint: maskApiKey(stored.apiKey) }),
    ...(stored?.baseUrl === undefined ? {} : { baseUrl: stored.baseUrl }),
  };
}

export async function getModelAuthStatus(options: ModelAuthOptions = {}): Promise<ModelAuthStatus> {
  pruneExpiredFlows(options);
  const [codexCredentials, anthropicCredentials, openaiKey, anthropicKey] = await Promise.all([
    getChatGptCredentials(options.repoRoot),
    getAnthropicCredentials(options.repoRoot),
    apiKeyStatus("openai", options),
    apiKeyStatus("anthropic", options),
  ]);
  return {
    apiKeys: [openaiKey, anthropicKey],
    providers: [
      providerStatus({
        provider: OPENAI_CODEX_PROVIDER_ID,
        displayName: "OpenAI ChatGPT/Codex",
        authenticated: codexCredentials !== undefined,
        pending: hasPendingFlow(OPENAI_CODEX_PROVIDER_ID, options),
        ...(codexCredentials?.expiresAt === undefined
          ? {}
          : { expiresAt: codexCredentials.expiresAt }),
      }),
      providerStatus({
        provider: ANTHROPIC_CLAUDE_PROVIDER_ID,
        displayName: "Anthropic Claude",
        authenticated: anthropicCredentials !== undefined,
        pending: hasPendingFlow(ANTHROPIC_CLAUDE_PROVIDER_ID, options),
        ...(anthropicCredentials?.expiresAt === undefined
          ? {}
          : { expiresAt: anthropicCredentials.expiresAt }),
      }),
    ],
  };
}

export async function startModelAuth(
  input: ModelAuthStartInput,
  _origin: string | undefined,
  options: ModelAuthOptions = {},
): Promise<ModelAuthStartResult> {
  pruneExpiredFlows(options);
  const provider = assertModelAuthProvider(input.provider);
  clearProviderFlows(provider);
  const request =
    provider === OPENAI_CODEX_PROVIDER_ID
      ? await createChatGptAuthorizationRequest()
      : await createAnthropicAuthorizationRequest({
          redirectUri: ANTHROPIC_OAUTH_MANUAL_REDIRECT_URI,
        });
  const flow: ModelAuthFlow = {
    provider,
    state: request.state,
    verifier: request.verifier,
    callbackUrl: request.redirectUri,
    createdAt: now(options).toISOString(),
  };
  const callbackServer = shouldStartProviderCallbackServer(flow.callbackUrl)
    ? await startProviderCallbackServer(flow, options)
    : undefined;
  if (callbackServer !== undefined) {
    flow.server = callbackServer;
  }
  flows.set(flowKey(provider, request.state), flow);

  return {
    provider,
    authenticated: false,
    authorizationUrl: request.url,
    callbackUrl: request.redirectUri,
    message: `Open the authorization URL to connect ${displayName(provider)}.`,
  };
}

export async function finishModelAuth(
  callbackRequestUrl: string,
  providerParam: string,
  options: ModelAuthOptions = {},
): Promise<ModelAuthCompleteResult> {
  const provider = assertModelAuthProvider(providerParam);
  const url = new URL(callbackRequestUrl);
  const error = url.searchParams.get("error");
  if (error !== null) {
    throw new Error(url.searchParams.get("error_description") ?? error);
  }
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !returnedState) {
    throw new Error("Model authorization callback is missing code or state.");
  }
  return completeModelAuthCode(provider, code, returnedState, options);
}

export async function completeModelAuth(
  input: ModelAuthCompleteInput,
  options: ModelAuthOptions = {},
): Promise<ModelAuthCompleteResult> {
  const provider = assertModelAuthProvider(input.provider);
  const parsed = parseAuthorizationResponse(input.authorizationResponse, provider, options);
  return completeModelAuthCode(provider, parsed.code, parsed.state, options);
}

async function completeModelAuthCode(
  provider: ModelAuthProviderName,
  code: string,
  returnedState: string,
  options: ModelAuthOptions,
): Promise<ModelAuthCompleteResult> {
  const key = flowKey(provider, returnedState);
  const flow = flows.get(key);
  if (flow === undefined || flowExpired(flow, options)) {
    if (flow !== undefined) {
      closeFlow(key, flow);
    }
    throw new Error("Model authorization flow expired. Start the connection again.");
  }
  if (flow.provider !== provider) {
    throw new Error("Model authorization provider did not match.");
  }

  const fetchRestore = withFetch(options.fetchImpl);
  try {
    if (provider === OPENAI_CODEX_PROVIDER_ID) {
      const credentials = await completeChatGptAuthorizationCode(code, flow.verifier);
      await setChatGptCredentials(credentials, options.repoRoot);
    } else {
      const credentials = await completeAnthropicAuthorizationCode(
        code,
        flow.verifier,
        returnedState,
        undefined,
        flow.callbackUrl,
      );
      await setAnthropicCredentials(credentials, options.repoRoot);
    }
    // Mutual exclusivity: a fresh OAuth connection supersedes any stored key.
    await clearStoredModelApiKey(TARGET_FOR_PROVIDER[provider], options.repoRoot);
  } finally {
    fetchRestore();
    closeFlow(key, flow);
  }

  return {
    provider,
    authenticated: true,
    message: `${displayName(provider)} connected.`,
  };
}

export async function disconnectModelAuth(
  providerParam: string,
  options: ModelAuthOptions = {},
): Promise<ModelAuthStatus> {
  const provider = assertModelAuthProvider(providerParam);
  await clearOAuthCredentials(provider, options);
  return getModelAuthStatus(options);
}

export async function setModelApiKey(
  input: ModelApiKeySetInput,
  options: ModelAuthOptions = {},
): Promise<ModelAuthStatus> {
  const target = assertApiKeyTarget(input.target);
  await setStoredModelApiKey(
    target,
    {
      apiKey: input.apiKey,
      ...(target === "openai" && input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    },
    options.repoRoot,
  );
  // Mutual exclusivity: a stored key supersedes any OAuth connection.
  await clearOAuthCredentials(PROVIDER_FOR_TARGET[target], options);
  return getModelAuthStatus(options);
}

export async function clearModelApiKey(
  input: ModelApiKeyClearInput,
  options: ModelAuthOptions = {},
): Promise<ModelAuthStatus> {
  const target = assertApiKeyTarget(input.target);
  await clearStoredModelApiKey(target, options.repoRoot);
  return getModelAuthStatus(options);
}

function assertApiKeyTarget(value: string): ApiKeyTarget {
  if (value === "openai" || value === "anthropic") {
    return value;
  }
  throw new Error(`Unknown API key target: ${value}`);
}

export function modelAuthCallbackRoute(provider: ModelAuthProviderName): string {
  return `/api/auth/models/${provider}/callback`;
}

function providerStatus(input: {
  provider: ModelAuthProviderName;
  displayName: string;
  authenticated: boolean;
  pending: boolean;
  expiresAt?: number;
}): ModelAuthProviderStatus {
  const base = {
    provider: input.provider,
    displayName: input.displayName,
    authenticated: input.authenticated,
  };
  if (input.authenticated) {
    return {
      ...base,
      state: "connected",
      message: `${input.displayName} is connected.`,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };
  }
  if (input.pending) {
    return {
      ...base,
      state: "auth_pending",
      message: `${input.displayName} authorization is waiting for browser completion.`,
    };
  }
  return {
    ...base,
    state: "not_connected",
    message: `${input.displayName} is not connected.`,
  };
}

function shouldStartProviderCallbackServer(callbackUrl: string): boolean {
  const url = new URL(callbackUrl);
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

function startProviderCallbackServer(
  flow: ModelAuthFlow,
  options: ModelAuthOptions,
): Promise<Server | undefined> {
  const callbackUrl = new URL(flow.callbackUrl);
  const port = Number.parseInt(callbackUrl.port, 10);
  const host = callbackUrl.hostname === "localhost" ? "127.0.0.1" : callbackUrl.hostname;
  const server = createServer((request, response) => {
    void handleProviderCallback(flow, options, request.url ?? "", response);
  });
  return new Promise((resolve) => {
    server.once("error", () => {
      resolve(undefined);
    });
    server.listen(port, host, () => resolve(server));
  });
}

async function handleProviderCallback(
  flow: ModelAuthFlow,
  options: ModelAuthOptions,
  requestUrl: string,
  response: ServerResponse<IncomingMessage>,
): Promise<void> {
  const callbackUrl = new URL(flow.callbackUrl);
  const url = new URL(requestUrl, callbackUrl.origin);
  if (url.pathname !== callbackUrl.pathname) {
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Strata login failed</title><p>Callback route not found.</p>",
    );
    return;
  }
  try {
    const result = await finishModelAuth(url.toString(), flow.provider, options);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(modelAuthCompleteHtml("ok", result.message));
  } catch (cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(modelAuthCompleteHtml("error", message));
  }
}

/**
 * Self-closing landing page for an OAuth popup/tab. The chat model-auth dialog
 * detects success by polling status, so the popup just needs to tell the user
 * it's done and close itself — no redirect back into the app.
 */
export function modelAuthCompleteHtml(status: "ok" | "error", message: string): string {
  const ok = status === "ok";
  const heading = ok ? "Connected" : "Connection failed";
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="color-scheme" content="dark light" />
    <title>Strata — ${heading}</title>
    <style>
      html,body{margin:0;height:100%;background:#09090b;color:#a1a1aa;}
      body{font:13px/1.6 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;text-align:center;padding:2rem;}
      h1{font-size:15px;color:${ok ? "#5eead4" : "#f87171"};margin:0 0 .5rem;}
      @media (prefers-color-scheme: light){html,body{background:#fafaf9;color:#52525b;}}
    </style>
  </head>
  <body>
    <div>
      <h1>${heading}</h1>
      <p>${safeMessage}</p>
      <p>You can close this window and return to Strata.</p>
    </div>
    <script>setTimeout(function(){ window.close(); }, 400);</script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseAuthorizationResponse(
  value: string,
  provider: ModelAuthProviderName,
  options: ModelAuthOptions,
): { code: string; state: string } {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error("Paste the authorization code or full callback URL.");
  }

  if (provider === ANTHROPIC_CLAUDE_PROVIDER_ID && trimmed.includes("#")) {
    const [code, state] = trimmed.split("#", 2);
    if (code && state) {
      return { code, state };
    }
  }

  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? (url.hash === "" ? null : url.hash.slice(1));
    if (code && state) {
      return { code, state };
    }
  } catch {
    // Fall through to query-string or raw-code parsing.
  }

  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state) {
      return { code, state };
    }
  }

  const flow = singlePendingFlow(provider, options);
  return { code: trimmed, state: flow.state };
}

function singlePendingFlow(
  provider: ModelAuthProviderName,
  options: ModelAuthOptions,
): ModelAuthFlow {
  const matches = [...flows.values()].filter(
    (flow) => flow.provider === provider && !flowExpired(flow, options),
  );
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error("Start a fresh model authorization flow before pasting a code.");
  }
  return matches[0];
}

function assertModelAuthProvider(value: string): ModelAuthProviderName {
  if (value === OPENAI_CODEX_PROVIDER_ID || value === ANTHROPIC_CLAUDE_PROVIDER_ID) {
    return value;
  }
  throw new Error(`Unsupported model auth provider: ${value}`);
}

function displayName(provider: ModelAuthProviderName): string {
  return provider === OPENAI_CODEX_PROVIDER_ID ? "OpenAI ChatGPT/Codex" : "Anthropic Claude";
}

function flowKey(provider: ModelAuthProviderName, state: string): string {
  return `${provider}:${state}`;
}

function clearProviderFlows(provider: ModelAuthProviderName): void {
  for (const [key, flow] of flows) {
    if (flow.provider === provider) {
      closeFlow(key, flow);
    }
  }
}

function closeFlow(key: string, flow: ModelAuthFlow): void {
  flows.delete(key);
  flow.server?.close();
}

function hasPendingFlow(provider: ModelAuthProviderName, options: ModelAuthOptions): boolean {
  for (const flow of flows.values()) {
    if (flow.provider === provider && !flowExpired(flow, options)) {
      return true;
    }
  }
  return false;
}

function pruneExpiredFlows(options: ModelAuthOptions): void {
  for (const [key, flow] of flows) {
    if (flowExpired(flow, options)) {
      closeFlow(key, flow);
    }
  }
}

function flowExpired(flow: ModelAuthFlow, options: ModelAuthOptions): boolean {
  return now(options).getTime() - Date.parse(flow.createdAt) > FLOW_TTL_MS;
}

function now(options: ModelAuthOptions): Date {
  return options.now ?? new Date();
}

function withFetch(fetchImpl: typeof fetch | undefined): () => void {
  if (fetchImpl === undefined) {
    return () => {};
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}
