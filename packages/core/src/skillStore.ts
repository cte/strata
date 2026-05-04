import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getCortexPaths } from "./paths.js";
import { CortexStateError } from "./stateErrors.js";
import type { JsonObject } from "./types.js";

export interface SkillMetadata extends JsonObject {
  name: string;
  directory: string;
  path: string;
  description: string;
  status: string;
  triggers: string[];
}

export interface SkillDocument extends JsonObject {
  metadata: SkillMetadata;
  content: string;
  chars: number;
  truncated: boolean;
}

const SKILL_FILE = "SKILL.md";

export async function listSkills(repoRoot: string): Promise<SkillMetadata[]> {
  const skillsDir = getCortexPaths(repoRoot).skillsDir;
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = entry.name;
        const skillPath = skillDocumentPath(repoRoot, directory);
        try {
          const content = await readFile(skillPath, "utf8");
          return parseSkillMetadata(repoRoot, directory, content);
        } catch (error: unknown) {
          if (isNotFoundError(error)) {
            return undefined;
          }
          throw error;
        }
      }),
  );

  return skills
    .filter((skill): skill is SkillMetadata => skill !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function readSkill(
  repoRoot: string,
  name: string,
  maxChars = 24_000,
): Promise<SkillDocument> {
  assertSkillName(name);
  const skillPath = skillDocumentPath(repoRoot, name);
  const content = await readFile(skillPath, "utf8");
  const truncated = content.length > maxChars;
  return {
    metadata: parseSkillMetadata(repoRoot, name, content),
    content: truncated ? content.slice(0, maxChars) : content,
    chars: content.length,
    truncated,
  };
}

export function skillDocumentPath(repoRoot: string, name: string): string {
  assertSkillName(name);
  return path.join(getCortexPaths(repoRoot).skillsDir, name, SKILL_FILE);
}

export function assertSkillName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new CortexStateError(
      "invalid_skill_name",
      "Skill name must be a lowercase directory name without path separators",
    );
  }
}

function parseSkillMetadata(repoRoot: string, directory: string, content: string): SkillMetadata {
  const frontmatter = readFrontmatter(content);
  const name = frontmatter.name ?? directory;
  const description = frontmatter.description ?? "";
  const status = frontmatter.status ?? "active";
  return {
    name,
    directory,
    path: path.relative(repoRoot, skillDocumentPath(repoRoot, directory)),
    description,
    status,
    triggers: frontmatter.triggers ?? [],
  };
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  status?: string;
  triggers?: string[];
}

function readFrontmatter(content: string): ParsedFrontmatter {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }

  const frontmatter = content.slice(4, end).split("\n");
  const parsed: ParsedFrontmatter = {};
  let currentListKey: "triggers" | undefined;

  for (const rawLine of frontmatter) {
    const line = rawLine.trimEnd();
    const listMatch = /^\s+-\s+(.+)$/.exec(line);
    if (listMatch !== null && currentListKey === "triggers") {
      const value = unquote(listMatch[1] ?? "").trim();
      if (value !== "") {
        parsed.triggers = [...(parsed.triggers ?? []), value];
      }
      continue;
    }

    const keyValueMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyValueMatch === null) {
      currentListKey = undefined;
      continue;
    }

    const key = keyValueMatch[1];
    const rawValue = keyValueMatch[2] ?? "";
    if (key === "triggers") {
      currentListKey = "triggers";
      parsed.triggers = [];
      continue;
    }

    currentListKey = undefined;
    const value = unquote(rawValue).trim();
    if (key === "name") {
      parsed.name = value;
    } else if (key === "description") {
      parsed.description = value;
    } else if (key === "status") {
      parsed.status = value;
    }
  }

  return parsed;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
