import {
  getStrataPaths,
  type JsonObject,
  type JsonValue,
  normalizeModelUsage,
  type SessionRecord,
  SessionStore,
} from "@strata/core";
import type { ToolExecutionMode, ToolExecutionResult, ToolOutputChunk } from "@strata/tools";
import { createDefaultToolRegistry, type ToolRegistry } from "@strata/tools";
import {
  buildCompactedMessageRecords,
  type CompactSessionResult,
  compactSession,
  DEFAULT_AUTO_COMPACT_RESERVE_TOKENS,
  latestPostCompactionAssistantContextTokens,
  shouldAutoCompact,
} from "./compaction.js";
import { ModelAdapterError } from "./model.js";
import { clampThinkingLevel } from "./modelCapabilities.js";
import { isTerminalRateLimitMessage } from "./modelRetryClassifier.js";
import { buildRunContext } from "./runContext.js";
import type {
  AgentMessage,
  AgentRunConfig,
  AgentRunEvent,
  AgentRunResult,
  AgentToolCall,
  ModelAdapter,
  ModelResponse,
  ModelRetryPolicy,
} from "./types.js";

// Pi parity: no iteration / tool-call ceiling. The loop runs until the model
// returns no tool calls (final answer), the model errors out, or the user
// cancels via Ctrl+C (signal abort).

