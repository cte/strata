import type { JsonObject, JsonValue, SessionStatus } from "@cortex/core";
import type { ToolMetadata, ToolRegistry } from "@cortex/tools";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
}

export interface ModelRequest {
  messages: AgentMessage[];
  tools: ToolMetadata[];
}

export interface ModelResponse {
  content: string;
  toolCalls: AgentToolCall[];
  finishReason: string;
  providerResponseId?: string;
  usage?: JsonObject;
}

export interface ModelAdapter {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export interface AgentRunConfig {
  question: string;
  model: ModelAdapter;
  tools?: ToolRegistry;
  repoRoot?: string;
  sessionTitle?: string;
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface AgentRunResult {
  sessionId: string;
  status: Exclude<SessionStatus, "running">;
  stoppedReason: "final_answer" | "max_iterations" | "max_tool_calls" | "model_error";
  finalAnswer: string;
  iterations: number;
  toolCalls: number;
}

export interface ParsedToolArguments {
  ok: true;
  value: JsonObject;
}

export interface InvalidToolArguments {
  ok: false;
  error: JsonObject;
}

export type ToolArgumentParseResult = ParsedToolArguments | InvalidToolArguments;

export type ToolResultContent = JsonValue;
