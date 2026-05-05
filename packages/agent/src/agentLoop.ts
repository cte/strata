import {
  getCortexPaths,
  SessionStore,
  type JsonObject,
  type JsonValue,
  type SessionRecord,
} from "@cortex/core";
import { createDefaultToolRegistry, type ToolRegistry } from "@cortex/tools";
import type { ToolExecutionResult } from "@cortex/tools";
import type {
  AgentMessage,
  AgentRunConfig,
  AgentRunEvent,
  AgentRunResult,
  AgentToolCall,
  ModelResponse,
} from "./types.js";
import { buildRunContext } from "./runContext.js";

// Pi parity: no iteration / tool-call ceiling. The loop runs until the model
// returns no tool calls (final answer), the model errors out, or the user
// cancels via Ctrl+C (signal abort).

export async function* runAgentLoopEvents(config: AgentRunConfig): AsyncGenerator<AgentRunEvent> {
  const repoRoot = getCortexPaths(config.repoRoot).repoRoot;
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
        const messageInput: import("@cortex/core").MessageInput = {
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
      await store.appendEvent(session.id, "model.request", {
        iteration: iterations,
        messageCount: messages.length,
      });
      yield { type: "model.request", iteration: iterations, messageCount: messages.length };

      let response: ModelResponse;
      // Streaming bridge: deltas come from the adapter via callback while we
      // await the response. Push them into a queue, race the response promise
      // against a "delta-arrived" wakeup, and yield queued deltas as soon as
      // they appear so the TUI can render them in real time.
      const deltaQueue: string[] = [];
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
        throw settled.error;
      }
      response = settled.value;

      await persistModelResponse(store, session.id, iterations, response);
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });
      await store.appendMessage({
        sessionId: session.id,
        role: "assistant",
        content: response.content,
        toolCalls: toolCallsToJson(response.toolCalls),
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

      for (const toolCall of response.toolCalls) {
        if (isAborted()) {
          cancelled = true;
          break;
        }
        toolCallCount += 1;
        yield {
          type: "tool.call.started",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          argumentsText: toolCall.argumentsText,
        };
        const toolResult = await executeToolCall(store, session.id, repoRoot, tools, toolCall);
        const toolContent = JSON.stringify(toolResult);
        messages.push({
          role: "tool",
          content: toolContent,
          toolCallId: toolCall.id,
        });
        await store.appendMessage({
          sessionId: session.id,
          role: "tool",
          content: toolContent,
          toolCallId: toolCall.id,
        });
        yield { type: "tool.call.completed", toolCallId: toolCall.id, result: toolResult };
      }

      if (cancelled) {
        break;
      }
    }

    // The only way to fall out of `while (true)` is cancellation — final
    // answer paths return directly from inside the loop. Emit the cancel.
    await store.appendEvent(session.id, "agent.loop.stopped", {
      reason: "cancelled",
      iterations,
      toolCalls: toolCallCount,
    });
    await store.endSession(session.id, "interrupted");
    yield { type: "agent.completed", result: buildCancelledResult() };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
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

async function persistModelResponse(
  store: SessionStore,
  sessionId: string,
  iteration: number,
  response: ModelResponse,
): Promise<void> {
  const payload: JsonObject = {
    iteration,
    content: response.content,
    finishReason: response.finishReason,
    toolCalls: toolCallsToJson(response.toolCalls),
  };
  if (response.providerResponseId !== undefined) {
    payload.providerResponseId = response.providerResponseId;
  }
  if (response.usage !== undefined) {
    payload.usage = response.usage;
  }
  await store.appendEvent(sessionId, "model.response", payload);
}

async function appendInitialMessage(
  store: SessionStore,
  sessionId: string,
  message: AgentMessage,
): Promise<void> {
  const input: import("@cortex/core").MessageInput = {
    sessionId,
    role: message.role,
    content: message.content,
  };
  if (message.attachments !== undefined && message.attachments.length > 0) {
    input.attachments = message.attachments as unknown as JsonValue;
  }
  await store.appendMessage(input);
}

async function executeToolCall(
  store: SessionStore,
  sessionId: string,
  repoRoot: string,
  tools: ToolRegistry,
  toolCall: AgentToolCall,
): Promise<ToolExecutionResult> {
  await store.appendEvent(sessionId, "tool.call", {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    argumentsText: toolCall.argumentsText,
  });

  const result = await tools.safeExecuteText(toolCall.name, toolCall.argumentsText, {
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
  await store.appendEvent(sessionId, "tool.result", toolResultEventPayload(toolCall.id, result));
  return result;
}

function toolCallsToJson(toolCalls: AgentToolCall[]): JsonValue {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsText: toolCall.argumentsText,
  }));
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
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`;
}

function messageRecordToAgentMessage(
  record: import("@cortex/core").MessageRecord,
): AgentMessage {
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
