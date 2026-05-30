import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgentLoopEvents } from "../agentLoop.js";
import type { AgentRunEvent, ModelAdapter, ModelRequest, ModelResponse } from "../types.js";

class SequenceModelAdapter implements ModelAdapter {
  readonly name = "sequence-test";
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No fake model response configured");
    }
    return response;
  }
}

describe("runAgentLoopEvents", () => {
  test("emits session, model, and tool lifecycle events", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-events-"));
    try {
      await mkdir(path.join(repoRoot, "projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "projects", "alpha.md"),
        "# Alpha\n\nNeedle found.\n",
        "utf8",
      );

      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "wiki.search",
              argumentsText: JSON.stringify({ query: "Needle" }),
            },
          ],
        },
        {
          content: "Needle is documented.",
          finishReason: "stop",
          toolCalls: [],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
          },
        },
      ]);

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Where is Needle documented?",
        model,
        repoRoot,
      })) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("session.started");
      expect(types).toContain("message.user");
      expect(types).toContain("model.request");
      expect(types).toContain("model.response");
      expect(types).toContain("tool.call.started");
      expect(types).toContain("tool.call.completed");
      expect(types).toContain("agent.completed");

      const completion = events.find((e) => e.type === "agent.completed");
      expect(completion?.type === "agent.completed" && completion.result.status).toBe("completed");
      const finalResponse = events.find(
        (e) => e.type === "model.response" && e.content === "Needle is documented.",
      );
      expect(finalResponse?.type === "model.response" && finalResponse.usage).toEqual({
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("emits assistant.delta events while the adapter streams text", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-stream-"));
    try {
      const streamingModel: ModelAdapter = {
        name: "streaming-test",
        async complete(request: ModelRequest): Promise<ModelResponse> {
          // Simulate three SSE deltas arriving in sequence before the final
          // response resolves — the loop should yield each as an
          // `assistant.delta` event prior to the `model.response`.
          for (const chunk of ["Hello", ", ", "world"]) {
            request.onAssistantDelta?.(chunk);
            await new Promise((resolve) => setTimeout(resolve, 1));
          }
          return {
            content: "Hello, world",
            finishReason: "stop",
            toolCalls: [],
          };
        },
      };

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "say hi",
        model: streamingModel,
        repoRoot,
      })) {
        events.push(event);
      }

      const deltas = events.filter((e) => e.type === "assistant.delta");
      expect(deltas.map((e) => (e.type === "assistant.delta" ? e.contentDelta : ""))).toEqual([
        "Hello",
        ", ",
        "world",
      ]);

      // assistant.delta events must precede the model.response event for the
      // same iteration — that's what lets the TUI grow the transcript
      // incrementally and finalize once at the end.
      const firstDeltaIdx = events.findIndex((e) => e.type === "assistant.delta");
      const responseIdx = events.findIndex((e) => e.type === "model.response");
      expect(firstDeltaIdx).toBeLessThan(responseIdx);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("emits assistant.reasoning events and carries reasoning on model.response", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-reasoning-"));
    try {
      const model: ModelAdapter = {
        name: "reasoning-test",
        async complete(request: ModelRequest): Promise<ModelResponse> {
          request.onReasoningDelta?.("Thinking ");
          request.onReasoningDelta?.("hard.");
          request.onAssistantDelta?.("Answer.");
          return {
            content: "Answer.",
            finishReason: "stop",
            toolCalls: [],
            reasoning: "Thinking hard.",
            reasoningSignature: "SIG",
          };
        },
      };

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "think then answer",
        model,
        repoRoot,
      })) {
        events.push(event);
      }

      const reasoningDeltas = events.filter((e) => e.type === "assistant.reasoning");
      expect(
        reasoningDeltas.map((e) => (e.type === "assistant.reasoning" ? e.reasoningDelta : "")),
      ).toEqual(["Thinking ", "hard."]);

      // Reasoning deltas precede the visible-answer delta for the turn.
      const firstReasoningIdx = events.findIndex((e) => e.type === "assistant.reasoning");
      const firstDeltaIdx = events.findIndex((e) => e.type === "assistant.delta");
      expect(firstReasoningIdx).toBeLessThan(firstDeltaIdx);

      const response = events.find((e) => e.type === "model.response");
      expect(response?.type === "model.response" && response.reasoning).toBe("Thinking hard.");

      // The durable model.response event records reasoning + signature for replay.
      const started = events.find((e) => e.type === "session.started");
      const sessionId = started?.type === "session.started" ? started.sessionId : "";
      const trace = await readFile(
        path.join(repoRoot, ".strata", "traces", `${sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain('"reasoning":"Thinking hard."');
      expect(trace).toContain('"reasoningSignature":"SIG"');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("aborts mid-run when the signal fires and ends the session interrupted", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-cancel-"));
    try {
      const controller = new AbortController();
      const model: ModelAdapter = {
        name: "abort-test",
        async complete(request: ModelRequest): Promise<ModelResponse> {
          if (request.signal !== undefined && !request.signal.aborted) {
            controller.abort({ source: "test.abort", message: "unit test cancellation" });
          }
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [
              { id: "c1", name: "wiki.search", argumentsText: JSON.stringify({ query: "x" }) },
            ],
          };
        },
      };

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "abort me",
        model,
        repoRoot,
        signal: controller.signal,
      })) {
        events.push(event);
      }

      const completion = events.find((e) => e.type === "agent.completed");
      expect(completion?.type === "agent.completed" && completion.result.status).toBe(
        "interrupted",
      );
      expect(completion?.type === "agent.completed" && completion.result.stoppedReason).toBe(
        "cancelled",
      );
      if (completion?.type !== "agent.completed") {
        throw new Error("expected completion event");
      }
      const traceEvents = await readTraceEvents(repoRoot, completion.result.sessionId);
      const stopped = traceEvents.find((event) => event.type === "agent.loop.stopped");
      expect(stopped?.payload).toMatchObject({
        reason: "cancelled",
        cancellation: {
          source: "test.abort",
          message: "unit test cancellation",
        },
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function readTraceEvents(
  repoRoot: string,
  sessionId: string,
): Promise<Array<{ type: string; payload: unknown }>> {
  const content = await readFile(
    path.join(repoRoot, ".strata", "traces", `${sessionId}.jsonl`),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { type: string; payload: unknown });
}
