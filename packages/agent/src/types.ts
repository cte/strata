import type { JsonObject, JsonValue, SessionStatus } from "@strata/core/types";
import type {
  ToolExecutionMode,
  ToolExecutionResult,
  ToolMetadata,
  ToolRegistry,
} from "@strata/tools/types";

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
  /**
   * Streaming hook for model reasoning/thinking summary fragments, when the
   * provider streams them (OpenAI reasoning summaries, Anthropic thinking
   * blocks). Separate from `onAssistantDelta` so the visible answer and the
   * thinking trace stay distinct in the UI.
   */
  onReasoningDelta?(delta: string): void;
}

export interface ModelResponse {
  content: string;
  toolCalls: AgentToolCall[];
  finishReason: string;
  providerResponseId?: string;
  usage?: JsonObject;
  /** Concatenated reasoning/thinking summary text, when the provider emitted any. */
  reasoning?: string;
  /**
   * Opaque provider payload needed to replay this turn's reasoning on the next
   * request (OpenAI: JSON-encoded reasoning item incl. encrypted content;
   * Anthropic: the thinking block signature). Captured for multi-turn
   * continuity; not shown to the user.
   */
  reasoningSignature?: string;
}

export interface ModelAdapter {
  readonly name: string;
  /** Model context window in tokens, when known. Used for shared auto-compaction. */
  readonly contextWindow?: number;
  /** Whether/how this model supports Pi-style thinking levels. */
  readonly capabilities?: {
    reasoning: boolean;
    thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  };
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
  // If set, this run continues an existing session from its current transcript.
  // The run appends `question` as the next user turn unless the caller already
  // persisted an identical trailing user message. After that, Pi-compatible
  // continuation requires the context to end in a user or tool message;
  // otherwise the run is rejected before calling the model.
  continueSessionId?: string;

  /**
   * Retry transient model transport failures before marking the run failed.
   * Attempts are total attempts, including the first request.
   */
  modelRetryPolicy?: ModelRetryPolicy;

  /**
   * Enables Pi-style auto-compaction after successful over-threshold turns,
   * before continuing sessions whose previous turn crossed the threshold, and
   * once after a detected context-overflow error. Defaults to true when a
   * context window is known for threshold checks.
   */
  autoCompact?: boolean;
  /** Optional override when the model adapter does not expose a context window. */
  contextWindow?: number;
  /** Reserved headroom before auto-compaction triggers. Defaults to Pi's 16k. */
  autoCompactReserveTokens?: number;
  /**
   * Pi-compatible execution strategy for multiple tool calls in one assistant
   * message. Defaults to `parallel`; any called tool with
   * `executionMode: "sequential"` forces the whole batch sequential.
   */
  toolExecution?: ToolExecutionMode;

  /**
   * Returns steering messages to inject while the agent is still working.
   *
   * Pi-compatible drain point: called after the current assistant response and
   * any tool calls from that response finish, before the next model request.
   * Callers should return [] when no messages are pending.
   */
  getSteeringMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;

  /**
   * Returns follow-up messages to process after the agent would otherwise stop.
   *
   * Pi-compatible drain point: called only when there are no tool calls left and
   * no steering messages waiting. Callers should return [] when no messages are
   * pending.
   */
  getFollowUpMessages?: () => AgentMessage[] | Promise<AgentMessage[]>;
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
  | { type: "message.user"; content: string; attachments?: AgentAttachment[] }
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
  | { type: "assistant.reasoning"; iteration: number; reasoningDelta: string }
  | {
      type: "model.response";
      iteration: number;
      content: string;
      toolCalls: AgentToolCall[];
      usage?: JsonObject;
      /** Full reasoning/thinking summary text for this turn, when present. */
      reasoning?: string;
    }
  | {
      type: "compaction.started";
      reason: "threshold" | "overflow";
      latestContextTokens: number;
      contextWindow: number;
      reserveTokens: number;
    }
  | {
      type: "compaction.completed";
      reason: "threshold" | "overflow";
      sessionId: string;
      messagesSummarized: number;
      incremental: boolean;
    }
  | { type: "compaction.failed"; reason: "threshold" | "overflow"; message: string }
  | {
      type: "tool.call.started";
      toolCallId: string;
      toolName: string;
      argumentsText: string;
    }
  | { type: "tool.output"; toolCallId: string; stream: "stdout" | "stderr"; textDelta: string }
  | { type: "tool.call.completed"; toolCallId: string; result: ToolExecutionResult }
  | { type: "agent.completed"; result: AgentRunResult }
  | { type: "agent.failed"; message: string; result?: AgentRunResult };
