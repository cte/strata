import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue } from "@strata/core";
import { withFileMutationQueue } from "./fileMutationQueue.js";
import {
  assertReadAllowed,
  assertWriteAllowed,
  isBlockedPathSegment,
  isRawPath,
  PolicyViolationError,
} from "./policy.js";
import { ToolRegistry } from "./registry.js";
import type { ToolContext, ToolDefinition, ToolFileChange } from "./types.js";

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

interface FsWriteArgs extends JsonObject {
  path?: JsonValue;
  content?: JsonValue;
  overwrite?: JsonValue;
  createDirs?: JsonValue;
  maxChars?: JsonValue;
}

interface FsEditArgs extends JsonObject {
  path?: JsonValue;
  oldText?: JsonValue;
  newText?: JsonValue;
  edits?: JsonValue;
  replaceAll?: JsonValue;
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
  before?: string[];
  after?: string[];
}

export interface WriteTextFileInput {
  path: string;
  content: string;
  overwrite: boolean;
  createDirs: boolean;
  maxChars: number;
  changeType?: "update" | "append";
}

export interface WriteTextFileResult extends JsonObject {
  path: string;
  changeType: ToolFileChange["changeType"];
  bytes: number;
  hash: string;
  overwritten: boolean;
}

export interface EditTextFileEdit {
  oldText: string;
  newText: string;
}

export interface EditTextFileInput {
  path: string;
  edits: EditTextFileEdit[];
  replaceAll: boolean;
  maxFileBytes: number;
}

export interface EditTextFileResult extends JsonObject {
  path: string;
  changeType: "update";
  replacements: number;
  bytes: number;
  hash: string;
  /** Unified-diff hunk for the first changed region, or "" if no diff. */
  diff: string;
}

type FsEntryType = "file" | "directory" | "symlink" | "other";

// Pi-aligned defaults for tool result caps. fs.list / fs.find return 500 by
// default; fs.grep returns 100 by default. The MAX_LIMIT cap above is still
// respected as a hard upper bound on `limit` overrides.
const DEFAULT_LIST_LIMIT = 500;
const DEFAULT_FIND_LIMIT = 500;
const DEFAULT_GREP_LIMIT = 100;
const DEFAULT_MAX_READ_BYTES = 1_000_000;
const DEFAULT_MAX_READ_CHARS = 64_000;
const DEFAULT_MAX_GREP_FILE_BYTES = 512_000;
const DEFAULT_MAX_WRITE_CHARS = 500_000;
const DEFAULT_MAX_EDIT_FILE_BYTES = 1_000_000;
const MAX_LIMIT = 5_000;
const MAX_READ_BYTES = 10_000_000;
const MAX_READ_CHARS = 1_000_000;
const MAX_GREP_FILE_BYTES = 5_000_000;
const MAX_WRITE_CHARS = 2_000_000;
const MAX_EDIT_FILE_BYTES = 5_000_000;
const FILE_CHANGE_PREVIEW_CHARS = 500;

export function registerFileSystemTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createFileSystemTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createFileSystemTools(): ToolDefinition[] {
  return [fsListTool, fsReadTool, fsFindTool, fsGrepTool, fsWriteTool, fsEditTool];
}

