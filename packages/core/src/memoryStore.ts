import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrataPaths } from "./paths.js";
import { StrataStateError } from "./stateErrors.js";
import type { JsonObject } from "./types.js";

export type MemoryTarget = "user" | "operations";
export type MemoryReadTarget = MemoryTarget | "all";

export interface MemoryDocument extends JsonObject {
  target: MemoryTarget;
  path: string;
  exists: boolean;
  chars: number;
  content: string;
  truncated: boolean;
}

const MEMORY_FILES: Record<MemoryTarget, string> = {
  user: "USER.md",
  operations: "OPERATIONS.md",
};

const MEMORY_TITLES: Record<MemoryTarget, string> = {
  user: "User Memory",
  operations: "Operations Memory",
};

export async function readMemoryDocument(
  repoRoot: string,
  target: MemoryTarget,
  maxChars = 4_000,
): Promise<MemoryDocument> {
  const file = memoryDocumentPath(repoRoot, target);
  try {
    const content = await readFile(file, "utf8");
    const truncated = content.length > maxChars;
    return {
      target,
      path: path.relative(repoRoot, file),
      exists: true,
      chars: content.length,
      content: truncated ? content.slice(0, maxChars) : content,
      truncated,
    };
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return {
        target,
        path: path.relative(repoRoot, file),
        exists: false,
        chars: 0,
        content: "",
        truncated: false,
      };
    }
    throw error;
  }
}

export async function readMemoryDocuments(
  repoRoot: string,
  target: MemoryReadTarget = "all",
  maxChars = 4_000,
): Promise<MemoryDocument[]> {
  const targets = target === "all" ? (["user", "operations"] as const) : ([target] as const);
  return Promise.all(targets.map((candidate) => readMemoryDocument(repoRoot, candidate, maxChars)));
}

export async function writeMemoryDocument(
  repoRoot: string,
  target: MemoryTarget,
  content: string,
  maxChars = Number.POSITIVE_INFINITY,
): Promise<MemoryDocument> {
  const file = memoryDocumentPath(repoRoot, target);
  const normalized = ensureTrailingNewline(content);
  if (normalized.length > maxChars) {
    throw new StrataStateError(
      "memory_too_large",
      `Memory content exceeds maxChars (${normalized.length} > ${maxChars})`,
    );
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, normalized, "utf8");
  return readMemoryDocument(repoRoot, target, Number.POSITIVE_INFINITY);
}

export async function appendMemoryEntry(
  repoRoot: string,
  target: MemoryTarget,
  entry: string,
  heading?: string,
  maxChars = Number.POSITIVE_INFINITY,
): Promise<MemoryDocument> {
  const current = await readMemoryDocument(repoRoot, target, Number.POSITIVE_INFINITY);
  const initial = current.exists ? current.content : `# ${MEMORY_TITLES[target]}\n`;
  const next = `${initial.trimEnd()}${formatMemoryEntry(entry, heading)}`;
  if (next.length > maxChars) {
    throw new StrataStateError(
      "memory_too_large",
      `Memory content exceeds maxChars (${next.length} > ${maxChars})`,
    );
  }
  return writeMemoryDocument(repoRoot, target, next);
}

export function memoryDocumentPath(repoRoot: string, target: MemoryTarget): string {
  const filename = MEMORY_FILES[target];
  if (filename === undefined) {
    throw new StrataStateError("invalid_memory_target", `Invalid memory target: ${target}`);
  }
  return path.join(getStrataPaths(repoRoot).memoryDir, filename);
}

function formatMemoryEntry(entry: string, heading: string | undefined): string {
  const line = `- ${entry.trim()}`;
  if (heading === undefined || heading.trim() === "") {
    return `\n\n${line}\n`;
  }
  return `\n\n## ${heading.trim()}\n\n${line}\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
