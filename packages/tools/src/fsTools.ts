import type { Stats } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "@cortex/core";
import { assertReadAllowed, isRawPath, PolicyViolationError } from "./policy.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

interface FsListArgs extends JsonObject {
  path?: JsonValue;
  recursive?: JsonValue;
  includeRaw?: JsonValue;
  limit?: JsonValue;
}

interface FsReadArgs extends JsonObject {
  path?: JsonValue;
  includeRaw?: JsonValue;
  maxBytes?: JsonValue;
  maxChars?: JsonValue;
}

interface FsFindArgs extends JsonObject {
  pattern?: JsonValue;
  root?: JsonValue;
  caseSensitive?: JsonValue;
  includeRaw?: JsonValue;
  includeDirs?: JsonValue;
  includeFiles?: JsonValue;
  limit?: JsonValue;
}

interface FsGrepArgs extends JsonObject {
  query?: JsonValue;
  root?: JsonValue;
  pathPattern?: JsonValue;
  caseSensitive?: JsonValue;
  includeRaw?: JsonValue;
  limit?: JsonValue;
  maxFileBytes?: JsonValue;
}

interface FsEntry extends JsonObject {
  path: string;
  type: FsEntryType;
  bytes?: number;
  modifiedAt: string;
}

interface FsGrepMatch extends JsonObject {
  path: string;
  line: number;
  preview: string;
}

type FsEntryType = "file" | "directory" | "symlink" | "other";

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_FIND_LIMIT = 200;
const DEFAULT_GREP_LIMIT = 100;
const DEFAULT_MAX_READ_BYTES = 1_000_000;
const DEFAULT_MAX_READ_CHARS = 64_000;
const DEFAULT_MAX_GREP_FILE_BYTES = 512_000;
const MAX_LIMIT = 5_000;
const MAX_READ_BYTES = 10_000_000;
const MAX_READ_CHARS = 1_000_000;
const MAX_GREP_FILE_BYTES = 5_000_000;
const BLOCKED_DIRS = new Set([".git", ".cortex", "node_modules", "dist"]);

export function registerFileSystemTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createFileSystemTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createFileSystemTools(): ToolDefinition[] {
  return [fsListTool, fsReadTool, fsFindTool, fsGrepTool];
}

const fsListTool: ToolDefinition<FsListArgs> = {
  name: "fs.list",
  description:
    "List files and directories inside the Cortex repo without following symlinks. Raw sources require includeRaw.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: {
        type: "string",
        description: "Repo-relative file or directory. Defaults to repo root.",
      },
      recursive: { type: "boolean", description: "Recursively list directory contents." },
      includeRaw: { type: "boolean", description: "Allow listing immutable raw source files." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    },
  },
  maxResultChars: 96_000,
  async handler(args, context) {
    const requestedPath = optionalString(args.path, ".", "path");
    const recursive = optionalBoolean(args.recursive, false, "recursive");
    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const limit = optionalInteger(args.limit, DEFAULT_LIST_LIMIT, "limit", 1, MAX_LIMIT);
    const resolved = assertReadAllowed(context.repoRoot, requestedPath, {
      allowRoot: true,
      allowRawRead: includeRaw,
    });
    await rejectSymlinkPathSegments(resolved.repoRoot, resolved.relativePath);
    const result = await listPath(context.repoRoot, resolved.absolutePath, {
      recursive,
      includeRaw,
      limit,
    });
    return {
      path: resolved.relativePath,
      entries: result.entries,
      count: result.entries.length,
      truncated: result.truncated,
    };
  },
};

const fsReadTool: ToolDefinition<FsReadArgs> = {
  name: "fs.read",
  description:
    "Read a UTF-8 text file inside the Cortex repo without following symlinks. Raw sources require includeRaw.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", description: "Repo-relative file path." },
      includeRaw: { type: "boolean", description: "Allow reading immutable raw source files." },
      maxBytes: { type: "integer", minimum: 1, maximum: MAX_READ_BYTES },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_READ_CHARS },
    },
  },
  maxResultChars: 120_000,
  async handler(args, context) {
    const requestedPath = requiredString(args.path, "path");
    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const maxBytes = optionalInteger(
      args.maxBytes,
      DEFAULT_MAX_READ_BYTES,
      "maxBytes",
      1,
      MAX_READ_BYTES,
    );
    const maxChars = optionalInteger(
      args.maxChars,
      DEFAULT_MAX_READ_CHARS,
      "maxChars",
      1,
      MAX_READ_CHARS,
    );
    const resolved = assertReadAllowed(context.repoRoot, requestedPath, {
      allowRawRead: includeRaw,
    });
    await rejectSymlinkPathSegments(resolved.repoRoot, resolved.relativePath);
    const metadata = await lstat(resolved.absolutePath);
    rejectUnreadableEntry(resolved.relativePath, metadata);
    if (metadata.size > maxBytes) {
      throw new PolicyViolationError(
        "file_too_large",
        `File exceeds maxBytes (${metadata.size} > ${maxBytes}): ${resolved.relativePath}`,
      );
    }

    const content = decodeText(await readFile(resolved.absolutePath), resolved.relativePath);
    const truncated = content.length > maxChars;
    return {
      path: resolved.relativePath,
      bytes: metadata.size,
      chars: content.length,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
    };
  },
};

