import type { JsonObject, JsonValue } from "@strata/core/types";

export type { ToolRegistry } from "./registry.js";

export type ToolMode = "read" | "write" | "learning" | "dangerous";
export type ToolProfile = "read-only" | "maintenance" | "learning" | "dangerous";
export type ToolExecutionMode = "sequential" | "parallel";

export interface ToolRegistryOptions {
  profile?: ToolProfile;
}

export interface ToolContext {
  repoRoot: string;
  sessionId?: string;
  toolCallId?: string;
  /** Active run cancellation signal, forwarded to tools that can stop work early. */
  signal?: AbortSignal;
  recordFileChange?: (change: ToolFileChange) => Promise<void> | void;
  /**
   * Optional sink for incremental tool output (e.g. a shell command's
   * stdout/stderr as it runs). Tools that produce streamable output call this
   * with each chunk; the runtime surfaces it as `tool.output` run events so UIs
   * can render output live instead of only at completion.
   */
  onOutput?: (chunk: ToolOutputChunk) => void;
}

export interface ToolOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ToolFileChange extends JsonObject {
  path: string;
  changeType: "create" | "update" | "append";
  beforeHash: string | null;
  afterHash: string;
  beforeBytes: number;
  afterBytes: number;
  beforePreview: string | null;
  afterPreview: string;
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
  /**
   * Per-tool execution mode override for batches containing multiple tool calls.
   * `sequential` forces the whole batch to run one at a time; `parallel`
   * allows this tool to run concurrently when the agent loop is in parallel mode.
   */
  executionMode?: ToolExecutionMode;
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
