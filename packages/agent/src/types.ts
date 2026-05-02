import type { JsonObject, JsonValue, SessionStatus } from "@cortex/core";
import type { ToolExecutionResult, ToolMetadata, ToolRegistry } from "@cortex/tools";

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
  signal?: AbortSignal;
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
  signal?: AbortSignal;
}

export interface AgentRunResult {
  sessionId: string;
  status: Exclude<SessionStatus, "running">;
  stoppedReason: "final_answer" | "max_iterations" | "max_tool_calls" | "model_error" | "cancelled";
  finalAnswer: string;
  iterations: number;
  toolCalls: number;
}

export type ToolResultContent = JsonValue;

export type AgentRunEvent =
  | { type: "session.started"; sessionId: string; title: string; model: string }
  | { type: "message.user"; content: string }
  | { type: "model.request"; iteration: number; messageCount: number }
  | {
      type: "model.response";
      iteration: number;
      content: string;
      toolCalls: AgentToolCall[];
    }
  | {
      type: "tool.call.started";
      toolCallId: string;
      toolName: string;
      argumentsText: string;
    }
  | { type: "tool.call.completed"; toolCallId: string; result: ToolExecutionResult }
  | { type: "agent.completed"; result: AgentRunResult }
  | { type: "agent.failed"; message: string; result?: AgentRunResult };
