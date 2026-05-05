import { describe, expect, test } from "bun:test";
import { initialAppState, nextThinkingLevel, recordModelUsage } from "./state.js";

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