export async function* runAgentLoopEvents(config: AgentRunConfig): AsyncGenerator<AgentRunEvent> {
  const repoRoot = getStrataPaths(config.repoRoot).repoRoot;
  const store = await SessionStore.open(repoRoot);
  const tools = config.tools ?? createDefaultToolRegistry();
  const signal = config.signal;
  let messages: AgentMessage[] = [];
  let systemContext: JsonObject = {};
  let session: SessionRecord | undefined;
  let iterations = 0;
  let toolCallCount = 0;
  let finalAnswer = "";
  let cancelled = false;
  let overflowRecoveryAttempted = false;
  const isAborted = (): boolean => signal !== undefined && signal.aborted;
  const retryPolicy = normalizeModelRetryPolicy(config.modelRetryPolicy);
  let sessionStartedYielded = false;

  const buildCancelledResult = (): AgentRunResult => ({
    sessionId: session?.id ?? "",
    status: "interrupted",
    stoppedReason: "cancelled",
    finalAnswer,
    iterations,
    toolCalls: toolCallCount,
  });

  try {
    const availableTools = tools.list();
    const runContext = await buildRunContext({
      question: config.question,
      repoRoot,
      tools: availableTools,
    });
    systemContext = runContext.systemContext;

    // Attach any image/file payloads the user provided to the new user-role
    // message. We mutate runContext in place since buildRunContext just built
    // it for us — no other consumer holds the reference.
    if (config.attachments !== undefined && config.attachments.length > 0) {
      for (const message of runContext.messages) {
        if (message.role === "user") {
          message.attachments = config.attachments;
        }
      }
    }

    const continuingSessionId = config.continueSessionId;
    const continuingSession =
      continuingSessionId === undefined ? undefined : store.getSession(continuingSessionId);
    let appendedContinuationUser = false;

    if (continuingSession !== undefined) {
      // Continue an existing session: rebuild the system messages so the agent
      // gets fresh memory/todos/skills, but seed the rest of the message log
      // from history so the model sees the prior turns.
      session = continuingSession;
      yield {
        type: "session.started",
        sessionId: session.id,
        title: session.title,
        model: config.model.name,
      };
      sessionStartedYielded = true;
      for await (const event of runAutoCompactSessionEvents({
        store,
        sessionId: session.id,
        model: config.model,
        repoRoot,
        contextWindow: autoCompactContextWindow(config),
        reserveTokens: config.autoCompactReserveTokens,
        enabled: config.autoCompact,
        latestContextTokens: latestPostCompactionAssistantContextTokens(store, session.id),
        signal,
      })) {
        yield event;
      }
      const systemMessages = runContext.messages.filter((m) => m.role === "system");
      let priorNonSystem = buildCompactedMessageRecords(store, session.id).map(
        messageRecordToAgentMessage,
      );
      const transcriptRepair = repairIncompleteToolTurns(priorNonSystem);
      priorNonSystem = transcriptRepair.messages;
      const continuationUserMessage = runContext.messages.find(
        (message) => message.role === "user",
      );
      if (
        continuationUserMessage !== undefined &&
        shouldAppendContinuationUser(continuationUserMessage)
      ) {
        if (!isDuplicateContinuationUser(priorNonSystem.at(-1), continuationUserMessage)) {
          await store.recordUserMessage({
            sessionId: session.id,
            content: continuationUserMessage.content,
            ...(continuationUserMessage.attachments === undefined ||
            continuationUserMessage.attachments.length === 0
              ? {}
              : { attachments: continuationUserMessage.attachments as unknown as JsonValue }),
          });
          priorNonSystem.push(continuationUserMessage);
          appendedContinuationUser = true;
        }
      }
      if (lastMessageRole(priorNonSystem) === "assistant") {
        throw new Error("Cannot continue from message role: assistant");
      }
      messages = [...systemMessages, ...priorNonSystem];
      if (transcriptRepair.repairedToolCalls.length > 0) {
        await store.appendEvent(session.id, "agent.loop.transcript_repaired", {
          reason: "missing_tool_result",
          repairedToolCalls: transcriptRepair.repairedToolCalls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.name,
          })),
        });
      }
      await store.appendEvent(session.id, "message.system_context", systemContext);
      const resumedPayload: JsonObject = {
        tools: tools.list().map((tool) => tool.name),
        priorMessages: priorNonSystem.length,
        appendedUserMessage: appendedContinuationUser,
      };
      if (transcriptRepair.repairedToolCalls.length > 0) {
        resumedPayload.repairedToolResults = transcriptRepair.repairedToolCalls.length;
      }
      await store.appendEvent(session.id, "agent.loop.resumed", resumedPayload);
    } else {
      messages = runContext.messages;
      session = await store.createSession({
        kind: "query",
        title: config.sessionTitle ?? truncateTitle(config.question),
        model: config.model.name,
      });
      for (const message of messages) {
        await appendInitialMessage(store, session.id, message);
      }
      await store.appendEvent(session.id, "message.system_context", systemContext);
      await store.appendEvent(session.id, "agent.loop.started", {
        tools: tools.list().map((tool) => tool.name),
      });
    }

    if (!sessionStartedYielded) {
      yield {
        type: "session.started",
        sessionId: session.id,
        title: session.title,
        model: config.model.name,
      };
    }
    if (continuingSession === undefined || appendedContinuationUser) {
      const userEvent: Extract<AgentRunEvent, { type: "message.user" }> = {
        type: "message.user",
        content: config.question,
      };
      if (config.attachments !== undefined && config.attachments.length > 0) {
        userEvent.attachments = config.attachments;
      }
      yield userEvent;
    }

    let pendingMessages = await drainQueuedMessages(config.getSteeringMessages);
    while (true) {
      if (isAborted()) {
        cancelled = true;
        break;
      }
      if (pendingMessages.length > 0) {
        const events = await appendQueuedMessages(store, session.id, messages, pendingMessages);
        for (const event of events) {
          yield event;
        }
        pendingMessages = [];
        if (isAborted()) {
          cancelled = true;
          break;
        }
      }
      iterations += 1;
      let response: ModelResponse | undefined;
      for (let attempt = 1; ; attempt += 1) {
        await store.appendEvent(session.id, "model.request", {
          iteration: iterations,
          messageCount: messages.length,
          attempt,
        });
        yield {
          type: "model.request",
          iteration: iterations,
          messageCount: messages.length,
          attempt,
        };

        // Streaming bridge: deltas come from the adapter via callback while we
        // await the response. Push them into a queue, race the response promise
        // against a "delta-arrived" wakeup, and yield queued deltas as soon as
        // they appear so the TUI can render them in real time.
        const deltaQueue: Array<{ kind: "text" | "reasoning"; delta: string }> = [];
        let emittedDelta = false;
        let wakeup: (() => void) | undefined;
        const wake = () => {
          const fn = wakeup;
          wakeup = undefined;
          fn?.();
        };
        const modelRequest: {
          messages: typeof messages;
          tools: ReturnType<typeof tools.list>;
          signal?: AbortSignal;
          reasoningEffort?: typeof config.reasoningEffort;
          onAssistantDelta?: (delta: string) => void;
          onReasoningDelta?: (delta: string) => void;
        } = {
          messages,
          tools: tools.list(),
          onAssistantDelta: (delta: string) => {
            if (delta === "") return;
            deltaQueue.push({ kind: "text", delta });
            wake();
          },
          onReasoningDelta: (delta: string) => {
            if (delta === "") return;
            deltaQueue.push({ kind: "reasoning", delta });
            wake();
          },
        };
        if (signal !== undefined) {
          modelRequest.signal = signal;
        }
        if (config.reasoningEffort !== undefined) {
          modelRequest.reasoningEffort = config.model.capabilities
            ? clampThinkingLevel(config.model.capabilities, config.reasoningEffort)
            : config.reasoningEffort;
        }
        let settled: { ok: true; value: ModelResponse } | { ok: false; error: unknown } | undefined;
        const responsePromise = config.model
          .complete(modelRequest)
          .then((value) => {
            settled = { ok: true, value };
            wake();
          })
          .catch((error: unknown) => {
            settled = { ok: false, error };
            wake();
          });

        try {
          while (settled === undefined || deltaQueue.length > 0) {
            while (deltaQueue.length > 0) {
              const item = deltaQueue.shift();
              if (item === undefined) continue;
              if (item.kind === "reasoning") {
                yield {
                  type: "assistant.reasoning",
                  iteration: iterations,
                  reasoningDelta: item.delta,
                };
                continue;
              }
              // Only visible-answer deltas gate retry: a partially streamed
              // answer must not be re-streamed, but reasoning-only output can.
              emittedDelta = true;
              yield { type: "assistant.delta", iteration: iterations, contentDelta: item.delta };
            }
            if (settled !== undefined) break;
            await new Promise<void>((resolve) => {
              wakeup = resolve;
            });
          }
        } finally {
          // Make sure the in-flight request is awaited so we don't leak it.
          await responsePromise;
        }
        if (settled === undefined) {
          throw new Error("Model request settled without producing a result");
        }
        if (!settled.ok) {
          if (isAborted()) {
            cancelled = true;
            break;
          }
          if (isContextOverflowError(settled.error)) {
            if (overflowRecoveryAttempted) {
              throw new Error(
                "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
              );
            }
            overflowRecoveryAttempted = true;
            const compactEvents: AgentRunEvent[] = [];
            for await (const event of runAutoCompactSessionEvents({
              store,
              sessionId: session.id,
              model: config.model,
              repoRoot,
              contextWindow: autoCompactContextWindow(config),
              reserveTokens: config.autoCompactReserveTokens,
              enabled: config.autoCompact,
              latestContextTokens: undefined,
              signal,
              reason: "overflow",
            })) {
              compactEvents.push(event);
              yield event;
            }
            const failed = compactEvents.find((event) => event.type === "compaction.failed");
            if (failed?.type === "compaction.failed") {
              throw new Error(`Context overflow recovery failed: ${failed.message}`);
            }
            if (!compactEvents.some((event) => event.type === "compaction.completed")) {
              throw settled.error;
            }
            messages = [
              ...messages.filter((message) => message.role === "system"),
              ...buildCompactedMessageRecords(store, session.id).map(messageRecordToAgentMessage),
            ];
            continue;
          }
          const retry = modelRetryDecision(settled.error, emittedDelta, attempt, retryPolicy);
          if (retry === undefined) {
            throw settled.error;
          }
          const retryEvent: Extract<AgentRunEvent, { type: "model.retry" }> = {
            type: "model.retry",
            iteration: iterations,
            attempt,
            nextAttempt: attempt + 1,
            maxAttempts: retryPolicy.maxAttempts,
            delayMs: retry.delayMs,
            message: errorMessage(settled.error).slice(0, 500),
          };
          await store.appendEvent(session.id, "model.retry", {
            iteration: retryEvent.iteration,
            attempt: retryEvent.attempt,
            nextAttempt: retryEvent.nextAttempt,
            maxAttempts: retryEvent.maxAttempts,
            delayMs: retryEvent.delayMs,
            message: retryEvent.message,
          });
          yield retryEvent;
          await sleepForRetry(retry.delayMs, signal);
          if (isAborted()) {
            cancelled = true;
            break;
          }
          continue;
        }
        response = settled.value;
        break;
      }
      if (cancelled) {
        break;
      }
      if (response === undefined) {
        throw new Error("Model request ended without producing a response");
      }

      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });
      const normalizedUsage =
        response.usage === undefined ? undefined : normalizeModelUsage(response.usage);
      await store.recordAssistantMessage({
        sessionId: session.id,
        iteration: iterations,
        content: response.content,
        finishReason: response.finishReason,
        toolCalls: response.toolCalls,
        ...(normalizedUsage === undefined ? {} : { usage: normalizedUsage }),
        ...(response.providerResponseId === undefined
          ? {}
          : { providerResponseId: response.providerResponseId }),
        ...(response.reasoning === undefined ? {} : { reasoning: response.reasoning }),
        ...(response.reasoningSignature === undefined
          ? {}
          : { reasoningSignature: response.reasoningSignature }),
      });
      const modelResponseEvent: Extract<AgentRunEvent, { type: "model.response" }> = {
        type: "model.response",
        iteration: iterations,
        content: response.content,
        toolCalls: response.toolCalls,
      };
      if (response.usage !== undefined) {
        modelResponseEvent.usage = response.usage;
      }
      if (response.reasoning !== undefined) {
        modelResponseEvent.reasoning = response.reasoning;
      }
      yield modelResponseEvent;

      if (response.toolCalls.length === 0) {
        finalAnswer = response.content;
        pendingMessages = await drainQueuedMessages(config.getSteeringMessages);
        if (pendingMessages.length > 0) {
          continue;
        }
        pendingMessages = await drainQueuedMessages(config.getFollowUpMessages);
        if (pendingMessages.length > 0) {
          continue;
        }
        for await (const event of runAutoCompactSessionEvents({
          store,
          sessionId: session.id,
          model: config.model,
          repoRoot,
          contextWindow: autoCompactContextWindow(config),
          reserveTokens: config.autoCompactReserveTokens,
          enabled: config.autoCompact,
          latestContextTokens: normalizedUsage?.total,
          signal,
          reason: "threshold",
        })) {
          yield event;
        }
        await store.appendEvent(session.id, "agent.loop.completed", {
          reason: "final_answer",
          iterations,
          toolCalls: toolCallCount,
        });
        await store.endSession(session.id, "completed");
        const result: AgentRunResult = {
          sessionId: session.id,
          status: "completed",
          stoppedReason: "final_answer",
          finalAnswer,
          iterations,
          toolCalls: toolCallCount,
        };
        yield { type: "agent.completed", result };
        return;
      }

      const batchOptions: ToolCallBatchOptions = {
        store,
        sessionId: session.id,
        repoRoot,
        tools,
        toolCalls: response.toolCalls,
        toolExecution: config.toolExecution ?? "parallel",
      };
      if (signal !== undefined) {
        batchOptions.signal = signal;
      }
      const batch = executeToolCallBatch(batchOptions);
      let toolExecutions: ExecutedToolCall[] = [];
      while (true) {
        const next = await batch.next();
        if (next.done) {
          toolExecutions = next.value;
          break;
        }
        if (next.value.type === "tool.call.started") {
          toolCallCount += 1;
        }
        yield next.value;
      }

      for (const execution of toolExecutions) {
        const toolContent = JSON.stringify(execution.result);
        messages.push({
          role: "tool",
          content: toolContent,
          toolCallId: execution.toolCall.id,
        });
        await store.recordToolMessage({
          sessionId: session.id,
          toolCallId: execution.toolCall.id,
          content: toolContent,
          resultEventPayload: toolResultEventPayload(execution.toolCall.id, execution.result),
        });
      }

      if (isAborted()) {
        cancelled = true;
        break;
      }
      pendingMessages = await drainQueuedMessages(config.getSteeringMessages);
    }

    // The only way to fall out of `while (true)` is cancellation — final
    // answer paths return directly from inside the loop. Emit the cancel.
    await store.appendEvent(session.id, "agent.loop.stopped", {
      reason: "cancelled",
      iterations,
      toolCalls: toolCallCount,
      cancellation: cancellationDetails(signal),
    });
    await store.endSession(session.id, "interrupted");
    yield { type: "agent.completed", result: buildCancelledResult() };
  } catch (error: unknown) {
    const message = errorMessage(error);
    if (session !== undefined) {
      await store.appendEvent(session.id, "agent.loop.error", { message });
      await store.endSession(session.id, "failed");
      const result: AgentRunResult = {
        sessionId: session.id,
        status: "failed",
        stoppedReason: "model_error",
        finalAnswer,
        iterations,
        toolCalls: toolCallCount,
      };
      yield { type: "agent.failed", message, result };
      return;
    }
    yield { type: "agent.failed", message };
    throw error;
  } finally {
    store.close();
  }
}

