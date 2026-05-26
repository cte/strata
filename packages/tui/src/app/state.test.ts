import { describe, expect, test } from "bun:test";
import {
  appendAssistantDelta,
  finalizeAssistantStream,
  initialAppState,
  nextThinkingLevel,
  recordModelUsage,
} from "./state.js";

describe("nextThinkingLevel", () => {
  test("cycles through pi's level set in order", () => {
    expect(nextThinkingLevel("off")).toBe("minimal");
    expect(nextThinkingLevel("minimal")).toBe("low");
    expect(nextThinkingLevel("low")).toBe("medium");
    expect(nextThinkingLevel("medium")).toBe("high");
    expect(nextThinkingLevel("high")).toBe("xhigh");
    expect(nextThinkingLevel("xhigh")).toBe("off");
  });
});

describe("recordModelUsage", () => {
  test("normalizes OpenAI responses usage into pi-style token buckets", () => {
    const state = initialAppState("openai-codex", "gpt-5.5", {
      codexLoggedIn: false,
      anthropicLoggedIn: false,
      apiKeyConfigured: false,
    });

    recordModelUsage(state, {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      input_tokens_details: { cached_tokens: 25 },
    });

    expect(state.usage.input).toBe(75);
    expect(state.usage.output).toBe(20);
    expect(state.usage.cacheRead).toBe(25);
    expect(state.usage.cacheWrite).toBe(0);
    expect(state.usage.latestContextTokens).toBe(120);
    expect(state.contextWindow).toBe(272_000);
  });

  test("normalizes chat completions usage with cache writes", () => {
    const state = initialAppState("openai-compatible", "gpt-4o", {
      codexLoggedIn: false,
      anthropicLoggedIn: false,
      apiKeyConfigured: true,
    });

    recordModelUsage(state, {
      prompt_tokens: 150,
      completion_tokens: 30,
      total_tokens: 180,
      prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 10 },
    });

    expect(state.usage.input).toBe(100);
    expect(state.usage.output).toBe(30);
    expect(state.usage.cacheRead).toBe(40);
    expect(state.usage.cacheWrite).toBe(10);
    expect(state.usage.latestContextTokens).toBe(180);
    expect(state.contextWindow).toBe(128_000);
  });
});

describe("assistant streaming", () => {
  function makeState() {
    return initialAppState("openai-codex", "gpt-5.5", {
      codexLoggedIn: false,
      anthropicLoggedIn: false,
      apiKeyConfigured: false,
    });
  }

  test("first delta creates a streaming item; subsequent deltas extend it in place", () => {
    const state = makeState();
    appendAssistantDelta(state, 1, "Hel");
    appendAssistantDelta(state, 1, "lo, ");
    appendAssistantDelta(state, 1, "world");

    expect(state.transcript).toHaveLength(1);
    const item = state.transcript[0];
    expect(item).toMatchObject({
      kind: "assistant",
      iteration: 1,
      content: "Hello, world",
      streaming: true,
    });
  });

  test("a new iteration's deltas open a new transcript item rather than appending to the prior one", () => {
    const state = makeState();
    appendAssistantDelta(state, 1, "first");
    finalizeAssistantStream(state, 1, "first");
    appendAssistantDelta(state, 2, "second");

    expect(state.transcript).toHaveLength(2);
    const [first, second] = state.transcript;
    expect(first).toMatchObject({ iteration: 1, content: "first", streaming: false });
    expect(second).toMatchObject({ iteration: 2, content: "second", streaming: true });
  });

  test("finalize replaces streamed content with the canonical model text and clears the streaming flag", () => {
    const state = makeState();
    appendAssistantDelta(state, 1, "partial");
    finalizeAssistantStream(state, 1, "partial-final-version");

    expect(state.transcript).toHaveLength(1);
    expect(state.transcript[0]).toMatchObject({
      kind: "assistant",
      content: "partial-final-version",
      streaming: false,
    });
  });

  test("finalize with no deltas (tool-only iteration) does not push an empty assistant item", () => {
    const state = makeState();
    finalizeAssistantStream(state, 1, "");
    expect(state.transcript).toHaveLength(0);
  });

  test("finalize with no prior deltas but real content appends a fresh item", () => {
    const state = makeState();
    finalizeAssistantStream(state, 1, "non-streamed answer");
    expect(state.transcript).toHaveLength(1);
    const item = state.transcript[0];
    expect(item?.kind).toBe("assistant");
    expect(item?.kind === "assistant" && item.content).toBe("non-streamed answer");
    expect(item?.kind === "assistant" && item.streaming).toBeUndefined();
  });
});
