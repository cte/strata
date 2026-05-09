import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "@strata/core";
import { editTextFile, writeTextFile } from "./fsTools.js";
import {
  assertReadAllowed,
  assertWriteAllowed,
  isBlockedPathSegment,
  isMarkdownPath,
  isRawPath,
  PolicyViolationError,
} from "./policy.js";
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

interface WikiWritePageArgs extends JsonObject {
  path?: JsonValue;
  content?: JsonValue;
  overwrite?: JsonValue;
  createDirs?: JsonValue;
  maxChars?: JsonValue;
}

interface WikiPatchPageArgs extends JsonObject {
  path?: JsonValue;
  oldText?: JsonValue;
  newText?: JsonValue;
  replaceAll?: JsonValue;
  maxFileBytes?: JsonValue;
}

interface WikiAppendLogArgs extends JsonObject {
  entry?: JsonValue;
  timestamp?: JsonValue;
  maxChars?: JsonValue;
}

interface WikiUpdateIndexArgs extends JsonObject {
  section?: JsonValue;
  target?: JsonValue;
  label?: JsonValue;
  description?: JsonValue;
  sort?: JsonValue;
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
const DEFAULT_MAX_WRITE_CHARS = 500_000;
const DEFAULT_MAX_PATCH_FILE_BYTES = 1_000_000;
const WIKI_DIR = "wiki";
const INDEX_PATH = "index.md";
const LOG_PATH = "log.md";

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
  return [
    wikiListPagesTool,
    wikiReadPageTool,
    wikiSearchTool,
    wikiWritePageTool,
    wikiPatchPageTool,
    wikiAppendLogTool,
    wikiUpdateIndexTool,
  ];
}

const wikiListPagesTool: ToolDefinition<WikiListPagesArgs> = {
  name: "wiki.listPages",
  description: "List Markdown pages in the Strata wiki.",
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
    // Models often pass `root: ""` for "list everything"; treat empty/blank
    // the same as omitted.
    const root = optionalString(args.root, ".", "root").trim() || ".";
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
  description: "Search Markdown pages in the Strata wiki by case-insensitive substring.",
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
    const root = optionalString(args.root, ".", "root").trim() || ".";
    const start = resolveWikiPath(context.repoRoot, root, {
      allowRoot: true,
      allowRawRead: includeRaw,
    });
    const pages = await listMarkdownPages(start.wikiRoot, start.absolutePath, includeRaw, 10_000);
    const matches = await searchPages(start.wikiRoot, pages, query, limit, maxFileBytes);
    return { query, matches, count: matches.length };
  },
};

const wikiWritePageTool: ToolDefinition<WikiWritePageArgs> = {
  name: "wiki.writePage",
  description: "Create or explicitly overwrite a Markdown page inside the Strata wiki.",
  mode: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Wiki-relative Markdown page path." },
      content: { type: "string", description: "Markdown content to write." },
      overwrite: {
        type: "boolean",
        description: "Allow replacing an existing page. Defaults to false.",
      },
      createDirs: {
        type: "boolean",
        description: "Create missing parent directories. Defaults to false.",
      },
      maxChars: { type: "integer", minimum: 1, maximum: 2_000_000 },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const requestedPath = requiredString(args.path, "path");
    const content = requiredString(args.content, "content");
    const overwrite = optionalBoolean(args.overwrite, false, "overwrite");
    const createDirs = optionalBoolean(args.createDirs, false, "createDirs");
    const maxChars = optionalPositiveInteger(args.maxChars, DEFAULT_MAX_WRITE_CHARS, "maxChars");
    const resolved = resolveWikiWritePath(context.repoRoot, requestedPath);
    assertMarkdownPagePath(resolved.relativePath, "wiki.writePage");

    const result = await writeTextFile(context, {
      path: toRepoWikiPath(resolved.relativePath),
      content,
      overwrite,
      createDirs,
      maxChars,
    });
    return { ...result, path: resolved.relativePath, repoPath: result.path };
  },
};

const wikiPatchPageTool: ToolDefinition<WikiPatchPageArgs> = {
  name: "wiki.patchPage",
  description:
    "Apply a targeted text replacement to a Markdown page. Ambiguous matches fail unless replaceAll is true.",
  mode: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path", "oldText", "newText"],
    properties: {
      path: { type: "string", description: "Wiki-relative Markdown page path." },
      oldText: { type: "string", description: "Exact text to replace. Must be non-empty." },
      newText: { type: "string", description: "Replacement Markdown text." },
      replaceAll: {
        type: "boolean",
        description: "Replace all matches. Defaults to false and requires exactly one match.",
      },
      maxFileBytes: { type: "integer", minimum: 1, maximum: 5_000_000 },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const requestedPath = requiredString(args.path, "path");
    const oldText = requiredNonEmptyString(args.oldText, "oldText");
    const newText = requiredString(args.newText, "newText");
    const replaceAll = optionalBoolean(args.replaceAll, false, "replaceAll");
    const maxFileBytes = optionalPositiveInteger(
      args.maxFileBytes,
      DEFAULT_MAX_PATCH_FILE_BYTES,
      "maxFileBytes",
    );
    const resolved = resolveWikiWritePath(context.repoRoot, requestedPath);
    assertMarkdownPagePath(resolved.relativePath, "wiki.patchPage");

    const result = await editTextFile(context, {
      path: toRepoWikiPath(resolved.relativePath),
      edits: [{ oldText, newText }],
      replaceAll,
      maxFileBytes,
    });
    return { ...result, path: resolved.relativePath, repoPath: result.path };
  },
};

