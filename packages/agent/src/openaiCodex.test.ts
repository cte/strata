import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@cortex/core";
import { createDefaultToolRegistry } from "@cortex/tools";
import type { ChatGptCredentials } from "./authStore.js";
import { OpenAICodexModelAdapter } from "./openaiCodex.js";

describe("OpenAICodexModelAdapter", () => {
  test("calls the Codex backend and decodes canonical tool calls", async () => {
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedUrl = String(args[0]);
        const init = args[1];
        capturedHeaders = new Headers(init?.headers);
        capturedBody = JSON.parse(String(init?.body)) as JsonObject;
        return new Response(
          [
            sse({ type: "response.created", response: { id: "resp_1" } }),
            sse({
              type: "response.output_item.added",
              item: {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "wiki_readPage",
                arguments: "",
              },
            }),
            sse({ type: "response.function_call_arguments.delta", delta: '{"path"' }),
            sse({ type: "response.function_call_arguments.delta", delta: ':"index.md"}' }),
            sse({
              type: "response.output_item.done",
              item: {
                type: "function_call",
                id: "fc_1",
                call_id: "call_1",
                name: "wiki_readPage",
                arguments: '{"path":"index.md"}',
              },
            }),
            sse({ type: "response.completed", response: { id: "resp_1", status: "completed" } }),
          ].join(""),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICodexModelAdapter({
      credentials: fakeCredentials(),
      model: "gpt-5.5",
      fetchImpl,
    });

    const response = await adapter.complete({
      messages: [
        { role: "system", content: "Use tools." },
        { role: "user", content: "Read index." },
      ],
      tools: createDefaultToolRegistry().list(),
    });

    expect(capturedUrl).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(capturedHeaders?.get("authorization")).toBe("Bearer access");
    expect(capturedHeaders?.get("chatgpt-account-id")).toBe("acct");
    expect(capturedHeaders?.get("openai-beta")).toBe("responses=experimental");
    expect(JSON.stringify(capturedBody)).toContain("wiki_readPage");
    expect(JSON.stringify(capturedBody)).not.toContain("wiki.readPage");
    expect(response).toMatchObject({
      providerResponseId: "resp_1",
      finishReason: "tool_calls",
      toolCalls: [
        {
          id: "call_1|fc_1",
          name: "wiki.readPage",
          argumentsText: '{"path":"index.md"}',
        },
      ],
    });
  });
});

function sse(value: JsonObject): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function fakeCredentials(): ChatGptCredentials {
  return {
    type: "chatgpt_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    accountId: "acct",
    expiresAt: Date.now() + 60_000,
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z",
  };
}
