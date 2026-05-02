import type { JsonObject, JsonValue } from "@cortex/core";
import type {
  ToolContext,
  ToolDefinition,
  ToolErrorPayload,
  ToolExecutionResult,
  ToolMetadata,
  ToolMode,
  ToolProfile,
  ToolRegistryOptions,
} from "./types.js";

export class ToolRegistryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ToolRegistryError";
    this.code = code;
  }
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly profile: ToolProfile;

  constructor(options: ToolRegistryOptions = {}) {
    this.profile = options.profile ?? "dangerous";
  }

  register(tool: ToolDefinition): this {
    validateToolName(tool.name);
    if (this.tools.has(tool.name)) {
      throw new ToolRegistryError("duplicate_tool", `Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (tool === undefined) {
      throw new ToolRegistryError("unknown_tool", `Unknown tool: ${name}`);
    }
    return tool;
  }

  getProfile(): ToolProfile {
    return this.profile;
  }

  list(): ToolMetadata[] {
    return [...this.tools.values()]
      .filter((tool) => toolProfileAllowsMode(this.profile, tool.mode))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        mode: tool.mode,
        inputSchema: tool.inputSchema,
        maxResultChars: tool.maxResultChars ?? null,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async execute(name: string, args: JsonObject, context: ToolContext): Promise<JsonValue> {
    const tool = this.getAvailable(name);
    return tool.handler(args, context);
  }

  async safeExecute(
    name: string,
    args: JsonObject,
    context: ToolContext,
  ): Promise<ToolExecutionResult> {
    try {
      const tool = this.getAvailable(name);
      const result = await tool.handler(args, context);
      const limited = limitJsonValue(result, tool.maxResultChars);
      return {
        ok: true,
        toolName: name,
        result: limited.value,
        truncated: limited.truncated,
      };
    } catch (error: unknown) {
      return {
        ok: false,
        toolName: name,
        error: toToolError(error),
        truncated: false,
      };
    }
  }

  private getAvailable(name: string): ToolDefinition {
    const tool = this.get(name);
    if (!toolProfileAllowsMode(this.profile, tool.mode)) {
      throw new ToolRegistryError(
        "tool_unavailable",
        `Tool is not available in the ${this.profile} profile: ${name}`,
      );
    }
    return tool;
  }
}

const TOOL_PROFILE_MODES: Record<ToolProfile, ReadonlySet<ToolMode>> = {
  "read-only": new Set(["read"]),
  maintenance: new Set(["read", "write"]),
  learning: new Set(["read", "learning"]),
  dangerous: new Set(["read", "write", "learning", "dangerous"]),
};

export function toolProfileAllowsMode(profile: ToolProfile, mode: ToolMode): boolean {
  return TOOL_PROFILE_MODES[profile].has(mode);
}

function validateToolName(name: string): void {
  if (!/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(name)) {
    throw new ToolRegistryError(
      "invalid_tool_name",
      `Tool names must be dotted identifiers: ${name}`,
    );
  }
}

function limitJsonValue(
  value: JsonValue,
  maxChars: number | undefined,
): {
  value: JsonValue;
  truncated: boolean;
} {
  if (maxChars === undefined) {
    return { value, truncated: false };
  }

  const encoded = JSON.stringify(value);
  if (encoded.length <= maxChars) {
    return { value, truncated: false };
  }

  return {
    value: {
      truncated: true,
      preview: encoded.slice(0, maxChars),
      originalChars: encoded.length,
    },
    truncated: true,
  };
}

function toToolError(error: unknown): ToolErrorPayload {
  if (error instanceof ToolRegistryError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "tool_error", message: error.message };
  }
  return { code: "tool_error", message: String(error) };
}
