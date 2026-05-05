import type {
  AgentAttachment,
  AgentRunResult,
  AgentToolCall,
  ThinkingLevel,
} from "@cortex/agent";
import type { JsonObject } from "@cortex/core";
import { THINKING_LEVELS } from "@cortex/agent";
import type { ToolExecutionResult } from "@cortex/tools";
import {
  addModelUsage,
  contextWindowForModel,
  createTokenUsageTotals,
  resetTokenUsage,
  type TokenUsageTotals,
} from "./usage.js";

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
  contextWindow: number | undefined;
  reasoningEffort: ThinkingLevel;
  auth: AuthStatusSummary;
  currentSessionId: string | undefined;
  running: boolean;
  status: string | undefined;
  usage: TokenUsageTotals;
  transcript: TranscriptItem[];
  /** Attachments queued for the next user submission (cleared after submit). */
  pendingAttachments: AgentAttachment[];
}

export function initialAppState(
  provider: ProviderName,
  model: string,
  auth: AuthStatusSummary,
): AppState {
  return {
    provider,
    model,
    contextWindow: contextWindowForModel(provider, model),
    reasoningEffort: "off",
    auth,
    currentSessionId: undefined,
    running: false,
    status: undefined,
    usage: createTokenUsageTotals(),
    transcript: [],
    pendingAttachments: [],
  };
}

export function setModelSelection(state: AppState, provider: ProviderName, model: string): void {
  state.provider = provider;
  state.model = model;
  state.contextWindow = contextWindowForModel(provider, model);
  resetTokenUsage(state.usage);
}

export function startSession(state: AppState, sessionId: string): void {
  state.currentSessionId = sessionId;
  state.contextWindow = contextWindowForModel(state.provider, state.model);
  resetTokenUsage(state.usage);
}

export function nextThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  const idx = THINKING_LEVELS.indexOf(level);
  const next = THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
  return next ?? "off";
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

export function recordModelUsage(state: AppState, usage: JsonObject | undefined): void {
  addModelUsage(state.usage, usage);
}

export function recordCompletion(state: AppState, result: AgentRunResult): void {
  state.running = false;
  state.status =
    result.status === "completed"
      ? `done (${result.iterations} iter, ${result.toolCalls} tools)`
      : `${result.status}: ${result.stoppedReason}`;
}