interface NormalizedModelRetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

const DEFAULT_MODEL_RETRY_POLICY: NormalizedModelRetryPolicy = {
  maxAttempts: 4,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  backoffFactor: 2,
};

const RETRYABLE_MODEL_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const CONTEXT_OVERFLOW_ERROR_PATTERNS = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length of [\d,]+ tokens?/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /too large for model with \d+ maximum context length/i,
  /model_context_window_exceeded/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /context[_ ]length[_ ]exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /^4(?:00|13)\s*(?:status code)?\s*\(no body\)/i,
];
const NON_CONTEXT_OVERFLOW_ERROR_PATTERNS = [
  /^(Throttling error|Service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
];
const RETRYABLE_NETWORK_ERROR_TEXT = [
  "overloaded",
  "provider returned error",
  "rate limit",
  "too many requests",
  "service unavailable",
  "server error",
  "internal error",
  "fetch failed",
  "connection error",
  "connection refused",
  "connection reset",
  "connection failure",
  "connection lost",
  "econnreset",
  "etimedout",
  "websocket closed",
  "websocket error",
  "other side closed",
  "upstream connect",
  "reset before headers",
  "socket hang up",
  "ended without",
  "stream ended before message_stop",
  "http2 request did not get a response",
  "timed out",
  "timeout",
  "terminated",
  "network error",
  "retry delay",
];

function normalizeModelRetryPolicy(
  input: ModelRetryPolicy | undefined,
): NormalizedModelRetryPolicy {
  const maxAttempts = boundedInteger(
    input?.maxAttempts,
    DEFAULT_MODEL_RETRY_POLICY.maxAttempts,
    1,
    10,
  );
  const initialDelayMs = boundedInteger(
    input?.initialDelayMs,
    DEFAULT_MODEL_RETRY_POLICY.initialDelayMs,
    0,
    60_000,
  );
  const maxDelayMs = boundedInteger(
    input?.maxDelayMs,
    Math.max(DEFAULT_MODEL_RETRY_POLICY.maxDelayMs, initialDelayMs),
    0,
    120_000,
  );
  const backoffFactor =
    typeof input?.backoffFactor === "number" &&
    Number.isFinite(input.backoffFactor) &&
    input.backoffFactor >= 1
      ? Math.min(input.backoffFactor, 10)
      : DEFAULT_MODEL_RETRY_POLICY.backoffFactor;
  return {
    maxAttempts,
    initialDelayMs,
    maxDelayMs: Math.max(initialDelayMs, maxDelayMs),
    backoffFactor,
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function modelRetryDecision(
  error: unknown,
  emittedDelta: boolean,
  attempt: number,
  policy: NormalizedModelRetryPolicy,
): { delayMs: number } | undefined {
  if (emittedDelta || attempt >= policy.maxAttempts || !isRetryableModelError(error)) {
    return undefined;
  }
  return { delayMs: modelRetryDelayMs(attempt, policy, error) };
}

function modelRetryDelayMs(
  attempt: number,
  policy: NormalizedModelRetryPolicy,
  error?: unknown,
): number {
  const serverDelayMs = retryAfterMsFromError(error);
  const rawDelay =
    serverDelayMs ?? policy.initialDelayMs * policy.backoffFactor ** Math.max(0, attempt - 1);
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(rawDelay)));
}

function retryAfterMsFromError(error: unknown): number | undefined {
  if (!(error instanceof ModelAdapterError) || error.retryAfterMs === undefined) {
    return undefined;
  }
  return Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs) : undefined;
}