const wikiAppendLogTool: ToolDefinition<WikiAppendLogArgs> = {
  name: "wiki.appendLog",
  description: "Append a timestamped entry to wiki/log.md.",
  mode: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["entry"],
    properties: {
      entry: { type: "string", description: "Markdown text for the log entry." },
      timestamp: {
        type: "string",
        description: "Optional ISO timestamp. Defaults to the current time.",
      },
      maxChars: { type: "integer", minimum: 1, maximum: 2_000_000 },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const entry = requiredNonEmptyString(args.entry, "entry");
    const timestamp = optionalString(args.timestamp, new Date().toISOString(), "timestamp");
    const maxChars = optionalPositiveInteger(args.maxChars, DEFAULT_MAX_WRITE_CHARS, "maxChars");
    const existing = await readOptionalWikiText(context.repoRoot, LOG_PATH);
    const base = existing ?? "# Strata - Activity Log\n";
    const separator = base.endsWith("\n") ? "" : "\n";
    const content = `${base}${separator}\n- ${timestamp} - ${entry.trim()}\n`;
    const writeInput = {
      path: toRepoWikiPath(LOG_PATH),
      content,
      overwrite: true,
      createDirs: true,
      maxChars,
    };
    const result = await writeTextFile(
      context,
      existing === null ? writeInput : { ...writeInput, changeType: "append" },
    );
    return { ...result, path: LOG_PATH, repoPath: result.path };
  },
};

