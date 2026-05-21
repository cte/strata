import path from "node:path";
import { findRepoFiles, type RepoFileEntry } from "@strata/core/repo-files";
import type { AutocompleteProvider, AutocompleteSuggestions } from "../editor.js";

const MAX_SUGGESTIONS = 20;

/**
 * Pi-aligned `@` mention provider. Suggests files anywhere under the repo
 * root when the user types `@<query>` in the editor.
 *
 * Enumeration and scoring live in `@strata/core` so the TUI and browser chat
 * can share the same file-mention data source.
 */
export class FileMentionProvider implements AutocompleteProvider {
  constructor(private readonly repoRoot: string) {}

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

    const entries = findRepoFiles({
      repoRoot: this.repoRoot,
      query,
      limit: MAX_SUGGESTIONS,
    });
    if (entries.length === 0) {
      return undefined;
    }

    const items = entries.map((entry: RepoFileEntry) => {
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
}
