import { createServer, type Server } from "node:http";
import {
  type AnthropicCredentials,
  getAnthropicCredentials,
  setAnthropicCredentials,
} from "./authStore.js";

const CALLBACK_HOST = Bun.env.STRATA_OAUTH_CALLBACK_HOST ?? "127.0.0.1";
const CALLBACK_PORT = 1456;
export const ANTHROPIC_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const ANTHROPIC_OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const ANTHROPIC_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const ANTHROPIC_OAUTH_MANUAL_REDIRECT_URI =
  "https://platform.claude.com/oauth/code/callback";
export const ANTHROPIC_OAUTH_SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";
const DEFAULT_REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/callback`;
const REFRESH_SKEW_MS = 60_000;

export class AnthropicLoginCancelled extends Error {
  constructor() {
    super("Anthropic login cancelled");
    this.name = "AnthropicLoginCancelled";
  }
}

export interface AnthropicLoginCallbacks {
  onAuth: (info: { url: string; instructions: string }) => void;
  onPrompt: (prompt: string) => Promise<string>;
  onManualCodeInput?: () => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export interface AnthropicAuthorizationRequest {
  url: string;
  state: string;
  verifier: string;
  redirectUri: string;
}

export interface AnthropicAuthorizationRequestOptions {
  redirectUri?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  subscription_type?: string;
  rate_limit_tier?: string;
}

interface CallbackServer {
  close: () => Promise<void>;
  cancelWait: () => void;
  waitForCode: () => Promise<string | null>;
}

export async function loginAnthropic(
  callbacks: AnthropicLoginCallbacks,
): Promise<AnthropicCredentials> {
  const signal = callbacks.signal;
  const ensureNotCancelled = (): void => {
    if (signal !== undefined && signal.aborted) {
      throw new AnthropicLoginCancelled();
    }
  };

  ensureNotCancelled();
  const { url: authUrl, state, verifier } = await createAnthropicAuthorizationRequest();

  const server = await startCallbackServer(state);

  const onAbort = (): void => {
    server.cancelWait();
  };
  signal?.addEventListener("abort", onAbort);

  callbacks.onAuth({
    url: authUrl,
    instructions: "Open this URL, complete Claude login, then return here.",
  });

  try {
    ensureNotCancelled();
    let code: string | undefined;
    if (callbacks.onManualCodeInput !== undefined) {
      const manualPromise = callbacks.onManualCodeInput().then((input) => {
        server.cancelWait();
        return parseAuthorizationInput(input, state);
      });
      const callbackCode = await server.waitForCode();
      ensureNotCancelled();
      code = callbackCode ?? (await manualPromise);
    } else {
      code = (await server.waitForCode()) ?? undefined;
      ensureNotCancelled();
    }

    if (!code) {
      ensureNotCancelled();
      const input = await callbacks.onPrompt("Paste the authorization code or full redirect URL:");
      ensureNotCancelled();
      code = parseAuthorizationInput(input, state);
    }
    if (!code) {
      throw new AnthropicLoginCancelled();
    }

    callbacks.onProgress?.("Exchanging authorization code...");
    const token = await exchangeAuthorizationCode(
      code,
      verifier,
      state,
      signal,
      DEFAULT_REDIRECT_URI,
    );

    ensureNotCancelled();
    return credentialsFromToken(token);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await server.close();
  }
}

export async function createAnthropicAuthorizationRequest(
  options: AnthropicAuthorizationRequestOptions = {},
): Promise<AnthropicAuthorizationRequest> {
  const { verifier, challenge } = await generatePkce();
  const state = createState();
  const redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
  return {
    url: createAuthUrl(state, challenge, redirectUri),
    state,
    verifier,
    redirectUri,
  };
}

export async function completeAnthropicAuthorizationCode(
  code: string,
  verifier: string,
  state: string,
  signal?: AbortSignal,
  redirectUri = DEFAULT_REDIRECT_URI,
): Promise<AnthropicCredentials> {
  const token = await exchangeAuthorizationCode(code, verifier, state, signal, redirectUri);
  return credentialsFromToken(token);
}

export async function refreshAnthropicCredentials(
  credentials: AnthropicCredentials,
): Promise<AnthropicCredentials> {
  const response = await postTokenRequest({
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    client_id: ANTHROPIC_OAUTH_CLIENT_ID,
    scope: credentials.scopes.join(" "),
    expires_in: 31_536_000,
  });

  if (!response.ok) {
    throw new Error(
      `Anthropic token refresh failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const token = await parseTokenResponse(response);
  return {
    ...credentialsFromToken(token, credentials),
    createdAt: credentials.createdAt,
  };
}