const wikiUpdateIndexTool: ToolDefinition<WikiUpdateIndexArgs> = {
  name: "wiki.updateIndex",
  description: "Add or replace one deterministic wikilink entry in wiki/index.md.",
  mode: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["section", "target"],
    properties: {
      section: { type: "string", description: "Index section heading, e.g. Projects." },
      target: { type: "string", description: "Wiki-relative target path." },
      label: { type: "string", description: "Optional display label." },
      description: { type: "string", description: "Optional trailing description." },
      sort: { type: "boolean", description: "Sort entries in the section. Defaults to true." },
      maxFileBytes: { type: "integer", minimum: 1, maximum: 5_000_000 },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const section = requiredNonEmptyString(args.section, "section");
    const target = requiredNonEmptyString(args.target, "target");
    const label = optionalString(args.label, defaultIndexLabel(target), "label");
    const description = optionalString(args.description, "", "description");
    const sort = optionalBoolean(args.sort, true, "sort");
    const maxFileBytes = optionalPositiveInteger(
      args.maxFileBytes,
      DEFAULT_MAX_PATCH_FILE_BYTES,
      "maxFileBytes",
    );
    const targetPath = normalizeIndexTarget(context.repoRoot, target);
    const existing = await readOptionalWikiText(context.repoRoot, INDEX_PATH);
    const before = existing ?? defaultIndexContent();
    if (Buffer.byteLength(before, "utf8") > maxFileBytes) {
      throw new PolicyViolationError(
        "file_too_large",
        `File exceeds maxFileBytes: ${toRepoWikiPath(INDEX_PATH)}`,
      );
    }
    const line = formatIndexEntry(targetPath, label, description);
    const after = upsertIndexEntry(before, section, targetPath, line, sort);
    const result = await writeTextFile(context, {
      path: toRepoWikiPath(INDEX_PATH),
      content: after,
      overwrite: true,
      createDirs: true,
      maxChars: DEFAULT_MAX_WRITE_CHARS,
    });
    return {
      ...result,
      path: INDEX_PATH,
      repoPath: result.path,
      section,
      target: targetPath,
    };
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
        if (isBlockedPathSegment(entry.name)) {
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
  if (isAbsoluteRequestPath(normalizedPath)) {
    throw new PolicyViolationError(
      "outside_wiki",
      `Path escapes the wiki directory: ${requestedPath}`,
    );
  }
  const resolved = assertReadAllowed(repoRoot, `${WIKI_DIR}/${normalizedPath}`, {
    allowRoot: true,
    allowRawRead: options.allowRawRead === true,
  });
  const relativePath = toWikiRelativePath(resolved.relativePath, requestedPath);
  if (relativePath === "") {
    if (options.allowRoot === true) {
      return { absolutePath: resolved.absolutePath, relativePath, wikiRoot };
    }
    throw new PolicyViolationError("root_path", "Path must point to a wiki file or subdirectory");
  }

  return { absolutePath: resolved.absolutePath, relativePath, wikiRoot };
}

function resolveWikiWritePath(repoRoot: string, requestedPath: string): ResolvedWikiPath {
  if (requestedPath.trim() === "") {
    throw new PolicyViolationError("empty_path", "Path cannot be empty");
  }

  const wikiRoot = path.join(path.resolve(repoRoot), WIKI_DIR);
  const normalizedPath = normalizeWikiRequestPath(requestedPath);
  if (isAbsoluteRequestPath(normalizedPath)) {
    throw new PolicyViolationError(
      "outside_wiki",
      `Path escapes the wiki directory: ${requestedPath}`,
    );
  }
  const resolved = assertWriteAllowed(repoRoot, `${WIKI_DIR}/${normalizedPath}`);
  const relativePath = toWikiRelativePath(resolved.relativePath, requestedPath);
  if (relativePath === "") {
    throw new PolicyViolationError("root_path", "Path must point to a wiki file");
  }
  return { absolutePath: resolved.absolutePath, relativePath, wikiRoot };
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

function toWikiRelativePath(repoRelativePath: string, requestedPath: string): string {
  if (repoRelativePath === WIKI_DIR) {
    return "";
  }
  if (repoRelativePath.startsWith(`${WIKI_DIR}/`)) {
    return repoRelativePath.slice(WIKI_DIR.length + 1);
  }
  throw new PolicyViolationError(
    "outside_wiki",
    `Path escapes the wiki directory: ${requestedPath}`,
  );
}

function isAbsoluteRequestPath(requestedPath: string): boolean {
  return requestedPath.startsWith("/") || /^[A-Za-z]:\//.test(requestedPath);
}

function assertMarkdownPagePath(relativePath: string, toolName: string): void {
  if (!isMarkdownPath(relativePath)) {
    throw new PolicyViolationError(
      "not_markdown",
      `${toolName} only writes Markdown files: ${relativePath}`,
    );
  }
}

function toRepoWikiPath(wikiRelativePath: string): string {
  return `${WIKI_DIR}/${wikiRelativePath}`;
}

async function readOptionalWikiText(
  repoRoot: string,
  wikiRelativePath: string,
): Promise<string | null> {
  const resolved = resolveWikiPath(repoRoot, wikiRelativePath);
  try {
    return await readFile(resolved.absolutePath, "utf8");
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function normalizeIndexTarget(repoRoot: string, target: string): string {
  const resolved = resolveWikiWritePath(repoRoot, target);
  const withoutExtension = resolved.relativePath.endsWith(".md")
    ? resolved.relativePath.slice(0, -".md".length)
    : resolved.relativePath;
  if (isRawPath(withoutExtension) || withoutExtension.startsWith("raw/")) {
    throw new PolicyViolationError("raw_write_forbidden", `Index targets under raw/ are forbidden`);
  }
  return withoutExtension;
}

function defaultIndexLabel(target: string): string {
  const normalized = target.replaceAll("\\", "/").replace(/\.md$/i, "");
  const basename = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  return basename.replace(/[-_]+/g, " ");
}

function formatIndexEntry(target: string, label: string, description: string): string {
  const link = label.trim() === "" || label === target ? `[[${target}]]` : `[[${target}|${label}]]`;
  const suffix = description.trim() === "" ? "" : ` - ${description.trim()}`;
  return `- ${link}${suffix}`;
}

function upsertIndexEntry(
  content: string,
  section: string,
  target: string,
  line: string,
  sort: boolean,
): string {
  const lines = content.replace(/\s*$/, "\n").split("\n");
  const sectionHeading = `## ${section}`;
  let sectionIndex = lines.findIndex((value) => value.trim() === sectionHeading);
  if (sectionIndex === -1) {
    if (lines.at(-1) !== "") {
      lines.push("");
    }
    lines.push(sectionHeading, "", line, "");
    return lines.join("\n").replace(/\n{3,}$/g, "\n\n");
  }

  let nextSectionIndex = lines.findIndex(
    (value, index) => index > sectionIndex && /^##\s+/.test(value),
  );
  if (nextSectionIndex === -1) {
    nextSectionIndex = lines.length;
  }

  const bodyStart = sectionIndex + 1;
  const body = lines.slice(bodyStart, nextSectionIndex);
  const targetPattern = new RegExp(`^- \\[\\[${escapeRegex(target)}(?:\\||\\]\\])`);
  const existingIndex = body.findIndex((value) => targetPattern.test(value.trim()));
  if (existingIndex === -1) {
    body.push(line);
  } else {
    body[existingIndex] = line;
  }

  if (sort) {
    const entries = body.filter((value) => value.trim().startsWith("- [["));
    const rest = body.filter((value) => !value.trim().startsWith("- [["));
    entries.sort((left, right) => left.localeCompare(right));
    body.splice(0, body.length, ...rest.filter((value) => value.trim() !== ""), ...entries);
  }

  lines.splice(bodyStart, nextSectionIndex - bodyStart, ...body);
  return lines.join("\n").replace(/\n{3,}$/g, "\n\n");
}

function defaultIndexContent(): string {
  return ["---", "type: index", "last_updated: null", "---", "", "# Strata Index", ""].join("\n");
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
