import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "@cortex/core";
import { isMarkdownPath, isRawPath, PolicyViolationError } from "./policy.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext, ToolDefinition } from "./types.js";

interface WikiListPagesArgs extends JsonObject {
  root?: JsonValue;
  includeRaw?: JsonValue;
  limit?: JsonValue;
}

interface WikiReadPageArgs extends JsonObject {
  path?: JsonValue;
  includeRaw?: JsonValue;
  maxChars?: JsonValue;
}

interface WikiSearchArgs extends JsonObject {
  query?: JsonValue;
  root?: JsonValue;
  includeRaw?: JsonValue;
  limit?: JsonValue;
  maxFileBytes?: JsonValue;
}

interface WikiPageResult extends JsonObject {
  path: string;
  chars: number;
  content: string;
  truncated: boolean;
}

interface WikiSearchMatch extends JsonObject {
  path: string;
  line: number;
  preview: string;
}

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_MAX_PAGE_CHARS = 64_000;
const DEFAULT_MAX_SEARCH_FILE_BYTES = 512_000;
const EXCLUDED_DIRS = new Set([".git", ".cortex", "node_modules", "dist"]);
const WIKI_DIR = "wiki";

interface ResolvedWikiPath {
  absolutePath: string;
  relativePath: string;
  wikiRoot: string;
}

export function registerWikiTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createWikiTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createWikiTools(): ToolDefinition[] {
  return [wikiListPagesTool, wikiReadPageTool, wikiSearchTool];
}

const wikiListPagesTool: ToolDefinition<WikiListPagesArgs> = {
  name: "wiki.listPages",
  description: "List Markdown pages in the Cortex wiki.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      root: { type: "string", description: "Optional wiki-relative directory to list." },
      includeRaw: { type: "boolean", description: "Include immutable raw source files." },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
    },
  },
  maxResultChars: 64_000,
  async handler(args, context) {
    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const limit = optionalPositiveInteger(args.limit, DEFAULT_LIST_LIMIT, "limit");
    const root = optionalString(args.root, ".", "root");
    const start = resolveWikiPath(context.repoRoot, root, {
      allowRoot: true,
      allowRawRead: includeRaw,
    });
    const pages = await listMarkdownPages(start.wikiRoot, start.absolutePath, includeRaw, limit);
    return { pages, count: pages.length };
  },
};

const wikiReadPageTool: ToolDefinition<WikiReadPageArgs, WikiPageResult> = {
  name: "wiki.readPage",
  description: "Read one Markdown page by wiki-relative path.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string" },
      includeRaw: { type: "boolean", description: "Allow reading immutable raw source files." },
      maxChars: { type: "integer", minimum: 1, maximum: 200000 },
    },
  },
  maxResultChars: 100_000,
  async handler(args, context) {
    const requestedPath = requiredString(args.path, "path");
    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const maxChars = optionalPositiveInteger(args.maxChars, DEFAULT_MAX_PAGE_CHARS, "maxChars");
    const resolved = resolveWikiPath(context.repoRoot, requestedPath, {
      allowRawRead: includeRaw,
    });

    if (!isMarkdownPath(resolved.relativePath)) {
      throw new PolicyViolationError(
        "not_markdown",
        `wiki.readPage only reads Markdown files: ${resolved.relativePath}`,
      );
    }

    const file = await stat(resolved.absolutePath);
    if (!file.isFile()) {
      throw new PolicyViolationError("not_file", `Path is not a file: ${resolved.relativePath}`);
    }

    const content = await readFile(resolved.absolutePath, "utf8");
    const truncated = content.length > maxChars;
    return {
      path: resolved.relativePath,
      chars: content.length,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
    };
  },
};

const wikiSearchTool: ToolDefinition<WikiSearchArgs> = {
  name: "wiki.search",
  description: "Search Markdown pages in the Cortex wiki by case-insensitive substring.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string" },
      root: { type: "string", description: "Optional wiki-relative directory to search." },
      includeRaw: { type: "boolean", description: "Include immutable raw source files." },
      limit: { type: "integer", minimum: 1, maximum: 1000 },
      maxFileBytes: { type: "integer", minimum: 1, maximum: 5000000 },
    },
  },
  maxResultChars: 64_000,
  async handler(args, context) {
    const query = requiredString(args.query, "query").trim();
    if (query === "") {
      throw new PolicyViolationError("empty_query", "Search query cannot be empty");
    }

    const includeRaw = optionalBoolean(args.includeRaw, false, "includeRaw");
    const limit = optionalPositiveInteger(args.limit, DEFAULT_SEARCH_LIMIT, "limit");
    const maxFileBytes = optionalPositiveInteger(
      args.maxFileBytes,
      DEFAULT_MAX_SEARCH_FILE_BYTES,
      "maxFileBytes",
    );
    const root = optionalString(args.root, ".", "root");
    const start = resolveWikiPath(context.repoRoot, root, {
      allowRoot: true,
      allowRawRead: includeRaw,
    });
    const pages = await listMarkdownPages(start.wikiRoot, start.absolutePath, includeRaw, 10_000);
    const matches = await searchPages(start.wikiRoot, pages, query, limit, maxFileBytes);
    return { query, matches, count: matches.length };
  },
};