const fsListTool: ToolDefinition<FsListArgs> = {
  name: "fs.list",
  description:
    "List files and directories inside the Strata repo without following symlinks. Raw sources require includeRaw.",
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
    // Models frequently pass `path: ""` for "list the repo root". Treat empty
    // (or whitespace-only) the same as omitted — defaults to ".".
    const rawPath = optionalString(args.path, ".", "path").trim();
    const requestedPath = rawPath === "" ? "." : rawPath;
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
    "Read a UTF-8 text file inside the Strata repo without following symlinks. Use offset/limit to read a slice of large files. Raw sources require includeRaw.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", description: "Repo-relative file path." },
      offset: {
        type: "integer",
        minimum: 1,
        description: "1-indexed line number to start reading from. Pi-aligned semantics.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        description: "Maximum number of lines to read. Defaults to all remaining lines.",
      },
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
    const offset = optionalInteger(args.offset, 1, "offset", 1, Number.MAX_SAFE_INTEGER);
    const limit = optionalInteger(args.limit, 0, "limit", 0, Number.MAX_SAFE_INTEGER);
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

    const fullContent = decodeText(await readFile(resolved.absolutePath), resolved.relativePath);
    const useSlice = args.offset !== undefined || args.limit !== undefined;
    let content = fullContent;
    let firstLine = 1;
    let lastLine = fullContent === "" ? 0 : fullContent.split("\n").length;
    if (useSlice) {
      const lines = fullContent.split("\n");
      const startIndex = Math.min(Math.max(0, offset - 1), lines.length);
      const endIndex = limit > 0 ? Math.min(lines.length, startIndex + limit) : lines.length;
      const slice = lines.slice(startIndex, endIndex);
      content = slice.join("\n");
      firstLine = startIndex + 1;
      lastLine = startIndex + slice.length;
    }
    const truncated = content.length > maxChars;
    return {
      path: resolved.relativePath,
      bytes: metadata.size,
      chars: content.length,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
      firstLine,
      lastLine,
      totalLines: fullContent === "" ? 0 : fullContent.split("\n").length,
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
    const root = optionalString(args.root, ".", "root").trim() || ".";
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
    "Search UTF-8 text files in the Strata repo. Pattern is a JavaScript regex by default; pass `literal: true` for substring search. Skips blocked directories and binary files.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pattern: {
        type: "string",
        description: "Regex pattern (or literal string when literal=true).",
      },
      query: {
        type: "string",
        description: "Alias for pattern. Kept for backward compatibility.",
      },
      root: { type: "string", description: "Repo-relative directory or file to search." },
      pathPattern: {
        type: "string",
        description: "Optional path substring or '*'-glob filter for files.",
      },
      ignoreCase: { type: "boolean", description: "Case-insensitive search." },
      caseSensitive: {
        type: "boolean",
        description: "Inverse of ignoreCase. Kept for backward compatibility.",
      },
      literal: {
        type: "boolean",
        description: "Treat pattern as a literal string rather than a regex.",
      },
      context: {
        type: "integer",
        minimum: 0,
        maximum: 50,
        description: "Lines of context before and after each match (default 0).",
      },
      includeRaw: { type: "boolean", description: "Allow searching immutable raw source files." },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      maxFileBytes: { type: "integer", minimum: 1, maximum: MAX_GREP_FILE_BYTES },
    },
  },
  maxResultChars: 96_000,
  async handler(args, context) {
    // Pi calls it `pattern`; strata used to require `query`. Accept either,
    // preferring `pattern` when both are passed.
    const rawPattern =
      typeof args.pattern === "string" && args.pattern.length > 0
        ? args.pattern
        : optionalString(args.query, "", "query");
    if (rawPattern === "") {
      throw new PolicyViolationError("invalid_args", "pattern (or query) is required");
    }
    const root = optionalString(args.root, ".", "root").trim() || ".";
    const pathPattern = optionalString(args.pathPattern, "", "pathPattern");
    // ignoreCase is the canonical name; caseSensitive (legacy) is its inverse.
    let ignoreCase = optionalBoolean(args.ignoreCase, false, "ignoreCase");
    if (args.caseSensitive !== undefined) {
      ignoreCase = !optionalBoolean(args.caseSensitive, true, "caseSensitive");
    }
    const literal = optionalBoolean(args.literal, false, "literal");
    const contextLines = optionalInteger(args.context, 0, "context", 0, 50);
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
    const result = await ripgrepSearch({
      repoRoot: context.repoRoot,
      searchPath: resolved.absolutePath,
      pattern: rawPattern,
      pathPattern,
      ignoreCase,
      literal,
      contextLines,
      limit,
      maxFileBytes,
      includeRaw,
    });
    return {
      pattern: rawPattern,
      root: resolved.relativePath,
      matches: result.matches,
      count: result.matches.length,
      truncated: result.truncated,
    };
  },
};

