import { spawnSync } from "node:child_process";
import path from "node:path";
import { getStrataPaths } from "./paths.js";

const CACHE_TTL_MS = 5_000;
const DEFAULT_LIMIT = 20;

export interface RepoFileEntry {
  path: string;
  isDirectory: boolean;
}

export interface FindRepoFilesOptions {
  query: string;
  repoRoot?: string;
  limit?: number;
}

interface RepoFileCacheEntry {
  entries: RepoFileEntry[];
  loadedAt: number;
}

const repoFileCache = new Map<string, RepoFileCacheEntry>();

export function findRepoFiles(options: FindRepoFilesOptions): RepoFileEntry[] {
  const repoRoot = getStrataPaths(options.repoRoot).repoRoot;
  const entries = repoEntries(repoRoot);
  const limit = positiveLimit(options.limit);
  if (options.query === "") {
    return entries.slice(0, limit);
  }

  const scored: Array<{ entry: RepoFileEntry; score: number }> = [];
  for (const entry of entries) {
    const score = scoreEntry(entry.path, options.query, entry.isDirectory);
    if (score > 0) {
      scored.push({ entry, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ entry }) => entry);
}

function repoEntries(repoRoot: string): RepoFileEntry[] {
  const now = Date.now();
  const cached = repoFileCache.get(repoRoot);
  if (cached !== undefined && now - cached.loadedAt <= CACHE_TTL_MS) {
    return cached.entries;
  }
  const entries = scanRepo(repoRoot);
  repoFileCache.set(repoRoot, { entries, loadedAt: now });
  return entries;
}

function scanRepo(repoRoot: string): RepoFileEntry[] {
  const result = spawnSync("rg", ["--files", "--hidden", "--glob", "!.git/**"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
    return [];
  }
  const files = String(result.stdout ?? "")
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line !== "");

  const dirSet = new Set<string>();
  for (const filePath of files) {
    const parts = filePath.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      dirSet.add(parts.slice(0, i).join("/"));
    }
  }

  const entries: RepoFileEntry[] = [];
  for (const dir of dirSet) {
    entries.push({ path: dir, isDirectory: true });
  }
  for (const filePath of files) {
    entries.push({ path: filePath, isDirectory: false });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function positiveLimit(limit: number | undefined): number {
  return typeof limit === "number" && Number.isFinite(limit) && limit > 0
    ? Math.floor(limit)
    : DEFAULT_LIMIT;
}

// Pi-aligned `scoreEntry`: weighted by where the query lands in the path.
// Higher score = better match. Directories get a +10 bonus to surface above
// files when basename scores tie. Returns 0 when no match.
function scoreEntry(filePath: string, query: string, isDirectory: boolean): number {
  const lowerQuery = query.toLowerCase();
  const fileName = path.basename(filePath);
  const lowerFileName = fileName.toLowerCase();
  const lowerPath = filePath.toLowerCase();

  let score = 0;
  if (lowerFileName === lowerQuery) score = 100;
  else if (lowerFileName.startsWith(lowerQuery)) score = 80;
  else if (lowerFileName.includes(lowerQuery)) score = 50;
  else if (lowerPath.includes(lowerQuery)) score = 30;

  if (isDirectory && score > 0) score += 10;
  return score;
}
