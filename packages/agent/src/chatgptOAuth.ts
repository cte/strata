import { createServer, type Server } from "node:http";
import {
  type ChatGptCredentials,
  getChatGptCredentials,
  setChatGptCredentials,
} from "./authStore.js";

const CALLBACK_HOST = Bun.env.STRATA_OAUTH_CALLBACK_HOST ?? "127.0.0.1";
const CALLBACK_PORT = 1455;
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/auth/callback`;
const SCOPE = "openid profile email offline_access";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const REFRESH_SKEW_MS = 60_000;

export class ChatGptLoginCancelled extends Error {
  constructor() {
    super("ChatGPT login cancelled");
    this.name = "ChatGptLoginCancelled";
  }
}

export interface ChatGptLoginCallbacks {
  onAuth: (info: { url: string; instructions: string }) => void;
  onPrompt: (prompt: string) => Promise<string>;
  onManualCodeInput?: () => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export interface ChatGptAuthorizationRequest {
  url: string;
  state: string;
  verifier: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface CallbackServer {
  close: () => Promise<void>;
  cancelWait: () => void;
  waitForCode: () => Promise<string | null>;
}

export async function loginChatGpt(callbacks: ChatGptLoginCallbacks): Promise<ChatGptCredentials> {
  const signal = callbacks.signal;
  const ensureNotCancelled = (): void => {
    if (signal !== undefined && signal.aborted) {
      throw new ChatGptLoginCancelled();
    }
  };

  ensureNotCancelled();
  const { url: authUrl, state, verifier } = await createChatGptAuthorizationRequest();

  const server = await startCallbackServer(state);

  const onAbort = (): void => {
    server.cancelWait();
  };
  signal?.addEventListener("abort", onAbort);

  callbacks.onAuth({
    url: authUrl,
    instructions: "Open this URL, complete ChatGPT login, then return here.",
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
      throw new ChatGptLoginCancelled();
    }

    callbacks.onProgress?.("Exchanging authorization code...");
    const token = await exchangeAuthorizationCode(code, verifier, signal);
    ensureNotCancelled();
    return credentialsFromToken(token);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await server.close();
  }
}

export async function createChatGptAuthorizationRequest(): Promise<ChatGptAuthorizationRequest> {
  const { verifier, challenge } = await generatePkce();
  const state = createState();
  return {
    url: createAuthUrl(state, challenge),
    state,
    verifier,
    redirectUri: REDIRECT_URI,
  };
}

export async function completeChatGptAuthorizationCode(
  code: string,
  verifier: string,
  signal?: AbortSignal,
): Promise<ChatGptCredentials> {
  const token = await exchangeAuthorizationCode(code, verifier, signal);
  return credentialsFromToken(token);
}

export async function refreshChatGptCredentials(
  credentials: ChatGptCredentials,
): Promise<ChatGptCredentials> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: CLIENT_ID,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `ChatGPT token refresh failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }

  const token = await parseTokenResponse(response);
  return {
    ...credentialsFromToken(token),
    createdAt: credentials.createdAt,
  };
}

export async function getValidChatGptCredentials(repoRoot?: string): Promise<ChatGptCredentials> {
  const credentials = await getChatGptCredentials(repoRoot);
  if (credentials === undefined) {
    throw new Error("Not logged in with ChatGPT. Run `bun run strata auth login openai-codex`.");
  }

  if (Date.now() + REFRESH_SKEW_MS < credentials.expiresAt) {
    return credentials;
  }

  const refreshed = await refreshChatGptCredentials(credentials);
  await setChatGptCredentials(refreshed, repoRoot);
  return refreshed;
}

function credentialsFromToken(token: TokenResponse): ChatGptCredentials {
  if (
    typeof token.access_token !== "string" ||
    typeof token.refresh_token !== "string" ||
    typeof token.expires_in !== "number"
  ) {
    throw new Error("ChatGPT token response did not include access, refresh, and expiry fields");
  }

  const now = new Date().toISOString();
  return {
    type: "chatgpt_oauth",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    accountId: extractChatGptAccountId(token.access_token),
    createdAt: now,
    updatedAt: now,
  };
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  signal: AbortSignal | undefined,
): Promise<TokenResponse> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    }),
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(TOKEN_URL, init);

  if (!response.ok) {
    throw new Error(
      `ChatGPT token exchange failed with HTTP ${response.status}: ${await response.text()}`,
    );
  }
  return parseTokenResponse(response);
}

async function parseTokenResponse(response: Response): Promise<TokenResponse> {
  return (await response.json()) as TokenResponse;
}

function createAuthUrl(state: string, challenge: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "strata");
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
      if (url.pathname !== "/auth/callback") {
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
    const state = url.searchParams.get("state");
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

function extractChatGptAccountId(token: string): string {
  const payload = decodeJwtPayload(token);
  const auth = payload[JWT_CLAIM_PATH];
  if (typeof auth !== "object" || auth === null || !("chatgpt_account_id" in auth)) {
    throw new Error("Failed to extract ChatGPT account id from access token");
  }
  const accountId = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("Failed to extract ChatGPT account id from access token");
  }
  return accountId;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[1] === undefined) {
    throw new Error("Invalid JWT access token");
  }
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as unknown;
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid JWT payload");
  }
  return payload as Record<string, unknown>;
}

function createState(): string {
  const bytes = new Uint8Array(16);
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

function base64UrlDecode(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function successHtml(): string {
  return "<!doctype html><title>Strata login complete</title><p>ChatGPT login complete. You can close this window.</p>";
}

function errorHtml(message: string): string {
  return `<!doctype html><title>Strata login failed</title><p>${escapeHtml(message)}</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