const fsWriteTool: ToolDefinition<FsWriteArgs> = {
  name: "fs.write",
  description:
    "Create or overwrite a UTF-8 text file inside the Strata repo. Missing parent directories are created automatically. Writes under raw sources are forbidden.",
  mode: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path", "content"],
    properties: {
      path: { type: "string", description: "Repo-relative file path to write." },
      content: { type: "string", description: "UTF-8 text content to write." },
      overwrite: {
        type: "boolean",
        description: "Allow replacing an existing file. Defaults to true.",
      },
      createDirs: {
        type: "boolean",
        description: "Create missing parent directories. Defaults to true.",
      },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_WRITE_CHARS },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const requestedPath = requiredString(args.path, "path");
    const content = requiredString(args.content, "content");
    // Pi-aligned: write creates parent dirs and overwrites by default. Pass
    // `overwrite: false` / `createDirs: false` explicitly when conservative
    // behavior is needed.
    const overwrite = optionalBoolean(args.overwrite, true, "overwrite");
    const createDirs = optionalBoolean(args.createDirs, true, "createDirs");
    const maxChars = optionalInteger(
      args.maxChars,
      DEFAULT_MAX_WRITE_CHARS,
      "maxChars",
      1,
      MAX_WRITE_CHARS,
    );
    if (content.length > maxChars) {
      throw new PolicyViolationError(
        "content_too_large",
        `Content exceeds maxChars (${content.length} > ${maxChars})`,
      );
    }

    return writeTextFile(context, {
      path: requestedPath,
      content,
      overwrite,
      createDirs,
      maxChars,
    });
  },
};

const fsEditTool: ToolDefinition<FsEditArgs> = {
  name: "fs.edit",
  description:
    "Apply one or more targeted UTF-8 text replacements to an existing repo file. Each edit is matched against the ORIGINAL file (not incrementally); overlapping or nested edits must be merged into a single edit. Pass `edits: [{oldText, newText}, ...]` for multi-edit calls, or scalar `oldText`/`newText` for a single edit.",
  mode: "write",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: { type: "string", description: "Repo-relative file path to edit." },
      edits: {
        type: "array",
        description:
          "One or more replacements applied to the original file. Use this OR oldText/newText.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["oldText", "newText"],
          properties: {
            oldText: { type: "string" },
            newText: { type: "string" },
          },
        },
      },
      oldText: { type: "string", description: "Single-edit shortcut. Pi accepts this too." },
      newText: { type: "string", description: "Single-edit shortcut. Pi accepts this too." },
      replaceAll: {
        type: "boolean",
        description:
          "Replace all matches per edit. Defaults to false (each edit must match exactly once).",
      },
      maxFileBytes: { type: "integer", minimum: 1, maximum: MAX_EDIT_FILE_BYTES },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const requestedPath = requiredString(args.path, "path");
    const edits = parseEditArgs(args);
    const replaceAll = optionalBoolean(args.replaceAll, false, "replaceAll");
    const maxFileBytes = optionalInteger(
      args.maxFileBytes,
      DEFAULT_MAX_EDIT_FILE_BYTES,
      "maxFileBytes",
      1,
      MAX_EDIT_FILE_BYTES,
    );
    return editTextFile(context, {
      path: requestedPath,
      edits,
      replaceAll,
      maxFileBytes,
    });
  },
};

function parseEditArgs(args: FsEditArgs): EditTextFileEdit[] {
  if (Array.isArray(args.edits)) {
    if (args.edits.length === 0) {
      throw new PolicyViolationError("invalid_args", "edits must be a non-empty array");
    }
    const out: EditTextFileEdit[] = [];
    for (let i = 0; i < args.edits.length; i += 1) {
      const entry = args.edits[i];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new PolicyViolationError("invalid_args", `edits[${i}] must be an object`);
      }
      const e = entry as Record<string, JsonValue>;
      const oldText = requiredNonEmptyString(e.oldText, `edits[${i}].oldText`);
      const newText = requiredString(e.newText, `edits[${i}].newText`);
      if (oldText === newText) {
        throw new PolicyViolationError(
          "invalid_args",
          `edits[${i}]: oldText and newText must differ`,
        );
      }
      out.push({ oldText, newText });
    }
    return out;
  }
  // Scalar fallback (single edit) — mirrors pi's legacy oldText/newText path.
  const oldText = requiredNonEmptyString(args.oldText, "oldText");
  const newText = requiredString(args.newText, "newText");
  if (oldText === newText) {
    throw new PolicyViolationError("invalid_args", "oldText and newText must differ");
  }
  return [{ oldText, newText }];
}

