import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getStrataPaths } from "@strata/core";
import type { WebApiOptions } from "./runtime.js";
import { repoRoot, runtimeEnv } from "./runtime.js";

export interface WebAuthStatus {
  enabled: boolean;
  authenticated: boolean;
  tokenSource: "env" | "local" | "disabled";
}

export interface WebAuthSessionResult {
  ok: true;
  status: WebAuthStatus;
  cookie: string;
}

export const WEB_AUTH_COOKIE_NAME = "strata_web_session";
const WEB_AUTH_TOKEN_ENV = "STRATA_WEB_TOKEN";
const WEB_AUTH_DISABLE_ENV = "STRATA_WEB_AUTH";
const WEB_AUTH_TOKEN_FILE = "web-auth-token";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

interface WebAuthSession {
  expiresAt: number;
}

export class WebAuthController {
  readonly enabled: boolean;
  readonly tokenSource: WebAuthStatus["tokenSource"];
  readonly tokenPath: string;
  private readonly token: string;
  private readonly sessions = new Map<string, WebAuthSession>();

  private constructor(input: {
    enabled: boolean;
    token: string;
    tokenSource: WebAuthStatus["tokenSource"];
    tokenPath: string;
  }) {
    this.enabled = input.enabled;
    this.token = input.token;
    this.tokenSource = input.tokenSource;
    this.tokenPath = input.tokenPath;
  }

  static create(options: WebApiOptions = {}): WebAuthController {
    const env = runtimeEnv(options);
    const tokenPath = webAuthTokenPath(options);
    if (isWebAuthDisabled(env)) {
      return new WebAuthController({
        enabled: false,
        token: "",
        tokenSource: "disabled",
        tokenPath,
      });
    }

    const envToken = env[WEB_AUTH_TOKEN_ENV]?.trim();
    if (envToken !== undefined && envToken !== "") {
      return new WebAuthController({
        enabled: true,
        token: envToken,
        tokenSource: "env",
        tokenPath,
      });
    }

    return new WebAuthController({
      enabled: true,
      token: loadOrCreateLocalWebToken(tokenPath),
      tokenSource: "local",
      tokenPath,
    });
  }

  status(request?: Request): WebAuthStatus {
    return {
      enabled: this.enabled,
      authenticated: !this.enabled || (request !== undefined && this.isAuthenticated(request)),
      tokenSource: this.tokenSource,
    };
  }

  isAuthenticated(request: Request): boolean {
    if (!this.enabled) {
      return true;
    }

    const bearer = bearerToken(request.headers.get("authorization"));
    if (bearer !== null && secureEqual(bearer, this.token)) {
      return true;
    }

    const sessionId = cookieValue(request.headers.get("cookie"), WEB_AUTH_COOKIE_NAME);
    if (sessionId === null) {
      return false;
    }
    return this.hasValidSession(sessionId);
  }

  createSession(token: string, request: Request): WebAuthSessionResult | undefined {
    if (!this.enabled) {
      return {
        ok: true,
        status: this.status(),
        cookie: expiredCookie(request),
      };
    }
    if (!secureEqual(token, this.token)) {
      return undefined;
    }
    this.pruneExpiredSessions(Date.now());
    const sessionId = randomBytes(32).toString("base64url");
    this.sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
    return {
      ok: true,
      status: { enabled: true, authenticated: true, tokenSource: this.tokenSource },
      cookie: sessionCookie(sessionId, request),
    };
  }

  logout(request: Request): { status: WebAuthStatus; cookie: string } {
    const sessionId = cookieValue(request.headers.get("cookie"), WEB_AUTH_COOKIE_NAME);
    if (sessionId !== null) {
      this.sessions.delete(sessionId);
    }
    return {
      status: this.status(),
      cookie: expiredCookie(request),
    };
  }

  private hasValidSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return false;
    }
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  private pruneExpiredSessions(nowMs: number): void {
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= nowMs) {
        this.sessions.delete(id);
      }
    }
  }
}

export function isWebAuthDisabled(env: Record<string, string | undefined>): boolean {
  const value = env[WEB_AUTH_DISABLE_ENV]?.trim().toLowerCase();
  return value === "off" || value === "false" || value === "0" || value === "disabled";
}

export function webAuthTokenPath(options: WebApiOptions = {}): string {
  return path.join(getStrataPaths(repoRoot(options)).runtimeDir, WEB_AUTH_TOKEN_FILE);
}

export function isWebAuthExemptPath(pathname: string, method: string): boolean {
  if (method === "OPTIONS") {
    return true;
  }
  if (pathname === "/api/health") {
    return true;
  }
  if (pathname === "/api/auth/status" || pathname === "/api/auth/session") {
    return true;
  }
  if (pathname === "/api/connectors/notion/mcp/callback") {
    return true;
  }
  return /^\/api\/auth\/models\/[^/]+\/callback$/.test(pathname);
}

function loadOrCreateLocalWebToken(tokenPath: string): string {
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing !== "") {
      return existing;
    }
  }

  const token = randomBytes(32).toString("base64url");
  mkdirSync(path.dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return token;
}

function secureEqual(actual: string, expected: string): boolean {
  if (actual === "" || expected === "") {
    return false;
  }
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function bearerToken(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

function cookieValue(header: string | null, name: string): string | null {
  if (header === null) {
    return null;
  }
  for (const pair of header.split(";")) {
    const [rawKey, ...rawValue] = pair.trim().split("=");
    if (rawKey === name) {
      return rawValue.join("=") || null;
    }
  }
  return null;
}

function sessionCookie(sessionId: string, request: Request): string {
  return [
    `${WEB_AUTH_COOKIE_NAME}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    secureCookieAttribute(request),
  ]
    .filter(Boolean)
    .join("; ");
}

function expiredCookie(request: Request): string {
  return [
    `${WEB_AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    secureCookieAttribute(request),
  ]
    .filter(Boolean)
    .join("; ");
}

function secureCookieAttribute(request: Request): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const url = new URL(request.url);
  return forwardedProto === "https" || url.protocol === "https:" ? "Secure" : "";
}
