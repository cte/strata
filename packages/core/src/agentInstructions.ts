import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject } from "./types.js";

export interface AgentInstructionFile extends JsonObject {
  path: string;
  content: string;
  chars: number;
  truncated: boolean;
}

const AGENTS_FILE = "AGENTS.md";
const DEFAULT_MAX_AGENT_INSTRUCTION_CHARS = 24_000;

export async function loadAgentInstructionFiles(
  repoRoot: string,
  maxChars = DEFAULT_MAX_AGENT_INSTRUCTION_CHARS,
): Promise<AgentInstructionFile[]> {
  const filePath = path.join(path.resolve(repoRoot), AGENTS_FILE);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const truncated = content.length > maxChars;
  return [
    {
      path: AGENTS_FILE,
      content: truncated ? content.slice(0, maxChars) : content,
      chars: content.length,
      truncated,
    },
  ];
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
