import { describe, expect, test } from "bun:test";
import { clampThinkingLevel, getSupportedThinkingLevels } from "../modelCapabilities.js";

describe("model thinking capabilities", () => {
  test("non-reasoning models only support off", () => {
    const capabilities = { reasoning: false };

    expect(getSupportedThinkingLevels(capabilities)).toEqual(["off"]);
    expect(clampThinkingLevel(capabilities, "high")).toBe("off");
  });

  test("Pi-compatible maps can disable and enable specific levels", () => {
    const capabilities = {
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: null, low: null, xhigh: "xhigh" },
    };

    expect(getSupportedThinkingLevels(capabilities)).toEqual(["medium", "high", "xhigh"]);
    expect(clampThinkingLevel(capabilities, "off")).toBe("medium");
    expect(clampThinkingLevel(capabilities, "minimal")).toBe("medium");
    expect(clampThinkingLevel(capabilities, "xhigh")).toBe("xhigh");
  });

  test("xhigh is unavailable unless explicitly mapped", () => {
    const capabilities = { reasoning: true };

    expect(getSupportedThinkingLevels(capabilities)).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(clampThinkingLevel(capabilities, "xhigh")).toBe("high");
  });
});
