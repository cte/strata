import { readFile } from "node:fs/promises";
import path from "node:path";
import { getCortexPaths } from "./paths.js";
import { CortexStateError } from "./stateErrors.js";
import type { JsonObject } from "./types.js";

export interface TraceEntry extends JsonObject {
  id: number;
  sessionId: string;
  ts: string;
  type: string;
  payload: JsonObject;
}

export interface SessionTrace extends JsonObject {
  path: string;
  entries: TraceEntry[];
  text: string;
  chars: number;
  truncated: boolean;
}

export async function readSessionTrace(
  repoRoot: string,
  sessionId: string,
  maxChars = Number.POSITIVE_INFINITY,
): Promise<SessionTrace> {
  const file = sessionTracePath(repoRoot, sessionId);
  const fullText = await readFile(file, "utf8");
  const truncated = fullText.length > maxChars;
  const text = truncated ? trimToCompleteJsonlLines(fullText.slice(-maxChars)) : fullText;
  return {
    path: path.relative(repoRoot, file),
    entries: parseTraceEntries(text, file),
    text,
    chars: fullText.length,
    truncated,
  };
}

export function sessionTracePath(repoRoot: string, sessionId: string): string {
  return path.join(getCortexPaths(repoRoot).traceDir, `${sessionId}.jsonl`);
}

function trimToCompleteJsonlLines(text: string): string {
  const firstNewline = text.indexOf("\n");
  if (firstNewline === -1) {
    return "";
  }
  return text.slice(firstNewline + 1);
}

function parseTraceEntries(text: string, file: string): TraceEntry[] {
  const entries: TraceEntry[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") {
      continue;
    }
    const parsed = JSON.parse(line) as Partial<TraceEntry>;
    if (!isTraceEntry(parsed)) {
      throw new CortexStateError(
        "trace_invalid",
        `Invalid trace entry in ${file} at line ${index + 1}`,
      );
    }
    entries.push(parsed);
  }
  return entries;
}

function isTraceEntry(value: Partial<TraceEntry>): value is TraceEntry {
  return (
    typeof value.id === "number" &&
    typeof value.sessionId === "string" &&
    typeof value.ts === "string" &&
    typeof value.type === "string" &&
    typeof value.payload === "object" &&
    value.payload !== null &&
    !Array.isArray(value.payload)
  );
}