function isRetryableModelError(error: unknown): boolean {
  if (isContextOverflowError(error)) {
    return false;
  }
  if (error instanceof ModelAdapterError) {
    if (isTerminalRateLimitMessage(error.message)) {
      return false;
    }
    if (
      error.code === "anthropic_http_error" ||
      error.code === "codex_http_error" ||
      error.code === "model_http_error"
    ) {
      const status = httpStatusFromMessage(error.message);
      return (
        (status !== undefined && RETRYABLE_MODEL_HTTP_STATUSES.has(status)) ||
        hasRetryableModelErrorText(error.message)
      );
    }
    return (
      error.code === "anthropic_stream_error" ||
      error.code === "codex_network_error" ||
      error.code === "model_network_error" ||
      hasRetryableModelErrorText(error.message)
    );
  }

  if (error instanceof Error) {
    return hasRetryableModelErrorText(error.message);
  }

  return false;
}

function isContextOverflowError(error: unknown): boolean {
  const message = errorMessage(error);
  const normalized = message.replace(/[_-]+/g, " ");
  if (NON_CONTEXT_OVERFLOW_ERROR_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return CONTEXT_OVERFLOW_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function hasRetryableModelErrorText(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[_-]+/g, " ");
  return (
    /\b(408|409|429|500|502|503|504)\b/.test(normalized) ||
    RETRYABLE_NETWORK_ERROR_TEXT.some((text) => normalized.includes(text))
  );
}

function httpStatusFromMessage(message: string): number | undefined {
  const match = /\bHTTP\s+(\d{3})\b/i.exec(message);
  if (match === null) {
    return undefined;
  }
  const status = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(status) ? status : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleepForRetry(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0 || signal?.aborted === true) {
    return;
  }
  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    timeout = setTimeout(done, delayMs);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function cancellationDetails(signal: AbortSignal | undefined): JsonObject {
  if (signal === undefined || !signal.aborted) {
    return { source: "unknown" };
  }
  const reason = signal.reason as unknown;
  if (isCancellationObject(reason)) {
    return sanitizeCancellationObject(reason);
  }
  if (reason instanceof Error) {
    return {
      source: "abort_signal",
      name: reason.name,
      message: reason.message.slice(0, 500),
    };
  }
  if (typeof reason === "string") {
    return {
      source: "abort_signal",
      message: reason.slice(0, 500),
    };
  }
  return { source: "abort_signal" };
}

interface AutoCompactSessionOptions {
  store: SessionStore;
  sessionId: string;
  model: ModelAdapter;
  repoRoot: string;
  contextWindow: number | undefined;
  reserveTokens: number | undefined;
  enabled: boolean | undefined;
  latestContextTokens: number | undefined;
  signal: AbortSignal | undefined;
  reason?: "threshold" | "overflow";
}

async function* runAutoCompactSessionEvents(
  options: AutoCompactSessionOptions,
): AsyncGenerator<AgentRunEvent> {
  if (options.enabled === false || isSignalAborted(options.signal)) {
    return;
  }
  const reason = options.reason ?? "threshold";
  const contextWindow = options.contextWindow;
  const reserveTokens = options.reserveTokens ?? DEFAULT_AUTO_COMPACT_RESERVE_TOKENS;
  if (reason === "threshold") {
    const checkOptions: Parameters<typeof shouldAutoCompact>[0] = {
      contextWindow,
      latestContextTokens: options.latestContextTokens,
      reserveTokens,
    };
    if (!shouldAutoCompact(checkOptions) || contextWindow === undefined) {
      return;
    }
  }

  const started: Extract<AgentRunEvent, { type: "compaction.started" }> = {
    type: "compaction.started",
    reason,
    latestContextTokens: options.latestContextTokens ?? 0,
    contextWindow: contextWindow ?? 0,
    reserveTokens,
  };
  await options.store.appendEvent(options.sessionId, "compaction.started", {
    reason: started.reason,
    latestContextTokens: started.latestContextTokens,
    contextWindow: started.contextWindow,
    reserveTokens: started.reserveTokens,
  });
  yield started;

  try {
    const compactOptions: Parameters<typeof compactSession>[0] = {
      sessionId: options.sessionId,
      model: options.model,
      repoRoot: options.repoRoot,
      reason,
    };
    if (options.signal !== undefined) {
      compactOptions.signal = options.signal;
    }
    const result = await compactSession(compactOptions);
    yield compactCompletedEvent(result, reason);
  } catch (error: unknown) {
    const message = errorMessage(error);
    await options.store.appendEvent(options.sessionId, "compaction.failed", {
      reason,
      message: message.slice(0, 500),
    });
    yield {
      type: "compaction.failed",
      reason,
      message,
    };
  }
}

function compactCompletedEvent(
  result: CompactSessionResult,
  reason: "threshold" | "overflow",
): Extract<AgentRunEvent, { type: "compaction.completed" }> {
  return {
    type: "compaction.completed",
    reason,
    sessionId: result.sessionId,
    messagesSummarized: result.messagesSummarized,
    incremental: result.incremental,
  };
}

function autoCompactContextWindow(config: AgentRunConfig): number | undefined {
  return config.contextWindow ?? config.model.contextWindow;
}

function isCancellationObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { source?: unknown }).source === "string"
  );
}