async function listMarkdownPages(
  wikiRoot: string,
  startDir: string,
  includeRaw: boolean,
  limit: number,
): Promise<string[]> {
  const pages: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (pages.length >= limit) {
      return;
    }

    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (pages.length >= limit) {
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".gitkeep") {
        continue;
      }

      const absolutePath = path.join(dir, entry.name);
      const relativePath = toPosixPath(path.relative(wikiRoot, absolutePath));
      if (!includeRaw && isRawPath(relativePath)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) {
          continue;
        }
        await walk(absolutePath);
      } else if (entry.isFile() && isMarkdownPath(relativePath)) {
        pages.push(relativePath);
      }
    }
  }

  await walk(startDir);
  return pages;
}

async function searchPages(
  wikiRoot: string,
  pages: string[],
  query: string,
  limit: number,
  maxFileBytes: number,
): Promise<WikiSearchMatch[]> {
  const matches: WikiSearchMatch[] = [];
  const normalizedQuery = query.toLowerCase();

  for (const relativePath of pages) {
    if (matches.length >= limit) {
      break;
    }

    const absolutePath = path.join(wikiRoot, relativePath);
    const file = await stat(absolutePath);
    if (file.size > maxFileBytes) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line.toLowerCase().includes(normalizedQuery)) {
        continue;
      }
      matches.push({
        path: relativePath,
        line: index + 1,
        preview: line.trim().slice(0, 240),
      });
      if (matches.length >= limit) {
        break;
      }
    }
  }

  return matches;
}

function resolveWikiPath(
  repoRoot: string,
  requestedPath: string,
  options: { allowRoot?: boolean; allowRawRead?: boolean } = {},
): ResolvedWikiPath {
  if (requestedPath.trim() === "") {
    throw new PolicyViolationError("empty_path", "Path cannot be empty");
  }

  const wikiRoot = path.join(path.resolve(repoRoot), WIKI_DIR);
  const normalizedPath = normalizeWikiRequestPath(requestedPath);
  const absolutePath = path.resolve(wikiRoot, normalizedPath);

  if (!isPathInside(wikiRoot, absolutePath)) {
    throw new PolicyViolationError(
      "outside_wiki",
      `Path escapes the wiki directory: ${requestedPath}`,
    );
  }

  const relativePath = toPosixPath(path.relative(wikiRoot, absolutePath));
  if (relativePath === "") {
    if (options.allowRoot === true) {
      return { absolutePath, relativePath, wikiRoot };
    }
    throw new PolicyViolationError("root_path", "Path must point to a wiki file or subdirectory");
  }

  rejectBlockedSegments(relativePath);

  if (isRawPath(relativePath) && options.allowRawRead !== true) {
    throw new PolicyViolationError(
      "raw_read_not_enabled",
      `Reading raw/ requires includeRaw: true: ${relativePath}`,
    );
  }

  return { absolutePath, relativePath, wikiRoot };
}

function normalizeWikiRequestPath(requestedPath: string): string {
  const normalized = requestedPath.trim().replaceAll("\\", "/");
  if (normalized === WIKI_DIR) {
    return ".";
  }
  if (normalized.startsWith(`${WIKI_DIR}/`)) {
    return normalized.slice(WIKI_DIR.length + 1);
  }
  return normalized;
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rejectBlockedSegments(relativePath: string): void {
  const blocked = relativePath.split("/").find((segment) => EXCLUDED_DIRS.has(segment));
  if (blocked !== undefined) {
    throw new PolicyViolationError(
      "blocked_path_segment",
      `Path includes blocked segment "${blocked}": ${relativePath}`,
    );
  }
}

function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new PolicyViolationError("invalid_args", `${name} must be a string`);
  }
  return value;
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

function optionalPositiveInteger(
  value: JsonValue | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new PolicyViolationError("invalid_args", `${name} must be a positive integer`);
  }
  return value;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
