import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { WebApiOptions } from "./runtime.js";
import { runtimeEnv } from "./runtime.js";

export interface WebAuthStatus {
  enabled: boolean;
  authenticated: boolean;
  /**
   * Where the unlock passcode comes from: `env` when STRATA_PASSCODE is set,
   * `unset` when auth is on but no passcode is configured (nothing can unlock
   * until one is set), or `disabled` when auth is turned off entirely.
   */
  source: "env" | "unset" | "disabled";
}

export interface WebAuthSessionResult {
  ok: true;
  status: WebAuthStatus;
  cookie: string;
}

export const WEB_AUTH_COOKIE_NAME = "strata_web_session";
const WEB_AUTH_PASSCODE_ENV = "STRATA_PASSCODE";
const WEB_AUTH_DISABLE_ENV = "STRATA_WEB_AUTH";
const PASSCODE_PATTERN = /^\d{4}$/;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

interface WebAuthSession {
  expiresAt: number;
}

export class WebAuthController {
  readonly enabled: boolean;
  readonly source: WebAuthStatus["source"];
  private readonly passcode: string;
  private readonly sessions = new Map<string, WebAuthSession>();

  private constructor(input: {
    enabled: boolean;
    passcode: string;
    source: WebAuthStatus["source"];
  }) {
    this.enabled = input.enabled;
    this.passcode = input.passcode;
    this.source = input.source;
  }

  static create(options: WebApiOptions = {}): WebAuthController {
    const env = runtimeEnv(options);
    if (isWebAuthDisabled(env)) {
      return new WebAuthController({ enabled: false, passcode: "", source: "disabled" });
    }

    const passcode = env[WEB_AUTH_PASSCODE_ENV]?.trim() ?? "";
    if (passcode === "") {
      return new WebAuthController({ enabled: true, passcode: "", source: "unset" });
    }

    return new WebAuthController({ enabled: true, passcode, source: "env" });
  }

  /** True when STRATA_PASSCODE is set but is not exactly four digits. */
  get passcodeMalformed(): boolean {
    return this.source === "env" && !PASSCODE_PATTERN.test(this.passcode);
  }

  status(request?: Request): WebAuthStatus {
    return {
      enabled: this.enabled,
      authenticated: !this.enabled || (request !== undefined && this.isAuthenticated(request)),
      source: this.source,
    };
  }

  isAuthenticated(request: Request): boolean {
    if (!this.enabled) {
      return true;
    }

    const bearer = bearerToken(request.headers.get("authorization"));
    if (bearer !== null && secureEqual(bearer, this.passcode)) {
      return true;
    }

    const sessionId = cookieValue(request.headers.get("cookie"), WEB_AUTH_COOKIE_NAME);
    if (sessionId === null) {
      return false;
    }
    return this.hasValidSession(sessionId);
  }

  createSession(passcode: string, request: Request): WebAuthSessionResult | undefined {
    if (!this.enabled) {
      return {
        ok: true,
        status: this.status(),
        cookie: expiredCookie(request),
      };
    }
    if (!secureEqual(passcode, this.passcode)) {
      return undefined;
    }
    this.pruneExpiredSessions(Date.now());
    const sessionId = randomBytes(32).toString("base64url");
    this.sessions.set(sessionId, { expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 });
    return {
      ok: true,
      status: { enabled: true, authenticated: true, source: this.source },
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
