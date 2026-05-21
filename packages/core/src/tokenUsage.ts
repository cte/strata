import type { TokenUsage } from "./types.js";

/**
 * Convert a provider-specific raw `usage` payload into Strata's canonical
 * `TokenUsage`. Returns `undefined` when the raw payload is empty (no token
 * counts present); callers should treat that as "no usage data" rather than
 * "zero usage".
 *
 * Supports both Chat Completions (`prompt_tokens`/`completion_tokens`) and
 * Responses-style (`input_tokens`/`output_tokens`) shapes plus their cached-
 * tokens nested fields. Keep this server-side and browser-safe — no Bun-only
 * APIs.
 */
export function normalizeModelUsage(rawUsage: Record<string, unknown>): TokenUsage | undefined {
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

/** Empty totals used as a session-aggregation seed. */
export function createTokenUsageTotals(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 };
}

/** Add a per-turn `TokenUsage` onto a running aggregate. Pure; returns a new value. */
export function addTokenUsage(totals: TokenUsage, turn: TokenUsage): TokenUsage {
  return {
    input: totals.input + turn.input,
    output: totals.output + turn.output,
    cacheRead: totals.cacheRead + turn.cacheRead,
    cacheWrite: totals.cacheWrite + turn.cacheWrite,
    total: totals.total + turn.total,
    cost: totals.cost + turn.cost,
  };
}

/** True if any field of the usage record is non-zero. */
export function hasTokenUsage(usage: TokenUsage): boolean {
  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.total > 0 ||
    usage.cost > 0
  );
}

function firstNumber(object: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function numberAt(object: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = object;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
