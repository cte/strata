import { describe, expect, test } from "bun:test";
import { createSkillCommandProvider, findSkillCommandToken } from "../skillCommandProvider";

describe("skillCommandProvider", () => {
  test("detects /skill tokens", () => {
    expect(findSkillCommandToken("/skill:diag", "/skill:diag".length)).toEqual({
      query: "diag",
      replaceStart: 0,
      replaceEnd: "/skill:diag".length,
    });
    expect(findSkillCommandToken("say /skill:diag", "say /skill:diag".length)).toBeUndefined();
    expect(findSkillCommandToken("/skill:diag now", "/skill:diag now".length)).toBeUndefined();
  });

  test("provides skill slash command suggestions", async () => {
    const provider = createSkillCommandProvider({
      listSkills: async () => [
        {
          name: "diagnose",
          description: "Debug carefully",
          path: ".agents/skills/diagnose/SKILL.md",
          source: "agents",
          disableModelInvocation: false,
        },
      ],
    });
    const suggestions = await provider.provide({
      text: "/skill:dia",
      cursor: "/skill:dia".length,
      signal: new AbortController().signal,
    });
    expect(suggestions).toMatchObject({
      replaceStart: 0,
      replaceEnd: "/skill:dia".length,
      items: [
        {
          label: "/skill:diagnose",
          value: "/skill:diagnose",
          description: "Debug carefully",
          kind: "command",
        },
      ],
    });
  });
});
