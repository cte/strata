import { describe, expect, test } from "bun:test";
import { normalizeChoice, parseStoredChatModelChoice } from "../useChatModelChoice.js";

describe("chat model choice", () => {
  test("parses valid localStorage choices only", () => {
    expect(
      parseStoredChatModelChoice(
        JSON.stringify({
          provider: "openai-codex",
          model: "gpt-5.5",
          reasoningEffort: "high",
        }),
      ),
    ).toEqual({
      provider: "openai-codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
    });
    expect(parseStoredChatModelChoice("{bad json")).toBeNull();
    expect(
      parseStoredChatModelChoice(
        JSON.stringify({
          provider: "other",
          model: "gpt-5.5",
          reasoningEffort: "high",
        }),
      ),
    ).toBeNull();
  });

  test("falls back to current status when persisted provider is unavailable", () => {
    expect(
      normalizeChoice(
        {
          provider: "openai-codex",
          model: "gpt-5.5",
          reasoningEffort: "medium",
        },
        {
          provider: "openai-compatible",
          model: "gpt-4o-mini",
          codexLoggedIn: false,
          apiKeyConfigured: true,
          anthropicLoggedIn: false,
          anthropicApiKeyConfigured: false,
        },
      ),
    ).toEqual({
      provider: "openai-compatible",
      model: "gpt-4o-mini",
      reasoningEffort: "medium",
    });
  });

  test("keeps available persisted choices", () => {
    const stored = {
      provider: "openai-compatible" as const,
      model: "gpt-5.5",
      reasoningEffort: "xhigh" as const,
    };
    expect(
      normalizeChoice(stored, {
        provider: "openai-compatible",
        model: "gpt-4o-mini",
        codexLoggedIn: false,
        apiKeyConfigured: true,
        anthropicLoggedIn: false,
        anthropicApiKeyConfigured: false,
      }),
    ).toBe(stored);
  });
});
