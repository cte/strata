import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@strata/core";
import { AnthropicModelAdapter } from "./anthropic.js";
import type { AnthropicCredentials } from "./authStore.js";

describe("AnthropicModelAdapter", () => {
  test("sends Claude OAuth identity headers and system prefix", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const init = args[1];
        capturedHeaders = new Headers(init?.headers);
        capturedBody = JSON.parse(String(init?.body)) as JsonObject;
        return new Response(
          [
            sse({ type: "message_start", message: { id: "msg_1", usage: {} } }),
            sse({
              type: "content_block_start",
              index: 0,
              content_block: { type: "text", text: "" },
            }),
            sse({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "Hi" },
            }),
            sse({ type: "content_block_stop", index: 0 }),
            sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }),
            sse({ type: "message_stop" }),
          ].join(""),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new AnthropicModelAdapter({
      credentials: fakeAnthropicCredentials(),
      model: "claude-sonnet-4-6",
      fetchImpl,
    });

    await adapter.complete({
      messages: [
        { role: "system", content: "Use the wiki." },
        { role: "user", content: "Say hi." },
      ],
      tools: [],
    });

    expect(capturedHeaders?.get("authorization")).toBe("Bearer access");
    expect(capturedHeaders?.get("anthropic-version")).toBe("2023-06-01");
    expect(capturedHeaders?.get("anthropic-beta")).toContain("oauth-2025-04-20");
    expect(capturedHeaders?.get("anthropic-beta")).toContain("claude-code-20250219");
    expect(capturedHeaders?.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(capturedHeaders?.get("x-app")).toBe("cli");
    expect(capturedHeaders?.get("user-agent")).toContain("claude-cli/");
    expect(capturedBody?.system).toBe(
      "You are Claude Code, Anthropic's official CLI for Claude.\n\nUse the wiki.",
    );
  });
});

function fakeAnthropicCredentials(): AnthropicCredentials {
  return {
    type: "anthropic_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
    scopes: ["user:inference", "user:profile"],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
}

function sse(payload: JsonObject): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
