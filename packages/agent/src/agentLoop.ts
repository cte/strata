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

const DEFAULT_MAX_ITERATIONS = 12;
const DEFAULT_MAX_TOOL_CALLS = 40;

export async function* runAgentLoopEvents(config: AgentRunConfig): AsyncGenerator<AgentRunEvent> {
  const repoRoot = getCortexPaths(config.repoRoot).repoRoot;
  const store = await SessionStore.open(repoRoot);
  const tools = config.tools ?? createDefaultToolRegistry();
  const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxToolCalls = config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
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
    messages = runContext.messages;
    systemContext = runContext.systemContext;
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
      maxIterations,
      maxToolCalls,
      tools: tools.list().map((tool) => tool.name),
    });

    yield {
      type: "session.started",
      sessionId: session.id,
      title: session.title,
      model: config.model.name,
    };
    yield { type: "message.user", content: config.question };

    while (iterations < maxIterations) {
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
      try {
        const modelRequest: {
          messages: typeof messages;
          tools: ReturnType<typeof tools.list>;
          signal?: AbortSignal;
        } = {
          messages,
          tools: tools.list(),
        };
        if (signal !== undefined) {
          modelRequest.signal = signal;
        }
        response = await config.model.complete(modelRequest);
      } catch (error: unknown) {
        if (isAborted()) {
          cancelled = true;
          break;
        }
        throw error;
      }

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
      yield {
        type: "model.response",
        iteration: iterations,
        content: response.content,
        toolCalls: response.toolCalls,
      };

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

      if (toolCallCount + response.toolCalls.length > maxToolCalls) {
        finalAnswer = response.content;
        await store.appendEvent(session.id, "agent.loop.stopped", {
          reason: "max_tool_calls",
          iterations,
          toolCalls: toolCallCount,
        });
        await store.endSession(session.id, "interrupted");
        const result: AgentRunResult = {
          sessionId: session.id,
          status: "interrupted",
          stoppedReason: "max_tool_calls",
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

    if (cancelled) {
      await store.appendEvent(session.id, "agent.loop.stopped", {
        reason: "cancelled",
        iterations,
        toolCalls: toolCallCount,
      });
      await store.endSession(session.id, "interrupted");
      yield { type: "agent.completed", result: buildCancelledResult() };
      return;
    }

    await store.appendEvent(session.id, "agent.loop.stopped", {
      reason: "max_iterations",
      iterations,
      toolCalls: toolCallCount,
    });
    await store.endSession(session.id, "interrupted");
    const result: AgentRunResult = {
      sessionId: session.id,
      status: "interrupted",
      stoppedReason: "max_iterations",
      finalAnswer,
      iterations,
      toolCalls: toolCallCount,
    };
    yield { type: "agent.completed", result };
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
  await store.appendMessage({
    sessionId,
    role: message.role,
    content: message.content,
  });
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
