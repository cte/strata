import type { JsonObject, JsonValue } from "@cortex/core";
import { listSkills, readSkill } from "@cortex/core";
import { optionalInteger, requiredNonEmptyString } from "./args.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

interface SkillsListArgs extends JsonObject {
  limit?: JsonValue;
}

interface SkillsReadArgs extends JsonObject {
  name?: JsonValue;
  maxChars?: JsonValue;
}

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_MAX_SKILL_CHARS = 24_000;
const MAX_SKILL_CHARS = 100_000;

export function registerSkillTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createSkillTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createSkillTools(): ToolDefinition[] {
  return [skillsListTool, skillsReadTool];
}

const skillsListTool: ToolDefinition<SkillsListArgs> = {
  name: "skills.list",
  description: "List Cortex procedural skills stored under .cortex/skills.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "integer", minimum: 1, maximum: MAX_LIST_LIMIT },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const limit = optionalInteger(args.limit, DEFAULT_LIST_LIMIT, "limit", 1, MAX_LIST_LIMIT);
    const skills = (await listSkills(context.repoRoot)).slice(0, limit);
    return { skills, count: skills.length };
  },
};

const skillsReadTool: ToolDefinition<SkillsReadArgs> = {
  name: "skills.read",
  description: "Read one Cortex procedural skill by name.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["name"],
    properties: {
      name: { type: "string" },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_SKILL_CHARS },
    },
  },
  maxResultChars: 64_000,
  async handler(args, context) {
    const name = requiredNonEmptyString(args.name, "name");
    const maxChars = optionalInteger(
      args.maxChars,
      DEFAULT_MAX_SKILL_CHARS,
      "maxChars",
      1,
      MAX_SKILL_CHARS,
    );
    const skill = await readSkill(context.repoRoot, name, maxChars);
    return { skill };
  },
};
