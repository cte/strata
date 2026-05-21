import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isNotFoundError, readTextFileOrUndefined, truncateForAgent } from "./fileStore.js";
import { getStrataPaths } from "./paths.js";
import { StrataStateError } from "./stateErrors.js";
import type { JsonObject } from "./types.js";

export type SkillSource = "strata" | "agents";

export interface SkillMetadata extends JsonObject {
  name: string;
  directory: string;
  path: string;
  description: string;
  status: string;
  triggers: string[];
  source: SkillSource;
  disableModelInvocation: boolean;
}

export interface SkillDocument extends JsonObject {
  metadata: SkillMetadata;
  content: string;
  chars: number;
  truncated: boolean;
}

const SKILL_FILE = "SKILL.md";
const AGENTS_SKILLS_DIR = path.join(".agents", "skills");

export async function listSkills(repoRoot: string): Promise<SkillMetadata[]> {
  return loadSkills(path.resolve(repoRoot));
}

export async function listPromptVisibleSkills(repoRoot: string): Promise<SkillMetadata[]> {
  return (await listSkills(path.resolve(repoRoot))).filter(
    (skill) => !skill.disableModelInvocation,
  );
}

export async function readSkill(
  repoRoot: string,
  name: string,
  maxChars = 24_000,
): Promise<SkillDocument> {
  const resolvedRepoRoot = path.resolve(repoRoot);
  assertSkillName(name);
  const metadata = (await listSkills(resolvedRepoRoot)).find((skill) => skill.name === name);
  if (metadata === undefined) {
    throw new StrataStateError("skill_not_found", `No skill named ${name} was found`);
  }
  const skillPath = path.resolve(resolvedRepoRoot, metadata.path);
  const raw = await readTextFileOrUndefined(skillPath);
  if (raw === undefined) {
    throw new StrataStateError("skill_not_found", `Skill file vanished: ${metadata.path}`);
  }
  const truncated = truncateForAgent(raw, maxChars);
  return {
    metadata,
    content: truncated.content,
    chars: truncated.chars,
    truncated: truncated.truncated,
  };
}

export function skillDocumentPath(repoRoot: string, name: string): string {
  assertSkillName(name);
  return path.join(getStrataPaths(repoRoot).skillsDir, name, SKILL_FILE);
}

export function assertSkillName(name: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new StrataStateError(
      "invalid_skill_name",
      "Skill name must be a lowercase directory name without path separators",
    );
  }
}

interface SkillEntry {
  directory: string;
  filePath: string;
  source: SkillSource;
}

interface LoadedSkill {
  metadata: SkillMetadata;
  filePath: string;
}

async function loadSkills(repoRoot: string): Promise<SkillMetadata[]> {
  const entries = [
    ...(await discoverSkillEntries(getStrataPaths(repoRoot).skillsDir, "strata")),
    ...(await discoverSkillEntries(path.join(repoRoot, AGENTS_SKILLS_DIR), "agents")),
  ];
  const loaded: LoadedSkill[] = [];
  const seenFiles = new Set<string>();

  for (const entry of entries) {
    const canonicalPath = await canonicalFilePath(entry.filePath);
    if (seenFiles.has(canonicalPath)) {
      continue;
    }
    seenFiles.add(canonicalPath);

    const content = await readTextFileOrUndefined(entry.filePath);
    if (content === undefined) {
      continue;
    }
    loaded.push({
      filePath: entry.filePath,
      metadata: parseSkillMetadata(repoRoot, entry, content),
    });
  }

  const byName = new Map<string, LoadedSkill>();
  for (const skill of loaded) {
    if (!byName.has(skill.metadata.name)) {
      byName.set(skill.metadata.name, skill);
    }
  }

  return Array.from(byName.values())
    .map((skill) => skill.metadata)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function discoverSkillEntries(root: string, source: SkillSource): Promise<SkillEntry[]> {
  if (!(await pathExists(root))) {
    return [];
  }
  return discoverSkillEntriesInDirectory(root, source);
}

async function discoverSkillEntriesInDirectory(
  directory: string,
  source: SkillSource,
): Promise<SkillEntry[]> {
  const skillFile = path.join(directory, SKILL_FILE);
  if (await isFile(skillFile)) {
    return [
      {
        directory: path.basename(directory),
        filePath: skillFile,
        source,
      },
    ];
  }

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const skills: SkillEntry[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const childPath = path.join(directory, entry.name);
    if (!(await isDirectoryEntry(childPath, entry))) {
      continue;
    }
    skills.push(...(await discoverSkillEntriesInDirectory(childPath, source)));
  }
  return skills;
}

function parseSkillMetadata(repoRoot: string, entry: SkillEntry, content: string): SkillMetadata {
  const frontmatter = readFrontmatter(content);
  const name = frontmatter.name ?? entry.directory;
  const description = frontmatter.description ?? "";
  const status = frontmatter.status ?? "active";
  return {
    name,
    directory: entry.directory,
    path: path.relative(repoRoot, entry.filePath),
    description,
    status,
    triggers: frontmatter.triggers ?? [],
    source: entry.source,
    disableModelInvocation: frontmatter.disableModelInvocation ?? false,
  };
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  status?: string;
  triggers?: string[];
  disableModelInvocation?: boolean;
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
    } else if (key === "disable-model-invocation") {
      parsed.disableModelInvocation = value.toLowerCase() === "true";
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function isDirectoryEntry(filePath: string, entry: Dirent): Promise<boolean> {
  if (entry.isDirectory()) {
    return true;
  }
  if (!entry.isSymbolicLink()) {
    return false;
  }
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function canonicalFilePath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return filePath;
  }
}
