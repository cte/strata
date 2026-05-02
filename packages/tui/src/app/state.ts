import type { AgentRunResult, AgentToolCall } from "@cortex/agent";
import type { ToolExecutionResult } from "@cortex/tools";

export type ProviderName = "openai-codex" | "openai-compatible";

export interface AuthStatusSummary {
  codexLoggedIn: boolean;
  codexExpiresAt?: number;
  apiKeyConfigured: boolean;
}

export type TranscriptItem =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string; iteration: number }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      argumentsText: string;
      result?: ToolExecutionResult;
    }
  | { kind: "status"; content: string }
  | { kind: "error"; content: string };

export interface AppState {
  provider: ProviderName;
  model: string;
  auth: AuthStatusSummary;
  currentSessionId: string | undefined;
  running: boolean;
  status: string | undefined;
  transcript: TranscriptItem[];
}

export function initialAppState(
  provider: ProviderName,
  model: string,
  auth: AuthStatusSummary,
): AppState {
  return {
    provider,
    model,
    auth,
    currentSessionId: undefined,
    running: false,
    status: undefined,
    transcript: [],
  };
}

export function appendTranscript(state: AppState, item: TranscriptItem): void {
  state.transcript.push(item);
}

export function clearTranscript(state: AppState): void {
  state.transcript = [];
}

export function recordToolStart(state: AppState, call: AgentToolCall): void {
  state.transcript.push({
    kind: "tool",
    toolCallId: call.id,
    toolName: call.name,
    argumentsText: call.argumentsText,
  });
}

export function recordToolResult(
  state: AppState,
  toolCallId: string,
  result: ToolExecutionResult,
): void {
  for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
    const item = state.transcript[i];
    if (item?.kind === "tool" && item.toolCallId === toolCallId) {
      item.result = result;
      return;
    }
  }
}

export function recordCompletion(state: AppState, result: AgentRunResult): void {
  state.running = false;
  state.status =
    result.status === "completed"
      ? `done (${result.iterations} iter, ${result.toolCalls} tools)`
      : `${result.status}: ${result.stoppedReason}`;
}
