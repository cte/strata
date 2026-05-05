import { type Dirent, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { AutocompleteProvider, AutocompleteSuggestions } from "../editor.js";

const MAX_SUGGESTIONS = 8;
const CACHE_TTL_MS = 5_000;
const SKIP_DIRS = new Set(["raw"]); // wiki/raw/ holds source material; not user-facing

/**
 * Suggests `@<wiki-page>` completions when the user types `@` in the editor.
 *
 * The `@` token can appear anywhere in the prompt — the provider only replaces
 * the token, not the whole input. Triggered when `@` follows whitespace or the
 * start of input (so we don't fire on emails like `cestreich@gmail.com`).
 */
export class FileMentionProvider implements AutocompleteProvider {
  private cache: { files: string[]; loadedAt: number } | undefined;

  constructor(private readonly wikiDir: string) {}

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
    const prefix = before.slice(at + 1);
    if (/\s/.test(prefix)) {
      // The `@` is no longer the active token (whitespace ended it).
      return undefined;
    }

    const files = this.loadFiles();
    if (files.length === 0) {
      return undefined;
    }
    const lower = prefix.toLowerCase();
    const items = files
      .filter((f) => lower === "" || f.toLowerCase().includes(lower))
      .slice(0, MAX_SUGGESTIONS)
      .map((f) => ({
        label: `@${f}`,
        value: `@${f}`,
        description: "wiki page",
      }));

    if (items.length === 0) {
      return undefined;
    }

    return { items, replaceStart: at, replaceEnd: cursor };
  }

  private loadFiles(): string[] {
    const now = Date.now();
    if (this.cache !== undefined && now - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.files;
    }
    const files = scanWiki(this.wikiDir);
    this.cache = { files, loadedAt: now };
    return files;
  }
}

function scanWiki(wikiDir: string): string[] {
  if (!existsSync(wikiDir)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const sub = path.join(dir, entry.name);
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(sub, rel);
      } else if (entry.name.endsWith(".md")) {
        out.push(rel.slice(0, -3));
      }
    }
  };
  walk(wikiDir, "");
  out.sort();
  return out;
}
