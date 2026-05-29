import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@strata/core";
import { createDefaultToolRegistry } from "@strata/tools";
import { AnthropicModelAdapter } from "../anthropic.js";
import type { AnthropicCredentials } from "../authStore.js";

describe("AnthropicModelAdapter", () => {
  test("normalizes replayed tool call ids to Anthropic's allowed id pattern", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return new Response(
          [
            sse({ type: "message_start", message: { id: "msg_1" } }),
            sse({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
            sse({ type: "message_stop" }),
          ].join(""),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new AnthropicModelAdapter({
      credentials: fakeCredentials(),
      model: "claude-opus-4-5",
      fetchImpl,
    });

    await adapter.complete({
      messages: [
        { role: "user", content: "Read index." },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call_1|fc_1",
              name: "wiki.readPage",
              argumentsText: JSON.stringify({ path: "index.md" }),
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call_1|fc_1",
          content: JSON.stringify({ ok: true, result: "Index" }),
        },
        { role: "user", content: "Thanks." },
      ],
      tools: createDefaultToolRegistry().list(),
    });

    const messages = (capturedBody as { messages: JsonObject[] }).messages;
    const assistantContent = messages[1]?.content as JsonObject[];
    const toolResultContent = messages[2]?.content as JsonObject[];
    expect(assistantContent[0]?.id).toBe("call_1_fc_1");
    expect(toolResultContent[0]?.tool_use_id).toBe("call_1_fc_1");
    expect(JSON.stringify(capturedBody)).not.toContain("call_1|fc_1");
  });
});

function sse(value: JsonObject): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function fakeCredentials(): AnthropicCredentials {
  return {
    type: "anthropic_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
    scopes: [],
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}