function sanitizeCancellationObject(value: Record<string, unknown>): JsonObject {
  const details: JsonObject = {
    source: String(value.source).slice(0, 120),
  };
  for (const key of ["runId", "sessionId", "existingRunId", "message"]) {
    const raw = value[key];
    if (typeof raw === "string") {
      details[key] = raw.slice(0, 500);
    }
  }
  return details;
}

export async function runAgentLoop(config: AgentRunConfig): Promise<AgentRunResult> {
  let lastResult: AgentRunResult | undefined;
  for await (const event of runAgentLoopEvents(config)) {
    if (event.type === "agent.completed") {
      lastResult = event.result;
    } else if (event.type === "agent.failed" && event.result !== undefined) {
      lastResult = event.result;
    }
  }
  if (lastResult === undefined) {
    throw new Error("Agent loop ended without producing a result");
  }
  return lastResult;
}

async function appendInitialMessage(
  store: SessionStore,
  sessionId: string,
  message: AgentMessage,
): Promise<void> {
  const input: import("@strata/core").MessageInput = {
    sessionId,
    role: message.role,
    content: message.content,
  };
  if (message.attachments !== undefined && message.attachments.length > 0) {
    input.attachments = message.attachments as unknown as JsonValue;
  }
  await store.appendMessage(input);
}

