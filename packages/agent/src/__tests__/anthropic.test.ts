import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@strata/core";
import { createDefaultToolRegistry } from "@strata/tools";
import { AnthropicModelAdapter } from "../anthropic.js";
import type { AnthropicCredentials } from "../authStore.js";
import type { ThinkingLevel } from "../types.js";

describe("AnthropicModelAdapter", () => {
  test("uses adaptive thinking and output effort for Claude Opus 4.8", async () => {
    const body = await captureAnthropicRequestBody("claude-opus-4-8", "high");

    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "high" });
  });

  test("maps xhigh to Anthropic xhigh effort for Claude Opus 4.8", async () => {
    const body = await captureAnthropicRequestBody("claude-opus-4-8", "xhigh");

    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "xhigh" });
  });

  test("maps xhigh to Anthropic max effort for Claude Opus 4.6", async () => {
    const body = await captureAnthropicRequestBody("claude-opus-4-6", "xhigh");

    expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(body.output_config).toEqual({ effort: "max" });
  });

  test("sends explicit disabled thinking for Claude reasoning models when thinking is off", async () => {
    const body = await captureAnthropicRequestBody("claude-opus-4-8", "off");

    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.output_config).toBeUndefined();
  });

  test("uses budget-based thinking for non-adaptive Claude 4 reasoning models", async () => {
    const body = await captureAnthropicRequestBody("claude-opus-4-5", "medium");

    expect(body.thinking).toEqual({
      type: "enabled",
      budget_tokens: 8192,
      display: "summarized",
    });
    expect(body.output_config).toBeUndefined();
  });

  test("parses streamed tool input deltas without prefixing Anthropic's initial empty object", async () => {
    const response = await completeFromAnthropicEvents([
      sse({ type: "message_start", message: { id: "msg_1" } }),
      sse({
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "shell_run",
          input: {},
        },
      }),
      sse({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"command":' },
      }),
      sse({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"ls ../pi-mono 2>&1 | head -50"}' },
      }),
      sse({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
      sse({ type: "message_stop" }),
    ]);

    expect(response.toolCalls).toEqual([
      {
        id: "toolu_1",
        name: "shell.run",
        argumentsText: JSON.stringify({ command: "ls ../pi-mono 2>&1 | head -50" }),
      },
    ]);
    expect(response.finishReason).toBe("tool_calls");
  });

  test("streams thinking deltas and captures the block signature", async () => {
    const reasoningDeltas: string[] = [];
    const fetchImpl = Object.assign(
      async () =>
        new Response(
          [
            sse({ type: "message_start", message: { id: "msg_t" } }),
            sse({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
            sse({
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "Let me " },
            }),
            sse({
              type: "content_block_delta",
              index: 0,
              delta: { type: "thinking_delta", thinking: "think about it." },
            }),
            sse({
              type: "content_block_delta",
              index: 0,
              delta: { type: "signature_delta", signature: "SIGN" },
            }),
            sse({ type: "content_block_start", index: 1, content_block: { type: "text" } }),
            sse({
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: "Here." },
            }),
            sse({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
            sse({ type: "message_stop" }),
          ].join(""),
          { status: 200 },
        ),
      { preconnect: fetch.preconnect },
    ) satisfies typeof fetch;

    const adapter = new AnthropicModelAdapter({
      credentials: fakeCredentials(),
      model: "claude-opus-4-8",
      fetchImpl,
    });

    const response = await adapter.complete({
      messages: [{ role: "user", content: "Think." }],
      tools: [],
      reasoningEffort: "high",
      onReasoningDelta: (delta) => reasoningDeltas.push(delta),
    });

    expect(reasoningDeltas).toEqual(["Let me ", "think about it."]);
    expect(response.reasoning).toBe("Let me think about it.");
    expect(response.reasoningSignature).toBe("SIGN");
    expect(response.content).toBe("Here.");
  });

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

async function completeFromAnthropicEvents(events: string[]) {
  const fetchImpl = Object.assign(async () => new Response(events.join(""), { status: 200 }), {
    preconnect: fetch.preconnect,
  }) satisfies typeof fetch;

  const adapter = new AnthropicModelAdapter({
    credentials: fakeCredentials(),
    model: "claude-opus-4-8",
    fetchImpl,
  });

  return adapter.complete({
    messages: [{ role: "user", content: "List files." }],
    tools: createDefaultToolRegistry().list(),
    reasoningEffort: "xhigh",
  });
}

async function captureAnthropicRequestBody(
  model: string,
  reasoningEffort?: ThinkingLevel,
): Promise<JsonObject> {
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
    model,
    fetchImpl,
  });

  await adapter.complete({
    messages: [{ role: "user", content: "Hello" }],
    tools: [],
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  });

  if (capturedBody === undefined) {
    throw new Error("Expected Anthropic request body to be captured");
  }
  return capturedBody;
}

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
