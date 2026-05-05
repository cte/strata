import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@cortex/core";
import { createDefaultToolRegistry } from "@cortex/tools";
import { OpenAICompatibleChatModelAdapter } from "./openaiCompatible.js";

describe("OpenAICompatibleChatModelAdapter", () => {
  test("encodes provider tool names and decodes canonical tool calls", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const init = args[1];
        capturedBody = JSON.parse(String(init?.body)) as JsonObject;
        return new Response(
          JSON.stringify({
            id: "chatcmpl_test",
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "wiki_readPage",
                        arguments: '{"path":"index.md"}',
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICompatibleChatModelAdapter({
      apiKey: "test",
      model: "test-model",
      fetchImpl,
    });
    const response = await adapter.complete({
      messages: [{ role: "user", content: "Read index" }],
      tools: createDefaultToolRegistry().list(),
    });

    expect(response.providerResponseId).toBe("chatcmpl_test");
    expect(response.toolCalls).toEqual([
      {
        id: "call_1",
        name: "wiki.readPage",
        argumentsText: '{"path":"index.md"}',
      },
    ]);
    expect(capturedBody?.parallel_tool_calls).toBe(false);
    expect(JSON.stringify(capturedBody)).toContain("wiki_readPage");
    expect(JSON.stringify(capturedBody)).not.toContain("wiki.readPage");
  });

  test("encodes image attachments as image_url content parts", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return new Response(
          JSON.stringify({
            id: "chatcmpl_x",
            choices: [
              { finish_reason: "stop", message: { content: "ok", tool_calls: [] } },
            ],
          }),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICompatibleChatModelAdapter({
      apiKey: "test",
      model: "test-model",
      fetchImpl,
    });
    await adapter.complete({
      messages: [
        {
          role: "user",
          content: "What is in this image?",
          attachments: [
            { kind: "image", mimeType: "image/png", dataBase64: "AAAA", name: "shot.png" },
          ],
        },
      ],
      tools: [],
    });

    const messages = (capturedBody as { messages: { role: string; content: unknown }[] }).messages;
    const userMessage = messages.find((m) => m.role === "user");
    expect(Array.isArray(userMessage?.content)).toBe(true);
    const parts = userMessage?.content as { type: string; image_url?: { url: string }; text?: string }[];
    expect(parts[0]).toEqual({ type: "text", text: "What is in this image?" });
    expect(parts[1]?.type).toBe("image_url");
    expect(parts[1]?.image_url?.url).toBe("data:image/png;base64,AAAA");
  });

  test("plain text messages still use a string content (no parts)", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return new Response(
          JSON.stringify({
            id: "x",
            choices: [{ finish_reason: "stop", message: { content: "ok", tool_calls: [] } }],
          }),
          { status: 200 },
        );
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICompatibleChatModelAdapter({
      apiKey: "k",
      model: "m",
      fetchImpl,
    });
    await adapter.complete({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
    const messages = (capturedBody as { messages: { role: string; content: unknown }[] }).messages;
    expect(typeof messages.find((m) => m.role === "user")?.content).toBe("string");
  });
});