const fsFindTool: ToolDefinition<FsFindArgs> = {
  name: "fs.find",
  description:
    "Find repo paths by case-insensitive substring or '*' wildcard pattern without searching blocked runtime/build directories.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description: "Path substring or '*' wildcard pattern matched against repo-relative paths.",
      },
      root: { type: "string", description: "Repo-relative directory or file to search." },
      caseSensitive: { type: "boolean" },
      includeRaw: { type: "boolean", description: "Allow matching immutable raw source files." },
      includeDirs: { type: "boolean", description: "Include matching directories." },
      includeFiles: { type: "boolean", description: "Include matching files and symlinks." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    },
  },
  maxResultChars: 96_000,
  async handler(args, context) {
    const pattern = requiredNonEmptyString(args.pattern, "pattern");
    const root = optionalString(args.root, ".", "root");
    const caseSensitive = optionalBoolean(args.caseSensitive, false, "caseSensitive");
    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const includeDirs = optionalBoolean(args.includeDirs, true, "includeDirs");
    const includeFiles = optionalBoolean(args.includeFiles, true, "includeFiles");
    const limit = optionalInteger(args.limit, DEFAULT_FIND_LIMIT, "limit", 1, MAX_LIMIT);
    if (!includeDirs && !includeFiles) {
      throw new PolicyViolationError(
        "invalid_args",
        "At least one of includeDirs or includeFiles must be true",
      );
    }

    const resolved = assertReadAllowed(context.repoRoot, root, {
      allowRoot: true,
      allowRawRead: includeRaw,
    });
    await rejectSymlinkPathSegments(resolved.repoRoot, resolved.relativePath);
    const matcher = createPathMatcher(pattern, caseSensitive);
    const result = await findPaths(context.repoRoot, resolved.absolutePath, {
      matcher,
      includeRaw,
      includeDirs,
      includeFiles,
      limit,
    });
    return {
      pattern,
      root: resolved.relativePath,
      matches: result.matches,
      count: result.matches.length,
      truncated: result.truncated,
    };
  },
};

const fsGrepTool: ToolDefinition<FsGrepArgs> = {
  name: "fs.grep",
  description:
    "Search UTF-8 text files in the Cortex repo by substring, skipping blocked directories and binary files.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", description: "Text substring to search for." },
      root: { type: "string", description: "Repo-relative directory or file to search." },
      pathPattern: {
        type: "string",
        description: "Optional path substring or '*' wildcard filter for files.",
      },
      caseSensitive: { type: "boolean" },
      includeRaw: { type: "boolean", description: "Allow searching immutable raw source files." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      maxFileBytes: { type: "integer", minimum: 1, maximum: MAX_GREP_FILE_BYTES },
    },
  },
  maxResultChars: 96_000,
  async handler(args, context) {
    const query = requiredNonEmptyString(args.query, "query");
    const root = optionalString(args.root, ".", "root");
    const pathPattern = optionalString(args.pathPattern, "", "pathPattern");
    const caseSensitive = optionalBoolean(args.caseSensitive, false, "caseSensitive");
    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const limit = optionalInteger(args.limit, DEFAULT_GREP_LIMIT, "limit", 1, MAX_LIMIT);
    const maxFileBytes = optionalInteger(
      args.maxFileBytes,
      DEFAULT_MAX_GREP_FILE_BYTES,
      "maxFileBytes",
      1,
      MAX_GREP_FILE_BYTES,
    );
    const resolved = assertReadAllowed(context.repoRoot, root, {
      allowRoot: true,
      allowRawRead: includeRaw,
    });
    await rejectSymlinkPathSegments(resolved.repoRoot, resolved.relativePath);
    const grepOptions: GrepOptions = {
      query,
      caseSensitive,
      includeRaw,
      limit,
      maxFileBytes,
    };
    if (pathPattern !== "") {
      grepOptions.pathMatcher = createPathMatcher(pathPattern, caseSensitive);
    }

    const result = await grepPaths(context.repoRoot, resolved.absolutePath, grepOptions);
    return {
      query,
      root: resolved.relativePath,
      matches: result.matches,
      count: result.matches.length,
      truncated: result.truncated,
    };
  },
};

