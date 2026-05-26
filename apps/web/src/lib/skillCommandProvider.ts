import { type ChatSkillEntry, listChatSkills } from "@/lib/api";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@/lib/useAutocomplete";

const MAX_SKILL_SUGGESTIONS = 40;
const SKILL_PREFIX = "/skill:";

export interface SkillCommandProviderOptions {
  limit?: number;
  listSkills?: (query: string, limit: number) => Promise<ChatSkillEntry[]>;
}

export interface SkillCommandToken {
  query: string;
  replaceStart: number;
  replaceEnd: number;
}

export function createSkillCommandProvider(
  options: SkillCommandProviderOptions = {},
): AutocompleteProvider {
  const limit = options.limit ?? MAX_SKILL_SUGGESTIONS;
  const listSkills = options.listSkills ?? listChatSkills;
  return {
    id: "skill-commands",
    async provide({ text, cursor, signal }): Promise<AutocompleteSuggestions | undefined> {
      const token = findSkillCommandToken(text, cursor);
      if (token === undefined || signal.aborted) {
        return undefined;
      }
      const skills = await listSkills(token.query, limit);
      if (signal.aborted || skills.length === 0) {
        return undefined;
      }
      return {
        replaceStart: token.replaceStart,
        replaceEnd: token.replaceEnd,
        items: skills.map((skill) => ({
          label: `/skill:${skill.name}`,
          value: `/skill:${skill.name}`,
          description: skill.description === "" ? skill.path : skill.description,
          kind: "command",
        })),
      };
    },
  };
}

export function findSkillCommandToken(text: string, cursor: number): SkillCommandToken | undefined {
  const before = text.slice(0, cursor);
  if (!before.startsWith(SKILL_PREFIX) || before.includes("\n")) {
    return undefined;
  }
  const afterPrefix = before.slice(SKILL_PREFIX.length);
  if (/\s/.test(afterPrefix)) {
    return undefined;
  }
  return {
    query: afterPrefix,
    replaceStart: 0,
    replaceEnd: cursor,
  };
}
