import {
  addTokenUsage,
  createTokenUsageTotals as createTotals,
  hasTokenUsage as hasUsage,
  normalizeModelUsage,
} from "@strata/core/token-usage";
import type { TokenUsage as CoreTokenUsage } from "@strata/core/types";
import type { StartChatRunRequest } from "@/lib/api";

export type TokenUsage = CoreTokenUsage;

export interface TokenUsageTotals extends CoreTokenUsage {
  /** Most recent per-turn `total` (the model's prompt+output count after that response). */
  latestContextTokens?: number;
}

export type ChatProviderName = NonNullable<StartChatRunRequest["provider"]>;

export function createTokenUsageTotals(): TokenUsageTotals {
  return createTotals();
}

export function accumulateTokenUsage(
  totals: TokenUsageTotals,
  rawUsage: Record<string, unknown> | undefined,
): TokenUsageTotals {
  if (rawUsage === undefined) {
    return totals;
  }
  const usage = normalizeModelUsage(rawUsage);
  if (usage === undefined) {
    return totals;
  }
  return { ...addTokenUsage(totals, usage), latestContextTokens: usage.total };
}

/**
 * Seed the running aggregate from a session's persisted per-message usage,
 * preserving the most recent turn's `total` as `latestContextTokens` so the
 * context-window indicator stays accurate after a session reload.
 */
export function totalsFromMessageUsages(usages: readonly CoreTokenUsage[]): TokenUsageTotals {
  const totals = createTotals();
  if (usages.length === 0) {
    return totals;
  }
  const sum = usages.reduce<TokenUsage>((acc, turn) => addTokenUsage(acc, turn), totals);
  const last = usages[usages.length - 1];
  return last === undefined ? sum : { ...sum, latestContextTokens: last.total };
}

export function usageTotalsFromMessages(
  messages: readonly { usage?: TokenUsage | null }[],
): TokenUsageTotals {
  return totalsFromMessageUsages(
    messages
      .map((message) => message.usage)
      .filter((usage): usage is CoreTokenUsage => usage !== undefined && usage !== null),
  );
}

export function hasTokenUsage(totals: TokenUsageTotals): boolean {
  return hasUsage(totals) || totals.latestContextTokens !== undefined;
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

export function contextWindowForModel(
  provider: ChatProviderName,
  model: string,
): number | undefined {
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

export function contextUsagePercent(
  latestContextTokens: number | undefined,
  contextWindow: number | undefined,
): number | undefined {
  if (latestContextTokens === undefined || contextWindow === undefined || contextWindow <= 0) {
    return undefined;
  }
  return (latestContextTokens / contextWindow) * 100;
}

export { normalizeModelUsage } from "@strata/core/token-usage";