export async function getValidAnthropicCredentials(
  repoRoot?: string,
): Promise<AnthropicCredentials> {
  const credentials = await getAnthropicCredentials(repoRoot);
  if (credentials === undefined) {
    throw new Error(
      "Not logged in with Anthropic. Run `bun run strata auth login anthropic-claude`.",
    );
  }

  if (Date.now() + REFRESH_SKEW_MS < credentials.expiresAt) {
    return credentials;
  }

  const refreshed = await refreshAnthropicCredentials(credentials);
  await setAnthropicCredentials(refreshed, repoRoot);
  return refreshed;
}

function credentialsFromToken(
  token: TokenResponse,
  previous?: AnthropicCredentials,
): AnthropicCredentials {
  if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") {
    throw new Error("Anthropic token response did not include access and expiry fields");
  }
  const refreshToken = token.refresh_token ?? previous?.refreshToken;
  if (typeof refreshToken !== "string") {
    throw new Error("Anthropic token response did not include a refresh token");
  }

  const now = new Date().toISOString();
  const credentials: AnthropicCredentials = {
    type: "anthropic_oauth",
    accessToken: token.access_token,
    refreshToken,
    expiresAt: Date.now() + token.expires_in * 1000,
    scopes: parseScopes(token.scope) ?? previous?.scopes ?? ANTHROPIC_OAUTH_SCOPES.split(" "),
    createdAt: now,
    updatedAt: now,
  };
  if (token.subscription_type !== undefined) {
    credentials.subscriptionType = token.subscription_type;
  } else if (previous?.subscriptionType !== undefined) {
    credentials.subscriptionType = previous.subscriptionType;
  }
  if (token.rate_limit_tier !== undefined) {
    credentials.rateLimitTier = token.rate_limit_tier;
  } else if (previous?.rateLimitTier !== undefined) {
    credentials.rateLimitTier = previous.rateLimitTier;
  }
  return credentials;
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  state: string,
  signal: AbortSignal | undefined,
  redirectUri: string,
): Promise<TokenResponse> {
  const response = await postTokenRequest(
    {
      grant_type: "authorization_code",
      client_id: ANTHROPIC_OAUTH_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      state,
    },
    signal,
  );

  if (!response.ok) {
    throw new Error(
      `Anthropic token exchange failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return parseTokenResponse(response);
}

async function postTokenRequest(
  body: Record<string, string | number>,
  signal?: AbortSignal,
): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(
      Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)])),
    ),
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  return fetch(ANTHROPIC_OAUTH_TOKEN_URL, init);
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  return (await response.json()) as TokenResponse;
}

function createAuthUrl(state: string, challenge: string, redirectUri: string): string {
  const url = new URL(ANTHROPIC_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", ANTHROPIC_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", ANTHROPIC_OAUTH_SCOPES);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return {
    verifier,
    challenge: base64UrlEncode(new Uint8Array(digest)),
  };
}

function startCallbackServer(expectedState: string): Promise<CallbackServer> {
  let server: Server | undefined;
  let settle: ((code: string | null) => void) | undefined;
  let settled = false;
  const waitPromise = new Promise<string | null>((resolve) => {
    settle = (code) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(code);
    };
  });

  server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "", "http://localhost");
      if (url.pathname !== "/callback") {
        response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        response.end(errorHtml("Callback route not found."));
        return;
      }
      if (url.searchParams.get("state") !== expectedState) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(errorHtml("OAuth state mismatch."));
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        response.end(errorHtml("Missing authorization code."));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(successHtml());
      settle?.(code);
    } catch {
      response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      response.end(errorHtml("Internal error while processing callback."));
    }
  });

  return new Promise((resolve) => {
    server?.once("error", () => {
      settle?.(null);
      resolve({
        close: async () => {},
        cancelWait: () => settle?.(null),
        waitForCode: async () => null,
      });
    });

    server?.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
      resolve({
        close: () =>
          new Promise<void>((closeResolve) => {
            server?.close(() => closeResolve());
          }),
        cancelWait: () => settle?.(null),
        waitForCode: () => waitPromise,
      });
    });
  });
}

function parseAuthorizationInput(input: string, expectedState: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const state = url.searchParams.get("state") ?? (url.hash === "" ? null : url.hash.slice(1));
    if (state !== null && state !== expectedState) {
      throw new Error("OAuth state mismatch");
    }
    return url.searchParams.get("code") ?? undefined;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "OAuth state mismatch") {
      throw error;
    }
  }

  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#", 2);
    if (state !== undefined && state !== expectedState) {
      throw new Error("OAuth state mismatch");
    }
    return code;
  }

  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed);
    const state = params.get("state");
    if (state !== null && state !== expectedState) {
      throw new Error("OAuth state mismatch");
    }
    return params.get("code") ?? undefined;
  }

  return trimmed;
}

function parseScopes(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value.split(/\s+/).filter((scope) => scope !== "");
}

function createState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function successHtml(): string {
  return "<!doctype html><title>Strata login complete</title><p>Claude login complete. You can close this window.</p>";
}

function errorHtml(message: string): string {
  return `<!doctype html><title>Strata login failed</title><p>${escapeHtml(message)}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
