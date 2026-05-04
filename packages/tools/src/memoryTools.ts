import {
  appendMemoryEntry,
  readMemoryDocuments,
  writeMemoryDocument,
  type MemoryReadTarget,
  type MemoryTarget,
} from "@cortex/core";
import type { JsonObject, JsonValue } from "@cortex/core";
import {
  optionalEnum,
  optionalInteger,
  optionalString,
  requiredEnum,
  requiredNonEmptyString,
  requiredString,
} from "./args.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

interface MemoryReadArgs extends JsonObject {
  target?: JsonValue;
  maxChars?: JsonValue;
}

interface MemoryWriteArgs extends JsonObject {
  target?: JsonValue;
  content?: JsonValue;
  maxChars?: JsonValue;
}

interface MemoryAppendArgs extends JsonObject {
  target?: JsonValue;
  entry?: JsonValue;
  heading?: JsonValue;
  maxChars?: JsonValue;
}

const MEMORY_TARGETS = ["user", "operations"] as const satisfies readonly MemoryTarget[];
const MEMORY_READ_TARGETS = [
  "all",
  "user",
  "operations",
] as const satisfies readonly MemoryReadTarget[];
const DEFAULT_MAX_READ_CHARS = 4_000;
const MAX_MEMORY_CHARS = 12_000;

export function registerMemoryTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createMemoryTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createMemoryTools(): ToolDefinition[] {
  return [memoryReadTool, memoryWriteTool, memoryAppendTool];
}

const memoryReadTool: ToolDefinition<MemoryReadArgs> = {
  name: "memory.read",
  description: "Read bounded Cortex user and operations memory from .cortex/memory.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      target: { type: "string", enum: ["all", "user", "operations"], default: "all" },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_MEMORY_CHARS },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const target = optionalEnum(args.target, "all", MEMORY_READ_TARGETS, "target");
    const maxChars = optionalInteger(
      args.maxChars,
      DEFAULT_MAX_READ_CHARS,
      "maxChars",
      1,
      MAX_MEMORY_CHARS,
    );
    const documents = await readMemoryDocuments(context.repoRoot, target, maxChars);
    return { documents, count: documents.length };
  },
};

const memoryWriteTool: ToolDefinition<MemoryWriteArgs> = {
  name: "memory.write",
  description: "Replace one Cortex memory document. Use compact declarative facts, not secrets.",
  mode: "learning",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["target", "content"],
    properties: {
      target: { type: "string", enum: ["user", "operations"] },
      content: { type: "string" },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_MEMORY_CHARS },
    },
  },
  maxResultChars: 16_000,
  async handler(args, context) {
    const target = requiredEnum(args.target, MEMORY_TARGETS, "target");
    const content = requiredString(args.content, "content");
    const maxChars = optionalInteger(
      args.maxChars,
      MAX_MEMORY_CHARS,
      "maxChars",
      1,
      MAX_MEMORY_CHARS,
    );
    const document = await writeMemoryDocument(context.repoRoot, target, content, maxChars);
    return { document };
  },
};

const memoryAppendTool: ToolDefinition<MemoryAppendArgs> = {
  name: "memory.append",
  description: "Append one compact declarative fact to Cortex memory.",
  mode: "learning",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["target", "entry"],
    properties: {
      target: { type: "string", enum: ["user", "operations"] },
      entry: { type: "string" },
      heading: { type: "string" },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_MEMORY_CHARS },
    },
  },
  maxResultChars: 16_000,
  async handler(args, context) {
    const target = requiredEnum(args.target, MEMORY_TARGETS, "target");
    const entry = requiredNonEmptyString(args.entry, "entry");
    const heading = optionalString(args.heading, "", "heading");
    const maxChars = optionalInteger(
      args.maxChars,
      MAX_MEMORY_CHARS,
      "maxChars",
      1,
      MAX_MEMORY_CHARS,
    );
    const document = await appendMemoryEntry(
      context.repoRoot,
      target,
      entry,
      heading === "" ? undefined : heading,
      maxChars,
    );
    return { document };
  },
};
