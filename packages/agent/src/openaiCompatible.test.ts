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
});
