import type { ThinkingLevel } from "./types.js";

export interface ModelCapabilities {
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}

export const EXTENDED_THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export function getModelCapabilities(provider: string, model: string): ModelCapabilities {
  if (provider === "anthropic-claude") {
    return anthropicCapabilities(model);
  }
  if (provider === "openai-codex") {
    return openAiCodexCapabilities(model);
  }
  return openAiCompatibleCapabilities(model);
}

export function getSupportedThinkingLevels(capabilities: ModelCapabilities): ThinkingLevel[] {
  if (!capabilities.reasoning) return ["off"];

  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = capabilities.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh") return mapped !== undefined;
    return true;
  });
}

export function clampThinkingLevel(
  capabilities: ModelCapabilities,
  level: ThinkingLevel,
): ThinkingLevel {
  const availableLevels = getSupportedThinkingLevels(capabilities);
  if (availableLevels.includes(level)) return level;

  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
  if (requestedIndex === -1) return availableLevels[0] ?? "off";

  for (let i = requestedIndex; i < EXTENDED_THINKING_LEVELS.length; i += 1) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (candidate !== undefined && availableLevels.includes(candidate)) return candidate;
  }
  for (let i = requestedIndex - 1; i >= 0; i -= 1) {
    const candidate = EXTENDED_THINKING_LEVELS[i];
    if (candidate !== undefined && availableLevels.includes(candidate)) return candidate;
  }
  return availableLevels[0] ?? "off";
}

export function mapThinkingLevel(
  capabilities: Pick<ModelCapabilities, "thinkingLevelMap">,
  level: ThinkingLevel,
): string | null | undefined {
  return capabilities.thinkingLevelMap?.[level];
}

function openAiCodexCapabilities(model: string): ModelCapabilities {
  if (isOpenAiReasoningModel(model)) {
    return {
      reasoning: true,
      // Pi's OpenAI Codex registry maps minimal to low and xhigh to native xhigh.
      thinkingLevelMap: { xhigh: "xhigh", minimal: "low" },
    };
  }
  return { reasoning: false };
}

function openAiCompatibleCapabilities(model: string): ModelCapabilities {
  if (!isOpenAiReasoningModel(model)) {
    return { reasoning: false };
  }

  if (model === "gpt-5.5" || model === "gpt-5.4" || model.startsWith("gpt-5.4-")) {
    return { reasoning: true, thinkingLevelMap: { off: null, xhigh: "xhigh" } };
  }
  if (model === "gpt-5.5-pro") {
    return {
      reasoning: true,
      thinkingLevelMap: { off: null, xhigh: "xhigh", minimal: null, low: null },
    };
  }

  return { reasoning: true };
}

function anthropicCapabilities(model: string): ModelCapabilities {
  if (!supportsAnthropicThinking(model)) {
    return { reasoning: false };
  }
  if (/opus[-.]4[-.]6/i.test(model)) {
    return { reasoning: true, thinkingLevelMap: { xhigh: "max" } };
  }
  if (/opus[-.]4[-.][78]/i.test(model)) {
    return { reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } };
  }
  return { reasoning: true };
}

export function supportsAnthropicThinking(model: string): boolean {
  return /(?:claude[-.]|anthropic[./])?(?:haiku|opus|sonnet)[-.]4(?:[-.]|\b)/i.test(model);
}

function isOpenAiReasoningModel(model: string): boolean {
  return /^(?:o\d|gpt-5(?:\.|-|$)|gpt-oss(?:-|$)|codex(?:-|$))/i.test(model);
}