async function drainQueuedMessages(
  drain: AgentRunConfig["getSteeringMessages"] | AgentRunConfig["getFollowUpMessages"],
): Promise<AgentMessage[]> {
  return drain === undefined ? [] : await drain();
}

async function appendQueuedMessages(
  store: SessionStore,
  sessionId: string,
  messages: AgentMessage[],
  queuedMessages: AgentMessage[],
): Promise<Array<Extract<AgentRunEvent, { type: "message.user" }>>> {
  const events: Array<Extract<AgentRunEvent, { type: "message.user" }>> = [];
  for (const message of queuedMessages) {
    messages.push(message);
    if (message.role === "user") {
      await store.recordUserMessage({
        sessionId,
        content: message.content,
        ...(message.attachments === undefined || message.attachments.length === 0
          ? {}
          : { attachments: message.attachments as unknown as JsonValue }),
      });
      const event: Extract<AgentRunEvent, { type: "message.user" }> = {
        type: "message.user",
        content: message.content,
      };
      if (message.attachments !== undefined && message.attachments.length > 0) {
        event.attachments = message.attachments;
      }
      if (message.clientMessageId !== undefined) {
        event.clientMessageId = message.clientMessageId;
      }
      events.push(event);
    } else {
      await appendInitialMessage(store, sessionId, message);
    }
  }
  return events;
}

interface ToolCallBatchOptions {
  store: SessionStore;
  sessionId: string;
  repoRoot: string;
  tools: ToolRegistry;
  toolCalls: AgentToolCall[];
  toolExecution: ToolExecutionMode;
  signal?: AbortSignal;
}

interface ExecutedToolCall {
  index: number;
  toolCall: AgentToolCall;
  result: ToolExecutionResult;
}

async function* executeToolCallBatch(
  options: ToolCallBatchOptions,
): AsyncGenerator<AgentRunEvent, ExecutedToolCall[]> {
  if (shouldExecuteToolCallsSequential(options.tools, options.toolCalls, options.toolExecution)) {
    const generator = executeToolCallsSequential(options);
    return yield* generator;
  }
  const generator = executeToolCallsParallel(options);
  return yield* generator;
}