interface GrepOptions {
  query: string;
  pathMatcher?: (path: string) => boolean;
  caseSensitive: boolean;
  includeRaw: boolean;
  limit: number;
  maxFileBytes: number;
}

async function listPath(
  repoRoot: string,
  absolutePath: string,
  options: { recursive: boolean; includeRaw: boolean; limit: number },
): Promise<{ entries: FsEntry[]; truncated: boolean }> {
  const metadata = await lstat(absolutePath);
  const relativePath = repoRelativePath(repoRoot, absolutePath);
  rejectSymlinkRoot(relativePath, metadata);
  if (metadata.isFile()) {
    return { entries: [entryFor(relativePath, metadata)], truncated: false };
  }
  if (!metadata.isDirectory()) {
    return { entries: [entryFor(relativePath, metadata)], truncated: false };
  }

  const entries: FsEntry[] = [];
  let truncated = false;
  await walkDirectory(
    repoRoot,
    absolutePath,
    { includeRaw: options.includeRaw, recursive: options.recursive },
    async (entryPath, entryStats) => {
      if (entries.length >= options.limit) {
        truncated = true;
        return false;
      }
      entries.push(entryFor(repoRelativePath(repoRoot, entryPath), entryStats));
      if (entries.length >= options.limit) {
        truncated = true;
        return false;
      }
      return true;
    },
  );
  return { entries, truncated };
}

async function findPaths(
  repoRoot: string,
  absolutePath: string,
  options: {
    matcher: (path: string) => boolean;
    includeRaw: boolean;
    includeDirs: boolean;
    includeFiles: boolean;
    limit: number;
  },
): Promise<{ matches: FsEntry[]; truncated: boolean }> {
  const matches: FsEntry[] = [];
  let truncated = false;
  const metadata = await lstat(absolutePath);
  rejectSymlinkRoot(repoRelativePath(repoRoot, absolutePath), metadata);

  async function visit(entryPath: string, entryStats: Stats): Promise<boolean> {
    if (matches.length >= options.limit) {
      truncated = true;
      return false;
    }

    const relativePath = repoRelativePath(repoRoot, entryPath);
    const type = entryType(entryStats);
    const canInclude =
      (type === "directory" && options.includeDirs) ||
      (type !== "directory" && options.includeFiles);
    if (canInclude && relativePath !== "" && options.matcher(relativePath)) {
      matches.push(entryFor(relativePath, entryStats));
    }
    if (matches.length >= options.limit) {
      truncated = true;
      return false;
    }
    return true;
  }

  await visit(absolutePath, metadata);
  if (metadata.isDirectory()) {
    await walkDirectory(repoRoot, absolutePath, { includeRaw: options.includeRaw }, visit);
  }
  return { matches, truncated };
}

async function grepPaths(
  repoRoot: string,
  absolutePath: string,
  options: GrepOptions,
): Promise<{ matches: FsGrepMatch[]; truncated: boolean }> {
  const matches: FsGrepMatch[] = [];
  let truncated = false;
  const metadata = await lstat(absolutePath);
  rejectSymlinkRoot(repoRelativePath(repoRoot, absolutePath), metadata);

  async function searchFile(filePath: string, fileStats: Stats): Promise<void> {
    if (matches.length >= options.limit || !fileStats.isFile()) {
      return;
    }
    const relativePath = repoRelativePath(repoRoot, filePath);
    if (options.pathMatcher !== undefined && !options.pathMatcher(relativePath)) {
      return;
    }
    if (fileStats.size > options.maxFileBytes) {
      return;
    }

    let content: string;
    try {
      content = decodeText(await readFile(filePath), relativePath);
    } catch (error: unknown) {
      if (error instanceof PolicyViolationError && error.code === "binary_file") {
        return;
      }
      throw error;
    }

    const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const haystack = options.caseSensitive ? line : line.toLowerCase();
      if (!haystack.includes(needle)) {
        continue;
      }
      matches.push({
        path: relativePath,
        line: index + 1,
        preview: line.trim().slice(0, 240),
      });
      if (matches.length >= options.limit) {
        truncated = true;
        return;
      }
    }
  }

  if (metadata.isFile()) {
    await searchFile(absolutePath, metadata);
  } else if (metadata.isDirectory()) {
    await walkDirectory(
      repoRoot,
      absolutePath,
      { includeRaw: options.includeRaw },
      async (entryPath, entryStats) => {
        await searchFile(entryPath, entryStats);
        if (matches.length >= options.limit) {
          truncated = true;
          return false;
        }
        return true;
      },
    );
  }
  return { matches, truncated };
}

