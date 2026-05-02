import type { JsonObject, JsonValue } from "@cortex/core";

export type ToolMode = "read" | "write" | "learning" | "dangerous";

export interface ToolContext {
  repoRoot: string;
  sessionId?: string;
}

export interface ToolDefinition<
  TArgs extends JsonObject = JsonObject,
  TResult extends JsonValue = JsonValue,
> {
  name: string;
  description: string;
  mode: ToolMode;
  inputSchema: JsonObject;
  maxResultChars?: number;
  handler: (args: TArgs, context: ToolContext) => TResult | Promise<TResult>;
}

export interface ToolMetadata {
  name: string;
  description: string;
  mode: ToolMode;
  inputSchema: JsonObject;
  maxResultChars: number | null;
}

export interface ToolErrorPayload {
  code: string;
  message: string;
}

export type ToolExecutionResult =
  | {
      ok: true;
      toolName: string;
      result: JsonValue;
      truncated: boolean;
    }
  | {
      ok: false;
      toolName: string;
      error: ToolErrorPayload;
      truncated: false;
    };