async function* executeToolCallsSequential(
  options: ToolCallBatchOptions,
): AsyncGenerator<AgentRunEvent, ExecutedToolCall[]> {
  const executions: ExecutedToolCall[] = [];
  for (let index = 0; index < options.toolCalls.length; index += 1) {
    if (isSignalAborted(options.signal)) {
      break;
    }
    const toolCall = options.toolCalls[index];
    if (toolCall === undefined) {
      continue;
    }
    await recordToolStart(options.store, options.sessionId, toolCall);
    yield toolStartedEvent(toolCall);
    // Run the tool while draining its incremental output so `tool.output`
    // events interleave with execution rather than only arriving at the end.
    const channel = new ToolEventChannel();
    const resultPromise = executeToolCall(
      options.store,
      options.repoRoot,
      options.sessionId,
      options.tools,
      toolCall,
      options.signal,
      (chunk) => channel.push(toolOutputEvent(toolCall.id, chunk)),
    );
    void resultPromise.then(
      () => channel.close(),
      () => channel.close(),
    );
    for await (const event of channel.drain()) {
      yield event;
    }
    const result = await resultPromise;
    const execution: ExecutedToolCall = { index, toolCall, result };
    executions.push(execution);
    yield toolCompletedEvent(execution);
  }
  return executions;
}

async function* executeToolCallsParallel(
  options: ToolCallBatchOptions,
): AsyncGenerator<AgentRunEvent, ExecutedToolCall[]> {
  const orderedExecutions: Array<ExecutedToolCall | undefined> = [];
  // Output and completion events from every concurrently-running tool flow
  // through one channel; started events are still yielded in source order
  // first, and per-tool results are still stored at their source index.
  const channel = new ToolEventChannel();
  let pendingCount = 0;
  let allLaunched = false;
  const maybeClose = (): void => {
    if (allLaunched && pendingCount === 0) {
      channel.close();
    }
  };

  for (let index = 0; index < options.toolCalls.length; index += 1) {
    if (isSignalAborted(options.signal)) {
      break;
    }
    const toolCall = options.toolCalls[index];
    if (toolCall === undefined) {
      continue;
    }
    await recordToolStart(options.store, options.sessionId, toolCall);
    pendingCount += 1;
    const sourceIndex = index;
    void executeToolCall(
      options.store,
      options.repoRoot,
      options.sessionId,
      options.tools,
      toolCall,
      options.signal,
      (chunk) => channel.push(toolOutputEvent(toolCall.id, chunk)),
    ).then((result) => {
      const execution: ExecutedToolCall = { index: sourceIndex, toolCall, result };
      orderedExecutions[sourceIndex] = execution;
      channel.push(toolCompletedEvent(execution));
      pendingCount -= 1;
      maybeClose();
    });
    yield toolStartedEvent(toolCall);
  }
  allLaunched = true;
  maybeClose();

  for await (const event of channel.drain()) {
    yield event;
  }

  return orderedExecutions.filter(
    (execution): execution is ExecutedToolCall => execution !== undefined,
  );
}

/**
 * Minimal async channel that merges callback-driven tool output into the
 * generator's yield sequence. `drain()` yields queued events until `close()`.
 */