export async function writeTextFile(
  context: ToolContext,
  input: WriteTextFileInput,
): Promise<WriteTextFileResult> {
  if (input.content.length > input.maxChars) {
    throw new PolicyViolationError(
      "content_too_large",
      `Content exceeds maxChars (${input.content.length} > ${input.maxChars})`,
    );
  }

  const resolved = assertWriteAllowed(context.repoRoot, input.path);
  await rejectSymlinkPathSegments(resolved.repoRoot, resolved.relativePath, {
    allowMissing: true,
  });
  let before: string | null = null;

  return withFileMutationQueue(resolved.absolutePath, async () => {
    const currentExisting = await optionalLstat(resolved.absolutePath);
    if (currentExisting !== undefined) {
      rejectUnreadableEntry(resolved.relativePath, currentExisting);
      if (!input.overwrite) {
        throw new PolicyViolationError(
          "file_exists",
          `File already exists; set overwrite: true to replace it: ${resolved.relativePath}`,
        );
      }
      before = decodeText(await readFile(resolved.absolutePath), resolved.relativePath);
    } else {
      before = null;
    }

    await ensureWritableParent(resolved.repoRoot, resolved.relativePath, resolved.absolutePath, {
      createDirs: input.createDirs,
    });
    await writeFile(resolved.absolutePath, input.content, "utf8");
    const changeType = before === null ? "create" : (input.changeType ?? "update");
    const change = await recordTextFileChange(context, {
      path: resolved.relativePath,
      changeType,
      before,
      after: input.content,
    });

    return {
      path: resolved.relativePath,
      changeType,
      bytes: change.afterBytes,
      hash: change.afterHash,
      overwritten: before !== null,
    };
  });
}

export async function editTextFile(
  context: ToolContext,
  input: EditTextFileInput,
): Promise<EditTextFileResult> {
  if (input.edits.length === 0) {
    throw new PolicyViolationError("invalid_args", "edits must be a non-empty array");
  }

  const resolved = assertWriteAllowed(context.repoRoot, input.path);
  return withFileMutationQueue(resolved.absolutePath, async () => {
    await rejectSymlinkPathSegments(resolved.repoRoot, resolved.relativePath);
    const before = await readEditableTextFile(resolved.absolutePath, resolved.relativePath, {
      maxFileBytes: input.maxFileBytes,
    });

    // Pi's semantics: each edit matches against the ORIGINAL content. Pre-compute
    // every match position, validate (no overlap, exactly one match per edit
    // unless replaceAll), then apply right-to-left so positions don't shift.
    type EditMatch = { editIndex: number; start: number; end: number };
    const allMatches: EditMatch[] = [];
    let totalReplacements = 0;
    for (let editIndex = 0; editIndex < input.edits.length; editIndex += 1) {
      const edit = input.edits[editIndex];
      if (edit === undefined) continue;
      const positions = findAllOccurrences(before, edit.oldText);
      if (positions.length === 0) {
        throw new PolicyViolationError(
          "no_match",
          `edits[${editIndex}].oldText was not found in ${resolved.relativePath}`,
        );
      }
      if (positions.length > 1 && !input.replaceAll) {
        throw new PolicyViolationError(
          "ambiguous_match",
          `edits[${editIndex}].oldText matched ${positions.length} times; set replaceAll: true or use a more specific oldText`,
        );
      }
      for (const start of positions) {
        allMatches.push({ editIndex, start, end: start + edit.oldText.length });
        totalReplacements += 1;
      }
    }

    // Detect overlapping match regions across edits.
    const sorted = allMatches.slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (prev !== undefined && cur !== undefined && cur.start < prev.end) {
        throw new PolicyViolationError(
          "edit_overlap",
          `edits[${prev.editIndex}] and edits[${cur.editIndex}] match overlapping regions; merge them into a single edit`,
        );
      }
    }

    // Apply right-to-left so left-side positions remain valid.
    let after = before;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const m = sorted[i];
      if (m === undefined) continue;
      const edit = input.edits[m.editIndex];
      if (edit === undefined) continue;
      after = after.slice(0, m.start) + edit.newText + after.slice(m.end);
    }
    await writeFile(resolved.absolutePath, after, "utf8");
    const change = await recordTextFileChange(context, {
      path: resolved.relativePath,
      changeType: "update",
      before,
      after,
    });

    // Generate a unified-diff hunk per edit (first match only) and concatenate.
    // Keeps the LLM's view tidy while showing what changed.
    const firstEdit = input.edits[0];
    const diff =
      firstEdit === undefined
        ? ""
        : buildEditDiffString({
            before,
            oldText: firstEdit.oldText,
            newText: firstEdit.newText,
            path: resolved.relativePath,
          });

    return {
      path: resolved.relativePath,
      changeType: "update",
      replacements: totalReplacements,
      bytes: change.afterBytes,
      hash: change.afterHash,
      diff,
    };
  });
}

