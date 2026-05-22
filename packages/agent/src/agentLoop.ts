import {
  getStrataPaths,
  type JsonObject,
  type JsonValue,
  normalizeModelUsage,
  type SessionRecord,
  SessionStore,
} from "@strata/core";
import type { ToolExecutionMode, ToolExecutionResult } from "@strata/tools";
import { createDefaultToolRegistry, type ToolRegistry } from "@strata/tools";
import { ModelAdapterError } from "./model.js";
import { buildRunContext } from "./runContext.js";
import type {
  AgentMessage,
  AgentRunConfig,
  AgentRunEvent,
  AgentRunResult,
  AgentToolCall,
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
  const isAborted = (): boolean => signal !== undefined && signal.aborted;
  const retryPolicy = normalizeModelRetryPolicy(config.modelRetryPolicy);

  const buildCancelledResult = (): AgentRunResult => ({
    sessionId: session?.id ?? "",
    status: "interrupted",
    stoppedReason: "cancelled",
    finalAnswer,
    iterations,
    toolCalls: toolCallCount,
  });

  try {
    const runContext = await buildRunContext({ question: config.question, repoRoot });
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

    if (continuingSession !== undefined) {
      // Continue an existing session: rebuild the system messages so the agent
      // gets fresh memory/todos/skills, but seed the rest of the message log
      // from history so the model sees the prior turns.
      session = continuingSession;
      const systemMessages = runContext.messages.filter((m) => m.role === "system");
      const priorNonSystem = store
        .listMessages(session.id)
        .filter((m) => m.role !== "system")
        .map(messageRecordToAgentMessage);
      const userMessage = runContext.messages.find((m) => m.role === "user");
      messages = [
        ...systemMessages,
        ...priorNonSystem,
        ...(userMessage === undefined ? [] : [userMessage]),
      ];
      // Persist the new user turn (the system messages are not re-persisted —
      // they're regenerated each run).
      if (userMessage !== undefined) {
        const messageInput: import("@strata/core").MessageInput = {
          sessionId: session.id,
          role: "user",
          content: userMessage.content,
        };
        if (userMessage.attachments !== undefined && userMessage.attachments.length > 0) {
          messageInput.attachments = userMessage.attachments as unknown as JsonValue;
        }
        await store.appendMessage(messageInput);
      }
      await store.appendEvent(session.id, "message.system_context", systemContext);
      await store.appendEvent(session.id, "agent.loop.resumed", {
        tools: tools.list().map((tool) => tool.name),
        priorMessages: priorNonSystem.length,
      });
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

    yield {
      type: "session.started",
      sessionId: session.id,
      title: session.title,
      model: config.model.name,
    };
    yield { type: "message.user", content: config.question };

    while (true) {
      if (isAborted()) {
        cancelled = true;
        break;
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
        const deltaQueue: string[] = [];
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
        } = {
          messages,
          tools: tools.list(),
          onAssistantDelta: (delta: string) => {
            if (delta === "") return;
            deltaQueue.push(delta);
            wake();
          },
        };
        if (signal !== undefined) {
          modelRequest.signal = signal;
        }
        if (config.reasoningEffort !== undefined && config.reasoningEffort !== "off") {
          modelRequest.reasoningEffort = config.reasoningEffort;
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
              const delta = deltaQueue.shift() ?? "";
              emittedDelta = true;
              yield { type: "assistant.delta", iteration: iterations, contentDelta: delta };
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
      yield modelResponseEvent;

      if (response.toolCalls.length === 0) {
        finalAnswer = response.content;
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
  maxDelayMs: 8_000,
  backoffFactor: 2,
};

const RETRYABLE_MODEL_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
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
  return { delayMs: modelRetryDelayMs(attempt, policy) };
}

function modelRetryDelayMs(attempt: number, policy: NormalizedModelRetryPolicy): number {
  const rawDelay = policy.initialDelayMs * policy.backoffFactor ** Math.max(0, attempt - 1);
  return Math.min(policy.maxDelayMs, Math.round(rawDelay));
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelAdapterError) {
    if (error.code === "codex_http_error" || error.code === "model_http_error") {
      const status = httpStatusFromMessage(error.message);
      return (
        (status !== undefined && RETRYABLE_MODEL_HTTP_STATUSES.has(status)) ||
        hasRetryableModelErrorText(error.message)
      );
    }
    return (
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
    const result = await executeToolCall(
      options.store,
      options.repoRoot,
      options.sessionId,
      options.tools,
      toolCall,
    );
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
  const pending = new Map<number, Promise<ExecutedToolCall>>();

  for (let index = 0; index < options.toolCalls.length; index += 1) {
    if (isSignalAborted(options.signal)) {
      break;
    }
    const toolCall = options.toolCalls[index];
    if (toolCall === undefined) {
      continue;
    }
    await recordToolStart(options.store, options.sessionId, toolCall);
    pending.set(
      index,
      executeToolCall(
        options.store,
        options.repoRoot,
        options.sessionId,
        options.tools,
        toolCall,
      ).then((result): ExecutedToolCall => ({ index, toolCall, result })),
    );
    yield toolStartedEvent(toolCall);
  }

  while (pending.size > 0) {
    const execution = await Promise.race(pending.values());
    pending.delete(execution.index);
    orderedExecutions[execution.index] = execution;
    yield toolCompletedEvent(execution);
  }

  return orderedExecutions.filter(
    (execution): execution is ExecutedToolCall => execution !== undefined,
  );
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

async function executeToolCall(
  store: SessionStore,
  repoRoot: string,
  sessionId: string,
  tools: ToolRegistry,
  toolCall: AgentToolCall,
): Promise<ToolExecutionResult> {
  return tools.safeExecuteText(toolCall.name, toolCall.argumentsText, {
    repoRoot,
    sessionId,
    toolCallId: toolCall.id,
    recordFileChange: async (change) => {
      await store.appendEvent(sessionId, "file.changed", {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        ...change,
      });
    },
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
