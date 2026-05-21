import { describe, expect, test } from "bun:test";
import {
  accumulateTokenUsage,
  contextUsagePercent,
  contextWindowForModel,
  createTokenUsageTotals,
  formatTokens,
  normalizeModelUsage,
} from "../src/lib/chatUsage.js";

describe("chat usage", () => {
  test("normalizes OpenAI responses usage into token buckets", () => {
    expect(
      normalizeModelUsage({
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 25 },
      }),
    ).toEqual({
      input: 75,
      output: 20,
      cacheRead: 25,
      cacheWrite: 0,
      total: 120,
      cost: 0,
    });
  });

  test("normalizes chat-completions usage with cache writes", () => {
    expect(
      normalizeModelUsage({
        prompt_tokens: 150,
        completion_tokens: 30,
        total_tokens: 180,
        prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 10 },
      }),
    ).toEqual({
      input: 100,
      output: 30,
      cacheRead: 40,
      cacheWrite: 10,
      total: 180,
      cost: 0,
    });
  });

  test("accumulates totals and records latest context tokens", () => {
    const first = accumulateTokenUsage(createTokenUsageTotals(), {
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
    });
    const second = accumulateTokenUsage(first, {
      input_tokens: 50,
      output_tokens: 10,
      total_tokens: 60,
    });
    expect(second.input).toBe(150);
    expect(second.output).toBe(30);
    expect(second.total).toBe(180);
    expect(second.latestContextTokens).toBe(60);
  });

  test("formats tokens and computes context windows", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_250)).toBe("1.3k");
    expect(formatTokens(272_000)).toBe("272k");
    expect(contextWindowForModel("openai-codex", "gpt-5.5")).toBe(272_000);
    expect(contextWindowForModel("openai-compatible", "gpt-4o-mini")).toBe(128_000);
    expect(contextUsagePercent(64_000, 128_000)).toBe(50);
  });
});
