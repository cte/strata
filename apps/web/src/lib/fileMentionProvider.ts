import { type ChatFileEntry, listChatFiles } from "@/lib/api";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@/lib/useAutocomplete";

const MAX_FILE_SUGGESTIONS = 20;
const TOKEN_START_PATTERN = /[\s({[<,;]/;

export interface FileMentionProviderOptions {
  limit?: number;
  listFiles?: (query: string, limit: number) => Promise<ChatFileEntry[]>;
}

export interface FileMentionToken {
  query: string;
  replaceStart: number;
  replaceEnd: number;
}

export function createFileMentionProvider(
  options: FileMentionProviderOptions = {},
): AutocompleteProvider {
  const limit = options.limit ?? MAX_FILE_SUGGESTIONS;
  const listFiles = options.listFiles ?? listChatFiles;
  return {
    id: "file-mentions",
    async provide({ text, cursor, signal }): Promise<AutocompleteSuggestions | undefined> {
      const token = findFileMentionToken(text, cursor);
      if (token === undefined || signal.aborted) {
        return undefined;
      }
      const entries = await listFiles(token.query, limit);
      if (signal.aborted || entries.length === 0) {
        return undefined;
      }
      return {
        replaceStart: token.replaceStart,
        replaceEnd: token.replaceEnd,
        items: entries.map((entry) => ({
          label: entry.isDirectory ? `${baseName(entry.path)}/` : baseName(entry.path),
          value: entry.isDirectory ? `@${entry.path}/` : `@${entry.path}`,
          description: entry.path,
          kind: entry.isDirectory ? "directory" : "file",
        })),
      };
    },
  };
}

export function findFileMentionToken(text: string, cursor: number): FileMentionToken | undefined {
  const before = text.slice(0, cursor);
  const at = before.lastIndexOf("@");
  if (at === -1) {
    return undefined;
  }
  if (at > 0 && !TOKEN_START_PATTERN.test(before.charAt(at - 1))) {
    return undefined;
  }
  const query = before.slice(at + 1);
  if (/\s/.test(query)) {
    return undefined;
  }
  return {
    query,
    replaceStart: at,
    replaceEnd: cursor,
  };
}

function baseName(filePath: string): string {
  const parts = filePath.split("/");
  return parts.at(-1) ?? filePath;
}
