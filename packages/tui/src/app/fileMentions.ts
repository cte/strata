import { spawn } from "node:child_process";
import path from "node:path";
import type { AutocompleteProvider, AutocompleteSuggestions } from "../editor.js";

const MAX_SUGGESTIONS = 20;
const CACHE_TTL_MS = 5_000;

/**
 * Pi-aligned `@` mention provider. Suggests files anywhere under the repo
 * root when the user types `@<query>` in the editor.
 *
 * Pi uses `fd` to enumerate files; cortex uses `rg --files` (already a
 * required dependency for `fs.grep`) which has identical semantics for our
 * purposes — gitignore-aware, hidden-files included, fast on large repos.
 *
 * Scoring follows pi's `scoreEntry`: exact filename match > prefix > name
 * substring > path substring. Top 20 results are surfaced.
 */
interface MentionEntry {
  path: string;
  isDirectory: boolean;
}

export class FileMentionProvider implements AutocompleteProvider {
  private cache: { entries: MentionEntry[]; loadedAt: number } | undefined;
  private inflight: Promise<MentionEntry[]> | undefined;

  constructor(private readonly repoRoot: string) {
    // Kick off an initial load so the first `@` keystroke has results ready.
    void this.refreshCache();
  }

  provide(text: string, cursor: number): AutocompleteSuggestions | undefined {
    const before = text.slice(0, cursor);
    const at = before.lastIndexOf("@");
    if (at === -1) {
      return undefined;
    }
    // Avoid triggering on emails / mid-word `@`. Allow start-of-text or after
    // whitespace / common openers.
    if (at > 0) {
      const prevChar = before.charAt(at - 1);
      if (!/[\s({[<,;]/.test(prevChar)) {
        return undefined;
      }
    }
    const query = before.slice(at + 1);
    if (/\s/.test(query)) {
      // The `@` is no longer the active token (whitespace ended it).
      return undefined;
    }

    // Refresh the cache opportunistically; serve from whatever's there now.
    if (
      this.cache === undefined ||
      Date.now() - this.cache.loadedAt > CACHE_TTL_MS
    ) {
      void this.refreshCache();
    }
    const entries = this.cache?.entries ?? [];
    if (entries.length === 0) {
      return undefined;
    }

    const scored: { entry: MentionEntry; score: number }[] = [];
    if (query === "") {
      // Bare `@` — no scoring, just take a stable slice of the list.
      for (const entry of entries.slice(0, MAX_SUGGESTIONS)) {
        scored.push({ entry, score: 1 });
      }
    } else {
      for (const entry of entries) {
        const score = scoreEntry(entry.path, query, entry.isDirectory);
        if (score > 0) scored.push({ entry, score });
      }
      scored.sort((a, b) => b.score - a.score);
      scored.length = Math.min(scored.length, MAX_SUGGESTIONS);
    }
    if (scored.length === 0) {
      return undefined;
    }

    const items = scored.map(({ entry }) => {
      const baseLabel = path.basename(entry.path);
      const label = entry.isDirectory ? `${baseLabel}/` : baseLabel;
      const value = entry.isDirectory ? `@${entry.path}/` : `@${entry.path}`;
      return {
        label,
        value,
        description: entry.path,
      };
    });
    return { items, replaceStart: at, replaceEnd: cursor };
  }

  private async refreshCache(): Promise<void> {
    if (this.inflight !== undefined) {
      return;
    }
    this.inflight = this.scanRepo();
    try {
      const entries = await this.inflight;
      this.cache = { entries, loadedAt: Date.now() };
    } catch {
      // If rg is missing, leave the cache empty. The mention provider
      // gracefully returns no suggestions; users can still type paths
      // manually.
    } finally {
      this.inflight = undefined;
    }
  }

  private scanRepo(): Promise<MentionEntry[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "rg",
        ["--files", "--hidden", "--glob", "!.git/**"],
        { cwd: this.repoRoot, stdio: ["ignore", "pipe", "ignore"] },
      );
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        // ripgrep exits 0 with output on success, 1 if no files (rare). 2+ is error.
        if (code !== 0 && code !== 1) {
          reject(new Error(`rg --files exited ${code}`));
          return;
        }
        const files = stdout
          .split("\n")
          .map((line) => line.replace(/\r$/, "").trim())
          .filter((line) => line !== "");
        // Derive directory entries from every file's parent chain — pi's
        // mentions surface dirs alongside files (with a `/` suffix). We don't
        // get them from rg directly; building them here keeps the gitignore
        // respect intact (only dirs that contain at least one tracked file).
        const dirSet = new Set<string>();
        for (const filePath of files) {
          const parts = filePath.split("/");
          for (let i = 1; i < parts.length; i += 1) {
            dirSet.add(parts.slice(0, i).join("/"));
          }
        }
        const entries: MentionEntry[] = [];
        for (const dir of dirSet) {
          entries.push({ path: dir, isDirectory: true });
        }
        for (const filePath of files) {
          entries.push({ path: filePath, isDirectory: false });
        }
        entries.sort((a, b) => a.path.localeCompare(b.path));
        resolve(entries);
      });
    });
  }
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
