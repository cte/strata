import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@strata/core";
import { createDefaultToolRegistry } from "@strata/tools";
import { OpenAICompatibleChatModelAdapter } from "../openaiCompatible.js";

/**
 * Build an SSE-formatted response body from a list of pre-parsed chunks.
 * Each chunk becomes a `data: <json>\n\n` frame, terminated by `data: [DONE]`.
 */
function makeSseResponse(chunks: object[]): Response {
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("OpenAICompatibleChatModelAdapter", () => {
  test("uses OpenAI-style reasoning only for reasoning-capable models", async () => {
    const captured: JsonObject[] = [];
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        captured.push(JSON.parse(String(args[1]?.body)) as JsonObject);
        return makeSseResponse([
          { id: "x", choices: [{ delta: { content: "ok" } }] },
          { id: "x", choices: [{ delta: {}, finish_reason: "stop" }] },
        ]);
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const reasoning = new OpenAICompatibleChatModelAdapter({
      apiKey: "k",
      model: "gpt-5.5",
      fetchImpl,
    });
    await reasoning.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      reasoningEffort: "xhigh",
    });

    const nonReasoning = new OpenAICompatibleChatModelAdapter({
      apiKey: "k",
      model: "gpt-4o-mini",
      fetchImpl,
    });
    await nonReasoning.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      reasoningEffort: "high",
    });

    expect(captured[0]?.reasoning_effort).toBe("xhigh");
    expect(captured[1]?.reasoning_effort).toBeUndefined();
  });

  test("uses OpenRouter's nested reasoning shape", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return makeSseResponse([
          { id: "x", choices: [{ delta: { content: "ok" } }] },
          { id: "x", choices: [{ delta: {}, finish_reason: "stop" }] },
        ]);
      },
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICompatibleChatModelAdapter({
      apiKey: "k",
      model: "gpt-5.5",
      baseUrl: "https://openrouter.ai/api/v1",
      fetchImpl,
    });
    await adapter.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      reasoningEffort: "high",
    });

    expect(capturedBody?.reasoning).toEqual({ effort: "high" });
    expect(capturedBody?.reasoning_effort).toBeUndefined();
  });

  test("streams text deltas, accumulates content, and reports usage", async () => {
    const fetchImpl = Object.assign(
      async () =>
        makeSseResponse([
          { id: "chatcmpl_x", choices: [{ delta: { content: "Hel" } }] },
          { id: "chatcmpl_x", choices: [{ delta: { content: "lo, " } }] },
          { id: "chatcmpl_x", choices: [{ delta: { content: "world" } }] },
          { id: "chatcmpl_x", choices: [{ delta: {}, finish_reason: "stop" }] },
          {
            id: "chatcmpl_x",
            choices: [],
            usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
          },
        ]),
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new OpenAICompatibleChatModelAdapter({
      apiKey: "test",
      model: "test-model",
      fetchImpl,
    });

    const seen: string[] = [];
    const response = await adapter.complete({
      messages: [{ role: "user", content: "say hi" }],
      tools: [],
      onAssistantDelta: (delta) => seen.push(delta),
    });

    expect(seen).toEqual(["Hel", "lo, ", "world"]);
    expect(response.content).toBe("Hello, world");
    expect(response.toolCalls).toEqual([]);
    expect(response.finishReason).toBe("stop");
    expect(response.providerResponseId).toBe("chatcmpl_x");
    expect(response.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
  });

  test("encodes provider tool names and decodes streamed tool-call argument deltas", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        // Pi-style tool-call streaming: id + name on the first chunk, then
        // `arguments` arrives in fragments, demuxed by `index`.
        return makeSseResponse([
          {
            id: "chatcmpl_test",
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "wiki_readPage", arguments: '{"pa' },
                    },
                  ],
                },
              },
            ],
          },
          {
            id: "chatcmpl_test",
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: 'th":"index.md"}' } }],
                },
              },
            ],
          },
          { id: "chatcmpl_test", choices: [{ delta: {}, finish_reason: "tool_calls" }] },
          {
            id: "chatcmpl_test",
            choices: [],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]);
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
    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toEqual([
      {
        id: "call_1",
        name: "wiki.readPage",
        argumentsText: '{"path":"index.md"}',
      },
    ]);
    expect(capturedBody?.stream).toBe(true);
    expect(capturedBody?.parallel_tool_calls).toBe(true);
    expect(JSON.stringify(capturedBody)).toContain("wiki_readPage");
    expect(JSON.stringify(capturedBody)).not.toContain("wiki.readPage");
  });

  test("encodes image attachments as image_url content parts", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return makeSseResponse([
          { id: "chatcmpl_x", choices: [{ delta: { content: "ok" } }] },
          { id: "chatcmpl_x", choices: [{ delta: {}, finish_reason: "stop" }] },
        ]);
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
    const parts = userMessage?.content as {
      type: string;
      image_url?: { url: string };
      text?: string;
    }[];
    expect(parts[0]).toEqual({ type: "text", text: "What is in this image?" });
    expect(parts[1]?.type).toBe("image_url");
    expect(parts[1]?.image_url?.url).toBe("data:image/png;base64,AAAA");
  });

  test("plain text messages still use a string content (no parts)", async () => {
    let capturedBody: JsonObject | undefined;
    const fetchImpl = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        capturedBody = JSON.parse(String(args[1]?.body)) as JsonObject;
        return makeSseResponse([
          { id: "x", choices: [{ delta: { content: "ok" } }] },
          { id: "x", choices: [{ delta: {}, finish_reason: "stop" }] },
        ]);
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