async function walkDirectory(
  repoRoot: string,
  directory: string,
  options: { includeRaw: boolean; recursive?: boolean },
  visitor: (absolutePath: string, metadata: Stats) => boolean | Promise<boolean>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (BLOCKED_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = repoRelativePath(repoRoot, absolutePath);
    if (!options.includeRaw && isRawPath(relativePath)) {
      continue;
    }

    const metadata = await lstat(absolutePath);
    const shouldContinue = await visitor(absolutePath, metadata);
    if (!shouldContinue) {
      return;
    }
    if ((options.recursive ?? true) && metadata.isDirectory() && !metadata.isSymbolicLink()) {
      await walkDirectory(repoRoot, absolutePath, options, visitor);
    }
  }
}

function rejectUnreadableEntry(relativePath: string, metadata: Stats): void {
  rejectSymlinkRoot(relativePath, metadata);
  if (!metadata.isFile()) {
    throw new PolicyViolationError("not_file", `Path is not a file: ${relativePath}`);
  }
}

function rejectSymlinkRoot(relativePath: string, metadata: Stats): void {
  if (metadata.isSymbolicLink()) {
    throw new PolicyViolationError(
      "symlink_not_followed",
      `Symlinks are not followed: ${relativePath}`,
    );
  }
}

async function rejectSymlinkPathSegments(repoRoot: string, relativePath: string): Promise<void> {
  if (relativePath === "") {
    return;
  }

  let currentPath = path.resolve(repoRoot);
  const segments = relativePath.split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === "") {
      continue;
    }
    currentPath = path.join(currentPath, segment);
    const metadata = await lstat(currentPath);
    if (metadata.isSymbolicLink()) {
      const symlinkPath = segments.slice(0, index + 1).join("/");
      throw new PolicyViolationError(
        "symlink_not_followed",
        `Symlinks are not followed: ${symlinkPath}`,
      );
    }
  }
}

function entryFor(relativePath: string, metadata: Stats): FsEntry {
  const entry: FsEntry = {
    path: relativePath,
    type: entryType(metadata),
    modifiedAt: metadata.mtime.toISOString(),
  };
  if (metadata.isFile()) {
    entry.bytes = metadata.size;
  }
  return entry;
}

function entryType(metadata: Stats): FsEntryType {
  if (metadata.isFile()) {
    return "file";
  }
  if (metadata.isDirectory()) {
    return "directory";
  }
  if (metadata.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

function decodeText(buffer: Buffer, relativePath: string): string {
  if (buffer.includes(0)) {
    throw new PolicyViolationError("binary_file", `Refusing to read binary file: ${relativePath}`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new PolicyViolationError("binary_file", `Refusing to read binary file: ${relativePath}`);
  }
}

function createPathMatcher(pattern: string, caseSensitive: boolean): (path: string) => boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (normalizedPattern.includes("*")) {
    const regex = new RegExp(
      `^${normalizedPattern.split("*").map(escapeRegex).join(".*")}$`,
      caseSensitive ? "" : "i",
    );
    return (relativePath) => regex.test(relativePath);
  }

  const needle = caseSensitive ? normalizedPattern : normalizedPattern.toLowerCase();
  return (relativePath) => {
    const haystack = caseSensitive ? relativePath : relativePath.toLowerCase();
    return haystack.includes(needle);
  };
}

function repoRelativePath(repoRoot: string, absolutePath: string): string {
  return toPosixPath(path.relative(path.resolve(repoRoot), absolutePath));
}

function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new PolicyViolationError("invalid_args", `${name} must be a string`);
  }
  return value;
}

function requiredNonEmptyString(value: JsonValue | undefined, name: string): string {
  const stringValue = requiredString(value, name).trim();
  if (stringValue === "") {
    throw new PolicyViolationError("invalid_args", `${name} cannot be empty`);
  }
  return stringValue;
}

function optionalString(value: JsonValue | undefined, fallback: string, name: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new PolicyViolationError("invalid_args", `${name} must be a string`);
  }
  return value;
}

function optionalBoolean(value: JsonValue | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new PolicyViolationError("invalid_args", `${name} must be a boolean`);
  }
  return value;
}

function optionalInteger(
  value: JsonValue | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PolicyViolationError(
      "invalid_args",
      `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return value;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
