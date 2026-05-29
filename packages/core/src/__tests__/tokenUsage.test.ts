import { describe, expect, test } from "bun:test";
import {
  addTokenUsage,
  createTokenUsageTotals,
  hasTokenUsage,
  normalizeModelUsage,
} from "../tokenUsage.js";

describe("normalizeModelUsage", () => {
  test("returns undefined for an empty payload", () => {
    expect(normalizeModelUsage({})).toBeUndefined();
  });

  test("normalises Chat Completions shape", () => {
    expect(
      normalizeModelUsage({
        prompt_tokens: 1000,
        completion_tokens: 250,
        total_tokens: 1250,
      }),
    ).toEqual({
      input: 1000,
      output: 250,
      cacheRead: 0,
      cacheWrite: 0,
      total: 1250,
      cost: 0,
    });
  });

  test("normalises Responses shape", () => {
    expect(
      normalizeModelUsage({
        input_tokens: 1200,
        output_tokens: 300,
        total_tokens: 1500,
      }),
    ).toEqual({
      input: 1200,
      output: 300,
      cacheRead: 0,
      cacheWrite: 0,
      total: 1500,
      cost: 0,
    });
  });

  test("subtracts cache reads/writes from the input total", () => {
    const usage = normalizeModelUsage({
      prompt_tokens: 1000,
      completion_tokens: 100,
      prompt_tokens_details: { cached_tokens: 600, cache_write_tokens: 200 },
    });
    // input = 1000 - 400 cache_read - 200 cache_write = 400 (cache_read derived as 600 - 200).
    expect(usage).toEqual({
      input: 400,
      output: 100,
      cacheRead: 400,
      cacheWrite: 200,
      total: 1100,
      cost: 0,
    });
  });

  test("preserves an explicit cost field", () => {
    const usage = normalizeModelUsage({
      input_tokens: 100,
      output_tokens: 50,
      cost: 0.0123,
    });
    expect(usage?.cost).toBeCloseTo(0.0123, 4);
  });
});

describe("addTokenUsage", () => {
  test("sums field-by-field", () => {
    const a = { input: 10, output: 5, cacheRead: 1, cacheWrite: 2, total: 18, cost: 0.01 };
    const b = { input: 4, output: 2, cacheRead: 1, cacheWrite: 0, total: 7, cost: 0.005 };
    expect(addTokenUsage(a, b)).toEqual({
      input: 14,
      output: 7,
      cacheRead: 2,
      cacheWrite: 2,
      total: 25,
      cost: 0.015,
    });
  });
});

describe("createTokenUsageTotals", () => {
  test("returns a zeroed seed", () => {
    expect(createTokenUsageTotals()).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: 0,
    });
  });
});

describe("hasTokenUsage", () => {
  test("is false for the seed", () => {
    expect(hasTokenUsage(createTokenUsageTotals())).toBe(false);
  });

  test("is true when any field is non-zero", () => {
    expect(hasTokenUsage({ ...createTokenUsageTotals(), output: 1 })).toBe(true);
  });
});
