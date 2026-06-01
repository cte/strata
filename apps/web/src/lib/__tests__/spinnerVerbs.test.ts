import { describe, expect, test } from "bun:test";
import { SPINNER_VERBS, spinnerVerbForTurn, spinnerVerbForTurnCycle } from "../spinnerVerbs.js";

describe("spinner verbs", () => {
  test("includes the Claude Code status vocabulary", () => {
    expect(SPINNER_VERBS).toContain("Puttering");
    expect(SPINNER_VERBS).toContain("Recombobulating");
    expect(SPINNER_VERBS.length).toBeGreaterThan(150);
  });

  test("picks a stable verb for a turn seed", () => {
    expect(spinnerVerbForTurn("run-a")).toBe(spinnerVerbForTurn("run-a"));
  });

  test("rotates to deterministic replacement verbs for later cycles", () => {
    expect(spinnerVerbForTurnCycle("run-a", 0)).toBe(spinnerVerbForTurn("run-a"));
    expect(spinnerVerbForTurnCycle("run-a", 1)).toBe(spinnerVerbForTurnCycle("run-a", 1));
    expect(spinnerVerbForTurnCycle("run-a", 1)).not.toBe(spinnerVerbForTurnCycle("run-a", 0));
  });
});