function findAllOccurrences(haystack: string, needle: string): number[] {
  if (needle === "") return [];
  const out: number[] = [];
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    out.push(idx);
    from = idx + needle.length;
  }
  return out;
}

interface BuildEditDiffOptions {
  before: string;
  oldText: string;
  newText: string;
  path?: string;
}

const DIFF_CONTEXT_LINES = 3;
const DIFF_MAX_LINES = 200;

function buildEditDiffString(options: BuildEditDiffOptions): string {
  const idx = options.before.indexOf(options.oldText);
  if (idx === -1) return "";
  const beforePrefix = options.before.slice(0, idx);
  const beforeSuffix = options.before.slice(idx + options.oldText.length);

  const prefixLines = beforePrefix === "" ? [] : beforePrefix.split("\n");
  const suffixLines = beforeSuffix === "" ? [] : beforeSuffix.split("\n");
  const oldTextLines = options.oldText.split("\n");
  const newTextLines = options.newText.split("\n");

  const contextBefore = prefixLines.slice(Math.max(0, prefixLines.length - DIFF_CONTEXT_LINES));
  const contextAfter = suffixLines.slice(0, DIFF_CONTEXT_LINES);
  const startLine = Math.max(1, prefixLines.length - contextBefore.length + 1);

  const out: string[] = [];
  if (options.path !== undefined) {
    out.push(`--- a/${options.path}`);
    out.push(`+++ b/${options.path}`);
  }
  const oldHunkLength = contextBefore.length + oldTextLines.length + contextAfter.length;
  const newHunkLength = contextBefore.length + newTextLines.length + contextAfter.length;
  out.push(`@@ -${startLine},${oldHunkLength} +${startLine},${newHunkLength} @@`);
  for (const line of contextBefore) out.push(` ${line}`);
  for (const line of oldTextLines) out.push(`-${line}`);
  for (const line of newTextLines) out.push(`+${line}`);
  for (const line of contextAfter) out.push(` ${line}`);

  if (out.length > DIFF_MAX_LINES) {
    const head = out.slice(0, DIFF_MAX_LINES);
    head.push("@@ truncated @@");
    return head.join("\n");
  }
  return out.join("\n");
}