class ToolEventChannel {
  private queue: AgentRunEvent[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;

  push(event: AgentRunEvent): void {
    this.queue.push(event);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    if (waiter !== null) {
      this.waiter = null;
      waiter();
    }
  }

  async *drain(): AsyncGenerator<AgentRunEvent> {
    while (true) {
      while (this.queue.length > 0) {
        yield this.queue.shift() as AgentRunEvent;
      }
      if (this.closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }
}

function shouldExecuteToolCallsSequential(
  tools: ToolRegistry,
  toolCalls: AgentToolCall[],
  mode: ToolExecutionMode,
): boolean {
  if (mode === "sequential") {
    return true;
  }
  return toolCalls.some((toolCall) => toolExecutionModeFor(tools, toolCall.name) === "sequential");
}

function toolExecutionModeFor(
  tools: ToolRegistry,
  toolName: string,
): ToolExecutionMode | undefined {
  try {
    return tools.get(toolName).executionMode;
  } catch {
    return undefined;
  }
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

async function recordToolStart(
  store: SessionStore,
  sessionId: string,
  toolCall: AgentToolCall,
): Promise<void> {
  await store.recordToolStart({
    sessionId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    argumentsText: toolCall.argumentsText,
  });
}

function toolStartedEvent(toolCall: AgentToolCall): AgentRunEvent {
  return {
    type: "tool.call.started",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    argumentsText: toolCall.argumentsText,
  };
}

function toolCompletedEvent(execution: ExecutedToolCall): AgentRunEvent {
  return {
    type: "tool.call.completed",
    toolCallId: execution.toolCall.id,
    result: execution.result,
  };
}

function toolOutputEvent(toolCallId: string, chunk: ToolOutputChunk): AgentRunEvent {
  return { type: "tool.output", toolCallId, stream: chunk.stream, textDelta: chunk.text };
}

async function executeToolCall(
  store: SessionStore,
  repoRoot: string,
  sessionId: string,
  tools: ToolRegistry,
  toolCall: AgentToolCall,
  signal?: AbortSignal,
  onOutput?: (chunk: ToolOutputChunk) => void,
): Promise<ToolExecutionResult> {
  return tools.safeExecuteText(toolCall.name, toolCall.argumentsText, {
    repoRoot,
    sessionId,
    toolCallId: toolCall.id,
    ...(signal === undefined ? {} : { signal }),
    recordFileChange: async (change) => {
      await store.appendEvent(sessionId, "file.changed", {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        ...change,
      });
    },
    ...(onOutput === undefined ? {} : { onOutput }),
  });
}

function toolResultEventPayload(toolCallId: string, result: ToolExecutionResult): JsonObject {
  if (result.ok) {
    return {
      toolCallId,
      toolName: result.toolName,
      ok: true,
      result: result.result,
      truncated: result.truncated,
    };
  }

  return {
    toolCallId,
    toolName: result.toolName,
    ok: false,
    error: {
      code: result.error.code,
      message: result.error.message,
    },
    truncated: false,
  };
}

function truncateTitle(value: string): string {
  const trimmed = sanitizeTitleText(value).trim().replace(/\s+/g, " ");
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`;
}

function sanitizeTitleText(value: string): string {
  return value
    .replace(
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g,
      "",
    )
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function shouldAppendContinuationUser(message: AgentMessage): boolean {
  return message.content.trim() !== "" || (message.attachments?.length ?? 0) > 0;
}

function isDuplicateContinuationUser(
  previous: AgentMessage | undefined,
  next: AgentMessage,
): boolean {
  return (
    previous?.role === "user" &&
    previous.content === next.content &&
    JSON.stringify(previous.attachments ?? null) === JSON.stringify(next.attachments ?? null)
  );
}

function lastMessageRole(messages: AgentMessage[]): AgentMessage["role"] | undefined {
  return messages.at(-1)?.role;
}

interface TranscriptRepairResult {
  messages: AgentMessage[];
  repairedToolCalls: AgentToolCall[];
}

function repairIncompleteToolTurns(messages: AgentMessage[]): TranscriptRepairResult {
  const repairedMessages: AgentMessage[] = [];
  const repairedToolCalls: AgentToolCall[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }
    const toolCalls = message.role === "assistant" ? (message.toolCalls ?? []) : [];
    if (toolCalls.length === 0) {
      repairedMessages.push(message);
      continue;
    }

    repairedMessages.push(message);
    const followingToolMessages: AgentMessage[] = [];
    let cursor = index + 1;
    while (messages[cursor]?.role === "tool") {
      const toolMessage = messages[cursor];
      if (toolMessage !== undefined) {
        followingToolMessages.push(toolMessage);
      }
      cursor += 1;
    }

    const expectedToolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id));
    const toolMessagesById = new Map<string, AgentMessage>();
    const extraToolMessages: AgentMessage[] = [];
    for (const toolMessage of followingToolMessages) {
      const toolCallId = toolMessage.toolCallId;
      if (
        toolCallId !== undefined &&
        expectedToolCallIds.has(toolCallId) &&
        !toolMessagesById.has(toolCallId)
      ) {
        toolMessagesById.set(toolCallId, toolMessage);
      } else {
        extraToolMessages.push(toolMessage);
      }
    }

    for (const toolCall of toolCalls) {
      const toolMessage = toolMessagesById.get(toolCall.id);
      if (toolMessage !== undefined) {
        repairedMessages.push(toolMessage);
        continue;
      }
      repairedMessages.push(missingToolResultMessage(toolCall));
      repairedToolCalls.push(toolCall);
    }
    repairedMessages.push(...extraToolMessages);
    index = cursor - 1;
  }

  return { messages: repairedMessages, repairedToolCalls };
}

function missingToolResultMessage(toolCall: AgentToolCall): AgentMessage {
  const result: ToolExecutionResult = {
    ok: false,
    toolName: toolCall.name,
    error: {
      code: "missing_tool_result",
      message:
        "The previous run stopped after this tool call was requested, but before a tool result was recorded.",
    },
    truncated: false,
  };
  return {
    role: "tool",
    content: JSON.stringify(result),
    toolCallId: toolCall.id,
  };
}

function messageRecordToAgentMessage(record: import("@strata/core").MessageRecord): AgentMessage {
  const message: AgentMessage = {
    role: record.role,
    content: record.content,
  };
  if (record.toolCallId !== null) {
    message.toolCallId = record.toolCallId;
  }
  if (Array.isArray(record.toolCalls)) {
    message.toolCalls = record.toolCalls as unknown as AgentToolCall[];
  }
  if (Array.isArray(record.attachments)) {
    message.attachments = record.attachments as unknown as import("./types.js").AgentAttachment[];
  }
  return message;
}
