import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@strata/core";
import { createDefaultToolRegistry } from "@strata/tools";
import type { ChatGptCredentials } from "../authStore.js";
import { OpenAICodexModelAdapter } from "../openaiCodex.js";

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
    expect(capturedBody?.parallel_tool_calls).toBe(true);
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

  test("includes Pi-mapped reasoning effort when set", async () => {
    const captured: JsonObject[] = [];
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        captured.push(JSON.parse(String(args[1]?.body)) as JsonObject);
        return new Response(
          sse({ type: "response.completed", response: { id: "resp_x", status: "completed" } }),
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

    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      reasoningEffort: "minimal",
    });
    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      reasoningEffort: "xhigh",
    });
    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      reasoningEffort: "off",
    });
    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });

    expect(captured[0]?.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(captured[1]?.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(captured[2]?.reasoning).toBeUndefined();
    expect(captured[3]?.reasoning).toBeUndefined();
  });

  test("encodes image attachments as input_image content parts", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return new Response(
          sse({ type: "response.completed", response: { id: "r", status: "completed" } }),
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
    await adapter.complete({
      messages: [
        {
          role: "user",
          content: "What's in this?",
          attachments: [
            { kind: "image", mimeType: "image/png", dataBase64: "AAAA", name: "ss.png" },
          ],
        },
      ],
      tools: [],
    });
    const input = (capturedBody as { input: { role: string; content: unknown[] }[] }).input;
    const userTurn = input.find((entry) => entry.role === "user");
    expect(Array.isArray(userTurn?.content)).toBe(true);
    const parts = userTurn?.content as { type: string; text?: string; image_url?: string }[];
    expect(parts[0]).toEqual({ type: "input_text", text: "What's in this?" });
    expect(parts[1]?.type).toBe("input_image");
    expect(parts[1]?.image_url).toBe("data:image/png;base64,AAAA");
  });

  test("retries transient HTTP failures and honors retry-after headers", async () => {
    let calls = 0;
    const fetchImpl = Object.assign(
      async () => {
        calls += 1;
        if (calls === 1) {
          return new Response("upstream connect error", {
            status: 503,
            headers: { "retry-after-ms": "0" },
          });
        }
        if (calls === 2) {
          return new Response("reset before headers", {
            status: 502,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(
          [
            sse({ type: "response.output_text.delta", delta: "Recovered" }),
            sse({
              type: "response.completed",
              response: { id: "resp_retry", status: "completed" },
            }),
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

    const startedAt = Date.now();
    const response = await adapter.complete({
      messages: [{ role: "user", content: "recover" }],
      tools: [],
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(calls).toBe(3);
    expect(response.content).toBe("Recovered");
  });

  test("retries raw fetch failures before surfacing network errors", async () => {
    let calls = 0;
    const fetchImpl = Object.assign(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw new TypeError("fetch failed");
        }
        return new Response(
          sse({
            type: "response.completed",
            response: { id: "resp_network", status: "completed" },
          }),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICodexModelAdapter({
      credentials: fakeCredentials(),
      model: "gpt-5.5",
      fetchImpl,
      retryPolicy: { initialDelayMs: 0 },
    });

    const response = await adapter.complete({
      messages: [{ role: "user", content: "recover" }],
      tools: [],
    });

    expect(calls).toBe(2);
    expect(response.finishReason).toBe("completed");
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
