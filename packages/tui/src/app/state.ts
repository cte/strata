import type { AgentAttachment, AgentRunResult, AgentToolCall, ThinkingLevel } from "@cortex/agent";
import { THINKING_LEVELS } from "@cortex/agent";
import type { JsonObject } from "@cortex/core";
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
  | { kind: "assistant"; content: string; iteration: number; streaming?: boolean }
  | {
      kind: "tool";
      toolCallId: string;
      toolName: string;
      argumentsText: string;
      result?: ToolExecutionResult;
    }
  | { kind: "status"; content: string }
  | { kind: "error"; content: string }
  | {
      kind: "image";
      attachment: AgentAttachment;
    }
  /**
   * Pre-styled header lines printed once at launch (logo, key-hint summary,
   * onboarding pointer). Each `string` is already wrapped in ANSI styling —
   * the renderer treats them as opaque.
   */
  | { kind: "header"; lines: string[] }
  /**
   * Free-form pre-styled informational block (e.g. `/help` output). Renders
   * identically to `header` but is semantically distinct so future work can
   * treat the launch header and inline notices differently if needed.
   */
  | { kind: "notice"; lines: string[] };

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
  /**
   * Messages queued via alt+enter while the agent was running. Sent in order
   * after the current run finishes (auto-compaction first).
   */
  queuedMessages: string[];
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
    queuedMessages: [],
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

/**
 * Append a streamed assistant text fragment. Pi-aligned: the first delta of
 * an iteration creates a streaming assistant transcript item; subsequent
 * deltas extend it in place. Returns the streaming item so callers can
 * react if they need to.
 */
export function appendAssistantDelta(state: AppState, iteration: number, delta: string): void {
  const last = state.transcript[state.transcript.length - 1];
  if (
    last !== undefined &&
    last.kind === "assistant" &&
    last.streaming === true &&
    last.iteration === iteration
  ) {
    last.content += delta;
    return;
  }
  state.transcript.push({
    kind: "assistant",
    content: delta,
    iteration,
    streaming: true,
  });
}

/**
 * Finalize the streaming assistant item for an iteration with the canonical
 * model content. If a streaming item exists for this iteration we replace
 * its content (in case deltas don't perfectly equal the final text); if
 * none exists (no deltas were streamed — e.g. tool-only response), we
 * append a fresh item, but only when there's text to show.
 */
export function finalizeAssistantStream(state: AppState, iteration: number, content: string): void {
  const last = state.transcript[state.transcript.length - 1];
  if (
    last !== undefined &&
    last.kind === "assistant" &&
    last.streaming === true &&
    last.iteration === iteration
  ) {
    last.content = content;
    last.streaming = false;
    if (content === "") {
      state.transcript.pop();
    }
    return;
  }
  if (content !== "") {
    state.transcript.push({ kind: "assistant", content, iteration });
  }
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
  // Any in-flight streaming item (e.g. cancelled mid-stream) is finalized
  // so the cursor/streaming flag doesn't linger past the run.
  for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
    const item = state.transcript[i];
    if (item?.kind === "assistant" && item.streaming === true) {
      item.streaming = false;
      if (item.content === "") state.transcript.splice(i, 1);
      break;
    }
  }
  // On a successful run we don't surface a status — pi stays quiet too. Only
  // failure/interrupt warrants a one-line summary in the StatusLine.
  state.status =
    result.status === "completed" ? undefined : `${result.status}: ${result.stoppedReason}`;
}
