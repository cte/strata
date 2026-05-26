import { describe, expect, test } from "bun:test";
import {
  ANTHROPIC_OAUTH_SCOPES,
  ANTHROPIC_OAUTH_TOKEN_URL,
  completeAnthropicAuthorizationCode,
  createAnthropicAuthorizationRequest,
} from "./anthropicOAuth.js";

describe("Anthropic OAuth", () => {
  test("creates a Claude Code authorization URL with current scopes", async () => {
    const request = await createAnthropicAuthorizationRequest({
      redirectUri: "https://platform.claude.com/oauth/code/callback",
    });
    const url = new URL(request.url);

    expect(url.origin).toBe("https://claude.ai");
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://platform.claude.com/oauth/code/callback",
    );
    expect(url.searchParams.get("scope")).toBe(ANTHROPIC_OAUTH_SCOPES);
    expect(url.searchParams.get("scope")).toContain("user:sessions:claude_code");
    expect(url.searchParams.get("scope")).toContain("user:mcp_servers");
    expect(url.searchParams.get("scope")).toContain("user:file_upload");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(request.state).not.toBe(request.verifier);
  });

  test("exchanges authorization codes with form-encoded body at platform token endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let capturedRequest: Request | undefined;
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedRequest =
          args[0] instanceof Request ? args[0] : new Request(String(args[0]), args[1]);
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: ANTHROPIC_OAUTH_SCOPES,
        });
      },
      { preconnect: originalFetch.preconnect },
    ) satisfies typeof fetch;

    try {
      const credentials = await completeAnthropicAuthorizationCode(
        "code_123",
        "verifier_123",
        "state_123",
        undefined,
        "https://platform.claude.com/oauth/code/callback",
      );
      expect(credentials.accessToken).toBe("access");
      expect(capturedRequest?.url).toBe(ANTHROPIC_OAUTH_TOKEN_URL);
      if (capturedRequest === undefined) {
        throw new Error("expected token request to be captured");
      }
      expect(capturedRequest.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
      const body = new URLSearchParams(await capturedRequest.text());
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("code_123");
      expect(body.get("code_verifier")).toBe("verifier_123");
      expect(body.get("state")).toBe("state_123");
      expect(body.get("redirect_uri")).toBe("https://platform.claude.com/oauth/code/callback");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
