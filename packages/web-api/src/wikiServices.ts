import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type { WikiPageDetail, WikiPageGetInput, WikiTreeEntry, WikiTreeInput } from "./trpc.js";

const WIKI_DIR = "wiki";
const DEFAULT_MAX_PAGE_CHARS = 200_000;
const BLOCKED_SEGMENTS = new Set([".git", "node_modules", ".strata"]);

export async function getWikiTree(
  input: WikiTreeInput,
  options: WebApiOptions,
): Promise<{ tree: WikiTreeEntry[] }> {
  const root = wikiRoot(options);
  const tree = await readWikiTree(root, root, input.includeRaw);
  return { tree };
}

export async function getWikiPage(
  input: WikiPageGetInput,
  options: WebApiOptions,
): Promise<WikiPageDetail> {
  const root = wikiRoot(options);
  const relativePath = normalizeWikiPath(input.path, input.includeRaw);
  if (!relativePath.endsWith(".md")) {
    throw new Error(`Wiki page is not Markdown: ${input.path}`);
  }
  const absolutePath = resolveInside(root, relativePath);
  const info = await stat(absolutePath).catch(() => undefined);
  if (info === undefined || !info.isFile()) {
    throw new Error(`Wiki page not found: ${input.path}`);
  }
  const content = await readFile(absolutePath, "utf8");
  if (content.length > DEFAULT_MAX_PAGE_CHARS) {
    return {
      path: relativePath,
      content: content.slice(0, DEFAULT_MAX_PAGE_CHARS),
      chars: content.length,
    };
  }
  return { path: relativePath, content, chars: content.length };
}

async function readWikiTree(
  root: string,
  directory: string,
  includeRaw: boolean,
): Promise<WikiTreeEntry[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const result: WikiTreeEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || BLOCKED_SEGMENTS.has(entry.name)) {
      continue;
    }
    if (!includeRaw && entry.name === "raw" && directory === root) {
      continue;
    }
    const absolutePath = path.join(directory, entry.name);
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (entry.isDirectory()) {
      const children = await readWikiTree(root, absolutePath, includeRaw);
      result.push({ path: relativePath, name: entry.name, type: "directory", children });
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      result.push({ path: relativePath, name: entry.name, type: "file" });
    }
  }

  return result.sort(compareEntries);
}

function compareEntries(a: WikiTreeEntry, b: WikiTreeEntry): number {
  if (a.type !== b.type) {
    return a.type === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function wikiRoot(options: WebApiOptions): string {
  return path.join(repoRoot(options), WIKI_DIR);
}

function normalizeWikiPath(input: string, includeRaw: boolean): string {
  const normalized = toPosix(path.posix.normalize(input.replaceAll("\\", "/")));
  if (normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`Invalid wiki path: ${input}`);
  }
  const segments = normalized.split("/");
  if (
    segments.some((segment) => segment === "" || segment === ".." || BLOCKED_SEGMENTS.has(segment))
  ) {
    throw new Error(`Invalid wiki path: ${input}`);
  }
  if (!includeRaw && segments[0] === "raw") {
    throw new Error("Reading raw wiki pages requires includeRaw.");
  }
  return normalized;
}

function resolveInside(root: string, relativePath: string): string {
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Invalid wiki path: ${relativePath}`);
  }
  return absolutePath;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
