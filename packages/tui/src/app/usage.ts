import type { JsonObject, JsonValue } from "@strata/core";

export interface TokenUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
  latestContextTokens: number | undefined;
}

interface NormalizedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}

export function createTokenUsageTotals(): TokenUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    cost: 0,
    latestContextTokens: undefined,
  };
}

export function resetTokenUsage(totals: TokenUsageTotals): void {
  totals.input = 0;
  totals.output = 0;
  totals.cacheRead = 0;
  totals.cacheWrite = 0;
  totals.total = 0;
  totals.cost = 0;
  totals.latestContextTokens = undefined;
}

export function addModelUsage(totals: TokenUsageTotals, rawUsage: JsonObject | undefined): void {
  if (rawUsage === undefined) {
    return;
  }
  const usage = normalizeModelUsage(rawUsage);
  if (usage === undefined) {
    return;
  }
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.total += usage.total;
  totals.cost += usage.cost;
  totals.latestContextTokens = usage.total;
}

export function formatTokens(count: number): string {
  if (count < 1000) {
    return Math.round(count).toString();
  }
  if (count < 10_000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  if (count < 1_000_000) {
    return `${Math.round(count / 1000)}k`;
  }
  if (count < 10_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(count / 1_000_000)}M`;
}

export function contextWindowForModel(provider: string, model: string): number | undefined {
  const override = parsePositiveInteger(
    Bun.env.STRATA_CONTEXT_WINDOW ?? Bun.env.STRATA_MODEL_CONTEXT_WINDOW,
  );
  if (override !== undefined) {
    return override;
  }

  if (provider === "anthropic-claude") {
    if (model.includes("opus-4-7") || model.includes("sonnet-4-6")) {
      return 1_000_000;
    }
    return 200_000;
  }

  if (provider === "openai-codex") {
    if (model === "gpt-5.3-codex-spark") {
      return 128_000;
    }
    if (model.startsWith("gpt-5.")) {
      return 272_000;
    }
  }

  if (model === "gpt-5.5" || model === "gpt-5.5-pro") {
    return 1_000_000;
  }
  if (model === "gpt-5.4" || model === "gpt-5.4-pro") {
    return 272_000;
  }
  if (model.startsWith("gpt-5.4-") || model.startsWith("gpt-5.3-codex")) {
    return 400_000;
  }
  if (
    model.startsWith("gpt-4.1") ||
    model.startsWith("gpt-4o") ||
    model.startsWith("o3") ||
    model.startsWith("o4")
  ) {
    return 128_000;
  }
  if (model.startsWith("o1")) {
    return 200_000;
  }
  return undefined;
}

function normalizeModelUsage(rawUsage: JsonObject): NormalizedUsage | undefined {
  const rawInput =
    firstNumber(rawUsage, "input_tokens", "prompt_tokens", "input", "promptTokens") ?? 0;
  const output =
    firstNumber(rawUsage, "output_tokens", "completion_tokens", "output", "completionTokens") ?? 0;
  const reportedCacheRead =
    numberAt(rawUsage, ["input_tokens_details", "cached_tokens"]) ??
    numberAt(rawUsage, ["prompt_tokens_details", "cached_tokens"]) ??
    firstNumber(rawUsage, "cache_read_input_tokens", "cacheRead", "cache_read") ??
    0;
  const cacheWrite =
    numberAt(rawUsage, ["prompt_tokens_details", "cache_write_tokens"]) ??
    firstNumber(
      rawUsage,
      "cache_creation_input_tokens",
      "cache_write_input_tokens",
      "cacheWrite",
      "cache_write",
    ) ??
    0;
  const cacheRead =
    cacheWrite > 0 ? Math.max(0, reportedCacheRead - cacheWrite) : reportedCacheRead;
  const input = Math.max(0, rawInput - cacheRead - cacheWrite);
  const computedTotal = input + output + cacheRead + cacheWrite;
  const total = firstNumber(rawUsage, "total_tokens", "totalTokens", "total") ?? computedTotal;
  const cost = numberAt(rawUsage, ["cost", "total"]) ?? firstNumber(rawUsage, "cost") ?? 0;
  const hasUsage = rawInput > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0 || total > 0;
  if (!hasUsage) {
    return undefined;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    cost,
  };
}

function firstNumber(object: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function numberAt(object: JsonObject, path: string[]): number | undefined {
  let current: JsonValue = object;
  for (const key of path) {
    if (!isJsonObject(current)) {
      return undefined;
    }
    const nextValue = current[key] as JsonValue | undefined;
    if (nextValue === undefined) {
      return undefined;
    }
    current = nextValue;
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
