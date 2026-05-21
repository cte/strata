import type { JsonObject, JsonValue, SessionStatus } from "@strata/core/types";
import type { ToolExecutionResult, ToolMetadata, ToolRegistry } from "@strata/tools/types";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export interface AgentImageAttachment {
  kind: "image";
  /** A MIME type like "image/png" or "image/jpeg". */
  mimeType: string;
  /** Base64-encoded image bytes (no `data:` prefix). */
  dataBase64: string;
  /** Optional original filename, used only for display. */
  name?: string;
}

export type AgentAttachment = AgentImageAttachment;

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: AgentToolCall[];
  /**
   * Multimodal attachments associated with this message. Adapters convert them
   * into provider-specific content parts; if absent, the message is sent as
   * plain text exactly as before.
   */
  attachments?: AgentAttachment[];
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export interface ModelRequest {
  messages: AgentMessage[];
  tools: ToolMetadata[];
  signal?: AbortSignal;
  reasoningEffort?: ThinkingLevel;
  /**
   * Streaming hook. Adapters that parse SSE deltas call this for each text
   * fragment as it arrives. Adapters that don't stream (e.g. blocking chat
   * completions) simply omit the call. Pi-aligned: deltas are text-only;
   * tool-call argument streaming is not exposed here yet.
   */
  onAssistantDelta?(delta: string): void;
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
  signal?: AbortSignal;
  reasoningEffort?: ThinkingLevel;
  /** Optional image (and future: audio/file) attachments for this user turn. */
  attachments?: AgentAttachment[];
  /**
   * If set, this run continues an existing session: prior assistant/user/tool
   * messages are loaded from the session DB and seeded into the model context.
   * The system prompt and run-context (memory/todos/skills) are rebuilt fresh
   * each run, so they always reflect current state.
   */
  continueSessionId?: string;
  /**
   * Retry transient model transport failures before marking the run failed.
   * Attempts are total attempts, including the first request.
   */
  modelRetryPolicy?: ModelRetryPolicy;
}

export interface AgentRunResult {
  sessionId: string;
  status: Exclude<SessionStatus, "running">;
  stoppedReason: "final_answer" | "model_error" | "cancelled";
  finalAnswer: string;
  iterations: number;
  toolCalls: number;
}

export interface ModelRetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

export type ToolResultContent = JsonValue;

export type AgentRunEvent =
  | { type: "session.started"; sessionId: string; title: string; model: string }
  | { type: "message.user"; content: string }
  | { type: "model.request"; iteration: number; messageCount: number; attempt?: number }
  | {
      type: "model.retry";
      iteration: number;
      attempt: number;
      nextAttempt: number;
      maxAttempts: number;
      delayMs: number;
      message: string;
    }
  | { type: "assistant.delta"; iteration: number; contentDelta: string }
  | {
      type: "model.response";
      iteration: number;
      content: string;
      toolCalls: AgentToolCall[];
      usage?: JsonObject;
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
