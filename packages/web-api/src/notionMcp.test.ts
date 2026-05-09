import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  finishNotionMcpAuth,
  getNotionMcpStatus,
  getNotionMcpStorePath,
  startNotionMcpAuth,
} from "./notionMcp.js";

describe("notion MCP auth", () => {
  test("starts and completes a PKCE OAuth flow into a local 0600 token store", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-notion-mcp-"));
    try {
      const options = {
        repoRoot,
        env: { NOTION_MCP_URL: "https://mcp.test/mcp" },
        fetchImpl: fakeOAuthFetch(),
        now: new Date("2026-05-06T18:00:00.000Z"),
      };

      const started = await startNotionMcpAuth("https://vivid-bear.exe.xyz", options);
      expect(started.authenticated).toBe(false);
      expect(started.callbackUrl).toBe(
        "https://vivid-bear.exe.xyz/api/connectors/notion/mcp/callback",
      );
      expect(started.authorizationUrl).toStartWith("https://auth.test/authorize?");

      const pending = await getNotionMcpStatus(options);
      expect(pending.state).toBe("auth_pending");

      const state = new URL(started.authorizationUrl ?? "").searchParams.get("state");
      expect(state).toBeTruthy();

      const finished = await finishNotionMcpAuth(
        `https://vivid-bear.exe.xyz/api/connectors/notion/mcp/callback?code=code_123&state=${state}`,
        options,
      );
      expect(finished.authenticated).toBe(true);

      const status = await getNotionMcpStatus(options);
      expect(status.authenticated).toBe(true);
      expect(status.expiresAt).toBe("2026-05-06T19:00:00.000Z");

      const mode = (await stat(getNotionMcpStorePath(repoRoot))).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function fakeOAuthFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      if (url.href === "https://mcp.test/.well-known/oauth-protected-resource") {
        return Response.json({
          resource: "https://mcp.test/mcp",
          authorization_servers: ["https://auth.test"],
          bearer_methods_supported: ["header"],
          resource_name: "Notion MCP Test",
        });
      }
      if (url.href === "https://auth.test/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: "https://auth.test",
          authorization_endpoint: "https://auth.test/authorize",
          token_endpoint: "https://auth.test/token",
          registration_endpoint: "https://auth.test/register",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      if (url.href === "https://auth.test/register") {
        return Response.json({
          client_id: "client_123",
          redirect_uris: ["https://vivid-bear.exe.xyz/api/connectors/notion/mcp/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          client_name: "Strata",
        });
      }
      if (url.href === "https://auth.test/token") {
        return Response.json({
          access_token: "access_123",
          token_type: "Bearer",
          refresh_token: "refresh_123",
          expires_in: 3600,
        });
      }
      return Response.json({ error: `unexpected ${url.href}` }, { status: 404 });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}
