import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE_NAME = "history.jsonl";
const MAX_ENTRIES = 100;

/**
 * Loads the persisted prompt history (one JSON-encoded string per line).
 * Returns entries in chronological order: oldest first, most recent last —
 * matching the convention used by `Editor.history`.
 */
export async function loadHistory(runtimeDir: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(runtimeDir, FILE_NAME), "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string" && parsed !== "") {
        out.push(parsed);
      }
    } catch {
      // Skip malformed entries; don't fail the whole load.
    }
  }
  return out;
}

/**
 * Append a single prompt to the history file. No-op if blank or a duplicate of
 * the most recent entry. Caps the file at MAX_ENTRIES by trimming the front.
 */
export async function appendHistory(runtimeDir: string, prompt: string): Promise<void> {
  const value = prompt.trim();
  if (value === "") return;
  const existing = await loadHistory(runtimeDir);
  if (existing.length > 0 && existing[existing.length - 1] === value) {
    return;
  }
  existing.push(value);
  const trimmed = existing.length > MAX_ENTRIES ? existing.slice(-MAX_ENTRIES) : existing;
  await mkdir(runtimeDir, { recursive: true });
  const body = `${trimmed.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await writeFile(path.join(runtimeDir, FILE_NAME), body, "utf8");
}