interface RipgrepSearchOptions {
  repoRoot: string;
  searchPath: string;
  pattern: string;
  pathPattern: string;
  ignoreCase: boolean;
  literal: boolean;
  contextLines: number;
  limit: number;
  maxFileBytes: number;
  includeRaw: boolean;
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

// Pi-style: shell out to ripgrep for fast, gitignore-aware search. Honors
// ignoreCase, literal, glob (pathPattern), and context flags. Requires `rg`
// on PATH — fails with a clear message otherwise. Returns structured matches
// shaped to strata's existing `FsGrepMatch` type.
async function ripgrepSearch(
  options: RipgrepSearchOptions,
): Promise<{ matches: FsGrepMatch[]; truncated: boolean }> {
  const { spawn } = await import("node:child_process");
  const { createInterface } = await import("node:readline");

  const args: string[] = [
    "--json",
    "--line-number",
    "--color=never",
    "--hidden",
    `--max-filesize=${options.maxFileBytes}`,
  ];
  if (options.ignoreCase) args.push("--ignore-case");
  if (options.literal) args.push("--fixed-strings");
  if (options.pathPattern !== "") args.push("--glob", options.pathPattern);
  args.push("--", options.pattern, options.searchPath);
  // Note: includeRaw filtering happens as a post-pass after ripgrep returns.
  // ripgrep's --glob is matched relative to the search root, so a "wiki/raw"
  // exclusion wouldn't catch matches when the search itself starts inside
  // wiki/. Filtering on the repo-relative path is correct.

  const matches: FsGrepMatch[] = [];
  let truncated = false;

  const child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout });
  let stderr = "";
  let killedDueToLimit = false;
  let spawnError: Error | undefined;

  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  child.on("error", (error) => {
    spawnError = error;
  });

  rl.on("line", (raw: string) => {
    if (raw.trim() === "" || matches.length >= options.limit) return;
    let event: {
      type?: string;
      data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } };
    };
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.type !== "match") return;
    const filePath = event.data?.path?.text;
    const lineNumber = event.data?.line_number;
    const lineText = event.data?.lines?.text ?? "";
    if (typeof filePath !== "string" || typeof lineNumber !== "number") return;
    const relPath = repoRelativePath(options.repoRoot, filePath);
    if (!options.includeRaw && relPath.startsWith("wiki/raw/")) {
      // Skip immutable raw sources unless the caller explicitly opted in.
      return;
    }
    matches.push({
      path: relPath,
      line: lineNumber,
      preview: lineText.replace(/\n$/, "").trim().slice(0, 240),
    });
    if (matches.length >= options.limit) {
      truncated = true;
      killedDueToLimit = true;
      child.kill();
    }
  });

  const code: number | null = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c));
  });
  rl.close();

  if (spawnError !== undefined) {
    if ((spawnError as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PolicyViolationError(
        "ripgrep_missing",
        "ripgrep (rg) is not installed. Install it (e.g. `brew install ripgrep`, `apt install ripgrep`) and retry.",
      );
    }
    throw new PolicyViolationError("ripgrep_failed", `ripgrep error: ${spawnError.message}`);
  }
  // ripgrep exits 0 on matches, 1 on no matches, 2+ on error. A signal-kill
  // (because we hit the match limit) shows up as code === null.
  if (!killedDueToLimit && code !== null && code !== 0 && code !== 1) {
    throw new PolicyViolationError(
      "ripgrep_failed",
      `ripgrep exited with code ${code}: ${stderr.trim() || "(no stderr)"}`,
    );
  }

  // Pi-style: read each matched file once and slice context lines. Cheaper
  // than asking rg to emit context events, and lets us bound by maxFileBytes.
  if (options.contextLines > 0 && matches.length > 0) {
    const fileLines = new Map<string, string[]>();
    for (const match of matches) {
      let lines = fileLines.get(match.path);
      if (lines === undefined) {
        try {
          const absolute = path.join(options.repoRoot, match.path);
          const content = decodeText(await readFile(absolute), match.path);
          lines = content.split(/\r?\n/);
        } catch {
          lines = [];
        }
        fileLines.set(match.path, lines);
      }
      const idx = match.line - 1;
      const before: string[] = [];
      const after: string[] = [];
      for (let i = Math.max(0, idx - options.contextLines); i < idx; i += 1) {
        before.push((lines[i] ?? "").trim().slice(0, 240));
      }
      for (let i = idx + 1; i < Math.min(lines.length, idx + 1 + options.contextLines); i += 1) {
        after.push((lines[i] ?? "").trim().slice(0, 240));
      }
      match.before = before;
      match.after = after;
    }
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
    if (isBlockedPathSegment(entry.name)) {
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

async function readEditableTextFile(
  absolutePath: string,
  relativePath: string,
  options: { maxFileBytes: number },
): Promise<string> {
  const metadata = await lstat(absolutePath);
  rejectUnreadableEntry(relativePath, metadata);
  if (metadata.size > options.maxFileBytes) {
    throw new PolicyViolationError(
      "file_too_large",
      `File exceeds maxFileBytes (${metadata.size} > ${options.maxFileBytes}): ${relativePath}`,
    );
  }
  return decodeText(await readFile(absolutePath), relativePath);
}

function rejectSymlinkRoot(relativePath: string, metadata: Stats): void {
  if (metadata.isSymbolicLink()) {
    throw new PolicyViolationError(
      "symlink_not_followed",
      `Symlinks are not followed: ${relativePath}`,
    );
  }
}

async function rejectSymlinkPathSegments(
  repoRoot: string,
  relativePath: string,
  options: { allowMissing?: boolean } = {},
): Promise<void> {
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
    const metadata = await optionalLstat(currentPath);
    if (metadata === undefined) {
      if (options.allowMissing === true) {
        return;
      }
      throw new PolicyViolationError("not_found", `Path does not exist: ${relativePath}`);
    }
    if (metadata.isSymbolicLink()) {
      const symlinkPath = segments.slice(0, index + 1).join("/");
      throw new PolicyViolationError(
        "symlink_not_followed",
        `Symlinks are not followed: ${symlinkPath}`,
      );
    }
  }
}

async function ensureWritableParent(
  repoRoot: string,
  relativePath: string,
  absolutePath: string,
  options: { createDirs: boolean },
): Promise<void> {
  const parentPath = path.dirname(absolutePath);
  const parentRelativePath = toPosixPath(path.relative(path.resolve(repoRoot), parentPath));
  const metadata = await optionalLstat(parentPath);
  if (metadata === undefined) {
    if (!options.createDirs) {
      throw new PolicyViolationError(
        "parent_missing",
        `Parent directory does not exist: ${parentRelativePath}`,
      );
    }
    await mkdir(parentPath, { recursive: true });
    return;
  }
  rejectSymlinkRoot(parentRelativePath, metadata);
  if (!metadata.isDirectory()) {
    throw new PolicyViolationError(
      "parent_not_directory",
      `Parent path is not a directory: ${parentRelativePath}`,
    );
  }
}

async function optionalLstat(absolutePath: string): Promise<Stats | undefined> {
  try {
    return await lstat(absolutePath);
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

async function recordTextFileChange(
  context: ToolContext,
  input: {
    path: string;
    changeType: ToolFileChange["changeType"];
    before: string | null;
    after: string;
  },
): Promise<ToolFileChange> {
  const change: ToolFileChange = {
    path: input.path,
    changeType: input.changeType,
    beforeHash: input.before === null ? null : hashText(input.before),
    afterHash: hashText(input.after),
    beforeBytes: input.before === null ? 0 : Buffer.byteLength(input.before, "utf8"),
    afterBytes: Buffer.byteLength(input.after, "utf8"),
    beforePreview: input.before === null ? null : previewText(input.before),
    afterPreview: previewText(input.after),
  };
  await context.recordFileChange?.(change);
  return change;
}

function hashText(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function previewText(value: string): string {
  return value.slice(0, FILE_CHANGE_PREVIEW_CHARS);
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
    const regex = new RegExp(`^${globToRegex(normalizedPattern)}$`, caseSensitive ? "" : "i");
    return (relativePath) => regex.test(relativePath);
  }

  const needle = caseSensitive ? normalizedPattern : normalizedPattern.toLowerCase();
  return (relativePath) => {
    const haystack = caseSensitive ? relativePath : relativePath.toLowerCase();
    return haystack.includes(needle);
  };
}

// Convert a shell-style glob pattern into a regex source.
//
// Pi-aligned semantics:
//   - `**` matches any number of path segments (including zero) and the
//     surrounding path separators.
//   - `*` matches anything except `/`.
//   - `?` matches a single character except `/`.
//   - All other regex metacharacters are escaped literally.
function globToRegex(pattern: string): string {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] ?? "";
    if (ch === "*") {
      // `**/` or `/**`: collapse leading/trailing separator into the wildcard.
      const isDouble = pattern[i + 1] === "*";
      if (isDouble) {
        // Eat `**` and any adjacent slash on either side; emit a permissive
        // "any path / nothing" alternation.
        const prevWasSlash = out.endsWith("/");
        let j = i + 2;
        if (pattern[j] === "/") {
          j += 1;
        }
        if (prevWasSlash) {
          // strip the trailing "/" we already emitted
          out = out.slice(0, -1);
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
        i = j;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if (".+^${}()|[]\\".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
    i += 1;
  }
  return out;
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

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
