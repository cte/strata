import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Shared filesystem primitives for the Learning-artifact stores (memory,
 * todo, skill, proposal). These four stores have meaningfully different
 * shapes — Memory has two named docs, Todo is one big JSON file, Skills are
 * a recursive directory tree, Proposals are per-session subdirectories — but
 * they all duplicated the same handful of I/O concerns: classifying ENOENT
 * vs other errors, truncating Markdown to fit an agent prompt budget,
 * `mkdir -p` + write atomicity, JSON parse safety. This module concentrates
 * those concerns so each artifact store can focus on its actual schema.
 */

/** True iff `error` is the ENOENT case from `node:fs/promises`. */
export function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

export interface TruncatedText {
  content: string;
  chars: number;
  truncated: boolean;
}

/**
 * Truncate a string to fit an agent prompt budget. Returns the original
 * length as `chars` (the *full* size, before slicing) so callers can show
 * "X of Y characters shown" hints without re-reading the file.
 */
export function truncateForAgent(value: string, maxChars: number): TruncatedText {
  if (!Number.isFinite(maxChars) || maxChars < 0) {
    return { content: value, chars: value.length, truncated: false };
  }
  if (value.length <= maxChars) {
    return { content: value, chars: value.length, truncated: false };
  }
  return { content: value.slice(0, maxChars), chars: value.length, truncated: true };
}

/**
 * Read a UTF-8 text file. Returns `undefined` for ENOENT, propagates other
 * errors. Use this whenever a missing file is a *valid* state (e.g. a
 * Memory document the user hasn't created yet).
 */
export async function readTextFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Read a JSON file. Returns `undefined` for ENOENT, propagates parse errors
 * and other I/O errors. The parse fault is intentional: silent recovery from
 * malformed JSON would mask data corruption.
 */
export async function readJsonFileOrUndefined<T>(filePath: string): Promise<T | undefined> {
  const text = await readTextFileOrUndefined(filePath);
  if (text === undefined) {
    return undefined;
  }
  return JSON.parse(text) as T;
}

/**
 * Write `content` to `filePath`, creating parent directories as needed. Not
 * atomic against process crashes — callers that need crash safety should
 * write to a temp path and rename. For Strata's local Learning-artifact
 * stores the simpler write-in-place is what every site already used.
 */
export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

/**
 * Write `value` as pretty-printed JSON. Companion to `readJsonFileOrUndefined`.
 */
export async function writeJsonFile<T>(filePath: string, value: T): Promise<void> {
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
