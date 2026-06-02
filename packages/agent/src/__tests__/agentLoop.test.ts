import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { createDefaultToolRegistry, ToolRegistry } from "@strata/tools";
import { runAgentLoop, runAgentLoopEvents } from "../agentLoop.js";
import { buildCompactedMessageRecords } from "../compaction.js";
import { ModelAdapterError } from "../model.js";
import type { AgentRunEvent, ModelAdapter, ModelRequest, ModelResponse } from "../types.js";

class SequenceModelAdapter implements ModelAdapter {
  readonly name = "sequence-test";
  readonly contextWindow?: number;
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(
    private readonly responses: ModelResponse[],
    contextWindow?: number,
  ) {
    if (contextWindow !== undefined) {
      this.contextWindow = contextWindow;
    }
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    // Drop the streaming callback before snapshotting — structuredClone
    // can't clone functions or AbortSignals, and the test only inspects
    // message/tool data.
    const {
      onAssistantDelta: _omit,
      onReasoningDelta: _omitReasoning,
      signal: _signal,
      ...rest
    } = request;
    this.requests.push(structuredClone(rest));
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No fake model response configured");
    }
    return response;
  }
}

class FlakyModelAdapter implements ModelAdapter {
  readonly name = "flaky-test";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly outcomes: Array<ModelResponse | Error>) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const {
      onAssistantDelta: _omit,
      onReasoningDelta: _omitReasoning,
      signal: _signal,
      ...rest
    } = request;
    this.requests.push(structuredClone(rest));
    const outcome = this.outcomes[this.index];
    this.index += 1;
    if (outcome === undefined) {
      throw new Error("No fake model outcome configured");
    }
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  }
}

describe("runAgentLoop", () => {
  test("runs a sequential tool loop and persists traces", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
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
          content: "Needle is documented in projects/alpha.md.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Where is Needle documented?",
        model,
        repoRoot,
      });

      expect(result.status).toBe("completed");
      expect(result.stoppedReason).toBe("final_answer");
      expect(result.toolCalls).toBe(1);
      expect(model.requests).toHaveLength(2);
      expect(model.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool" });

      const trace = await readFile(
        path.join(repoRoot, ".strata", "traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("message.system_context");
      expect(trace).toContain("model.response");
      expect(trace).toContain("tool.call");
      expect(trace).toContain("tool.result");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("executes multiple tool calls in parallel by default while preserving source-order tool messages", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-parallel-"));
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstResolved = false;
    let parallelObserved = false;
    try {
      const tools = new ToolRegistry();
      tools.register({
        name: "test.echo",
        description: "Echo a value.",
        mode: "read",
        inputSchema: { type: "object" },
        async handler(args) {
          const value = String(args.value);
          if (value === "first") {
            await firstDone;
            firstResolved = true;
          }
          if (value === "second" && !firstResolved) {
            parallelObserved = true;
            setTimeout(() => releaseFirst?.(), 0);
          }
          return { value };
        },
      });
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "test.echo",
              argumentsText: JSON.stringify({ value: "first" }),
            },
            {
              id: "call_2",
              name: "test.echo",
              argumentsText: JSON.stringify({ value: "second" }),
            },
          ],
        },
        { content: "done", finishReason: "stop", toolCalls: [] },
      ]);
      const releaseTimer = setTimeout(() => releaseFirst?.(), 1_000);
      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Echo twice.",
        model,
        repoRoot,
        tools,
      })) {
        events.push(event);
      }
      clearTimeout(releaseTimer);

      expect(parallelObserved).toBe(true);
      expect(
        events.flatMap((event) => (event.type === "tool.call.completed" ? [event.toolCallId] : [])),
      ).toEqual(["call_2", "call_1"]);
      expect(
        (model.requests[1]?.messages ?? [])
          .filter((message) => message.role === "tool")
          .map((message) => message.toolCallId),
      ).toEqual(["call_1", "call_2"]);
    } finally {
      releaseFirst?.();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("passes the run cancellation signal into tool contexts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-tool-signal-"));
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    try {
      const tools = new ToolRegistry();
      tools.register({
        name: "test.wait",
        description: "Wait until cancelled.",
        mode: "read",
        inputSchema: { type: "object" },
        async handler(_args, context) {
          observedSignal = context.signal;
          return await new Promise<{ aborted: boolean }>((resolve) => {
            if (context.signal === undefined) {
              resolve({ aborted: false });
              return;
            }
            context.signal?.addEventListener(
              "abort",
              () => resolve({ aborted: context.signal?.aborted ?? false }),
              { once: true },
            );
          });
        },
      });
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_wait",
              name: "test.wait",
              argumentsText: "{}",
            },
          ],
        },
      ]);
      const events: AgentRunEvent[] = [];
      await withTimeout(
        (async () => {
          for await (const event of runAgentLoopEvents({
            question: "Wait.",
            model,
            repoRoot,
            tools,
            signal: controller.signal,
          })) {
            events.push(event);
            if (event.type === "tool.call.started") {
              controller.abort();
            }
          }
        })(),
        2_000,
      );

      expect(observedSignal).toBe(controller.signal);
      expect(events.at(-1)).toMatchObject({
        type: "agent.completed",
        result: { stoppedReason: "cancelled" },
      });
      expect(events.find((event) => event.type === "tool.call.completed")).toMatchObject({
        result: {
          ok: true,
          result: { aborted: true },
        },
      });
    } finally {
      controller.abort();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("toolExecution sequential forces multiple tool calls to run one by one", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-sequential-"));
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstResolved = false;
    let parallelObserved = false;
    try {
      const tools = new ToolRegistry();
      tools.register({
        name: "test.echo",
        description: "Echo a value.",
        mode: "read",
        inputSchema: { type: "object" },
        async handler(args) {
          const value = String(args.value);
          if (value === "first") {
            await firstDone;
            firstResolved = true;
          }
          if (value === "second" && !firstResolved) {
            parallelObserved = true;
          }
          return { value };
        },
      });
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "test.echo",
              argumentsText: JSON.stringify({ value: "first" }),
            },
            {
              id: "call_2",
              name: "test.echo",
              argumentsText: JSON.stringify({ value: "second" }),
            },
          ],
        },
        { content: "done", finishReason: "stop", toolCalls: [] },
      ]);
      const releaseTimer = setTimeout(() => releaseFirst?.(), 20);
      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Echo twice.",
        model,
        repoRoot,
        tools,
        toolExecution: "sequential",
      })) {
        events.push(event);
      }
      clearTimeout(releaseTimer);

      expect(parallelObserved).toBe(false);
      expect(
        events.flatMap((event) => (event.type === "tool.call.completed" ? [event.toolCallId] : [])),
      ).toEqual(["call_1", "call_2"]);
    } finally {
      releaseFirst?.();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("a tool executionMode sequential override forces the whole batch sequential", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-tool-sequential-"));
    let releaseFirst: (() => void) | undefined;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstResolved = false;
    let parallelObserved = false;
    try {
      const tools = new ToolRegistry();
      tools.register({
        name: "test.echo",
        description: "Echo a value.",
        mode: "read",
        inputSchema: { type: "object" },
        executionMode: "sequential",
        async handler(args) {
          const value = String(args.value);
          if (value === "first") {
            await firstDone;
            firstResolved = true;
          }
          if (value === "second" && !firstResolved) {
            parallelObserved = true;
          }
          return { value };
        },
      });
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "test.echo",
              argumentsText: JSON.stringify({ value: "first" }),
            },
            {
              id: "call_2",
              name: "test.echo",
              argumentsText: JSON.stringify({ value: "second" }),
            },
          ],
        },
        { content: "done", finishReason: "stop", toolCalls: [] },
      ]);
      const releaseTimer = setTimeout(() => releaseFirst?.(), 20);
      for await (const _event of runAgentLoopEvents({
        question: "Echo twice.",
        model,
        repoRoot,
        tools,
      })) {
        // consume
      }
      clearTimeout(releaseTimer);

      expect(parallelObserved).toBe(false);
    } finally {
      releaseFirst?.();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("retries transient model transport failures before failing the run", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-retry-"));
    try {
      const model = new FlakyModelAdapter([
        new ModelAdapterError(
          "codex_http_error",
          "Codex request failed with HTTP 503: upstream connect error",
        ),
        new ModelAdapterError(
          "codex_http_error",
          "Codex request failed with HTTP 502: upstream reset",
        ),
        { content: "Recovered.", finishReason: "stop", toolCalls: [] },
      ]);

      const result = await runAgentLoop({
        question: "Can you recover?",
        model,
        repoRoot,
        modelRetryPolicy: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      });

      expect(result.status).toBe("completed");
      expect(result.finalAnswer).toBe("Recovered.");
      expect(model.requests).toHaveLength(3);

      const trace = await readFile(
        path.join(repoRoot, ".strata", "traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace.match(/"type":"model.retry"/g) ?? []).toHaveLength(2);
      expect(trace).not.toContain('"type":"agent.loop.error"');
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("does not retry non-transient model errors", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-no-retry-"));
    try {
      const model = new FlakyModelAdapter([
        new ModelAdapterError(
          "codex_http_error",
          "Codex request failed with HTTP 401: unauthorized",
        ),
        { content: "Should not run.", finishReason: "stop", toolCalls: [] },
      ]);

      const result = await runAgentLoop({
        question: "Can you recover?",
        model,
        repoRoot,
        modelRetryPolicy: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0 },
      });

      expect(result.status).toBe("failed");
      expect(result.stoppedReason).toBe("model_error");
      expect(model.requests).toHaveLength(1);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("retries Anthropic rate limits with retry-after delays", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-anthropic-retry-"));
    try {
      const model = new FlakyModelAdapter([
        new ModelAdapterError(
          "anthropic_http_error",
          "Anthropic request failed with HTTP 429 (rate_limit_error): input tokens per minute exceeded",
          { retryAfterMs: 123 },
        ),
        { content: "Recovered after rate limit.", finishReason: "stop", toolCalls: [] },
      ]);

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Can you recover?",
        model,
        repoRoot,
        modelRetryPolicy: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 60_000 },
      })) {
        events.push(event);
      }

      const retry = events.find((event) => event.type === "model.retry");
      const completed = events.find((event) => event.type === "agent.completed");
      expect(retry).toMatchObject({ type: "model.retry", delayMs: 123 });
      expect(completed?.type === "agent.completed" ? completed.result.finalAnswer : "").toBe(
        "Recovered after rate limit.",
      );
      expect(model.requests).toHaveLength(2);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("does not retry terminal rate limit errors", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-terminal-rate-limit-"));
    try {
      const model = new FlakyModelAdapter([
        new ModelAdapterError(
          "anthropic_http_error",
          "Anthropic request failed with HTTP 429 (rate_limit_error): Monthly usage limit reached",
        ),
        { content: "Should not run.", finishReason: "stop", toolCalls: [] },
      ]);

      const result = await runAgentLoop({
        question: "Can you recover?",
        model,
        repoRoot,
        modelRetryPolicy: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      });

      expect(result.status).toBe("failed");
      expect(model.requests).toHaveLength(1);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("retries Pi-style transient network error text", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-network-retry-"));
    try {
      const model = new FlakyModelAdapter([
        new Error("Network connection lost."),
        { content: "Recovered after reconnect.", finishReason: "stop", toolCalls: [] },
      ]);

      const result = await runAgentLoop({
        question: "Can you recover?",
        model,
        repoRoot,
        modelRetryPolicy: { maxAttempts: 2, initialDelayMs: 0, maxDelayMs: 0 },
      });

      expect(result.status).toBe("completed");
      expect(result.finalAnswer).toBe("Recovered after reconnect.");
      expect(model.requests).toHaveLength(2);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("returns tool errors to the model", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "wiki.missing",
              argumentsText: "{}",
            },
          ],
        },
        {
          content: "The requested tool is unavailable.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Use a missing tool.",
        model,
        repoRoot,
      });

      expect(result.status).toBe("completed");
      const toolMessage = model.requests[1]?.messages.at(-1);
      expect(toolMessage?.role).toBe("tool");
      expect(toolMessage?.content).toContain("unknown_tool");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("sanitizes terminal controls from generated session titles", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "Done.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "bad \x1b[99;5u title \x1b]2;owned\x07 ok",
        model,
        repoRoot,
      });

      const store = await SessionStore.open(repoRoot);
      try {
        const session = store.getSession(result.sessionId);
        expect(session?.title).toBe("bad title ok");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("returns invalid tool argument errors to the model", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "wiki.search",
              argumentsText: "[]",
            },
          ],
        },
        {
          content: "The tool arguments were invalid.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Use invalid tool args.",
        model,
        repoRoot,
      });

      expect(result.status).toBe("completed");
      const toolMessage = model.requests[1]?.messages.at(-1);
      expect(toolMessage?.role).toBe("tool");
      expect(toolMessage?.content).toContain("invalid_tool_args");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("records file-change events for write tools", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "fs.write",
              argumentsText: JSON.stringify({
                path: "notes/alpha.md",
                content: "# Alpha\n",
                createDirs: true,
              }),
            },
          ],
        },
        {
          content: "Wrote notes/alpha.md.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Create an alpha note.",
        model,
        repoRoot,
        tools: createDefaultToolRegistry({ profile: "maintenance" }),
      });

      expect(result.status).toBe("completed");
      expect(await readFile(path.join(repoRoot, "notes", "alpha.md"), "utf8")).toBe("# Alpha\n");

      const trace = await readFile(
        path.join(repoRoot, ".strata", "traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("file.changed");
      expect(trace).toContain("notes/alpha.md");
      expect(trace).toContain("sha256:");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("continueSessionId appends the next user turn before model continuation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
    try {
      const firstModel = new SequenceModelAdapter([
        { content: "Hi, I'm Strata.", finishReason: "stop", toolCalls: [] },
      ]);
      const first = await runAgentLoop({
        question: "Who are you?",
        model: firstModel,
        repoRoot,
      });
      expect(first.status).toBe("completed");

      const secondModel = new SequenceModelAdapter([
        {
          content: "I just told you: Strata.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "What did you just say?",
        model: secondModel,
        repoRoot,
        continueSessionId: first.sessionId,
      })) {
        events.push(event);
      }

      const completed = events.find((event) => event.type === "agent.completed");
      if (completed?.type !== "agent.completed") {
        throw new Error("missing completion event");
      }
      expect(completed.result.sessionId).toBe(first.sessionId);

      const seeded = secondModel.requests[0]?.messages ?? [];
      const nonSystem = seeded.filter((m) => m.role !== "system");
      expect(nonSystem.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(nonSystem[0]?.content).toBe("Who are you?");
      expect(nonSystem[1]?.content).toBe("Hi, I'm Strata.");
      expect(nonSystem[2]?.content).toBe("What did you just say?");
      expect(events).toContainEqual({ type: "message.user", content: "What did you just say?" });

      const store = await SessionStore.open(repoRoot);
      try {
        expect(
          store
            .listMessages(first.sessionId)
            .filter((message) => message.role !== "system")
            .map((message) => message.role),
        ).toEqual(["user", "assistant", "user", "assistant"]);
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("injects steering messages after a tool batch before the next model request", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-steer-"));
    try {
      const tools = new ToolRegistry().register({
        name: "test.wait",
        description: "Test wait tool.",
        mode: "read",
        inputSchema: { type: "object", additionalProperties: false },
        handler: () => ({ waited: true }),
      });
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "test.wait",
              argumentsText: "{}",
            },
          ],
        },
        {
          content: "steered answer",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      let steeringPolls = 0;
      const events: AgentRunEvent[] = [];

      for await (const event of runAgentLoopEvents({
        question: "start",
        model,
        repoRoot,
        tools,
        getSteeringMessages: () => {
          steeringPolls += 1;
          return steeringPolls === 2
            ? [{ role: "user", content: "steer now", clientMessageId: "queued-1" }]
            : [];
        },
      })) {
        events.push(event);
      }

      expect(model.requests).toHaveLength(2);
      const secondRequest = model.requests[1]?.messages.filter(
        (message) => message.role !== "system",
      );
      expect(secondRequest?.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "tool",
        "user",
      ]);
      expect(secondRequest?.at(-1)?.content).toBe("steer now");
      expect(events).toContainEqual({
        type: "message.user",
        content: "steer now",
        clientMessageId: "queued-1",
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("injects follow-up messages only after the agent would otherwise stop", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-follow-up-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "original answer",
          finishReason: "stop",
          toolCalls: [],
        },
        {
          content: "follow-up answer",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      let followUpPolls = 0;

      const result = await runAgentLoop({
        question: "start",
        model,
        repoRoot,
        getSteeringMessages: () => [],
        getFollowUpMessages: () => {
          followUpPolls += 1;
          return followUpPolls === 1 ? [{ role: "user", content: "after current answer" }] : [];
        },
      });

      expect(result.finalAnswer).toBe("follow-up answer");
      expect(model.requests).toHaveLength(2);
      const secondRequest = model.requests[1]?.messages.filter(
        (message) => message.role !== "system",
      );
      expect(secondRequest?.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
      expect(secondRequest?.at(-1)?.content).toBe("after current answer");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("continueSessionId reuses an already-persisted trailing user turn", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-"));
    try {
      const firstModel = new SequenceModelAdapter([
        { content: "Hi, I'm Strata.", finishReason: "stop", toolCalls: [] },
      ]);
      const first = await runAgentLoop({
        question: "Who are you?",
        model: firstModel,
        repoRoot,
      });
      const store = await SessionStore.open(repoRoot);
      try {
        await store.recordUserMessage({ sessionId: first.sessionId, content: "Acknowledged." });
      } finally {
        store.close();
      }

      const secondModel = new SequenceModelAdapter([
        { content: "ok", finishReason: "stop", toolCalls: [] },
      ]);
      await runAgentLoop({
        question: "Acknowledged.",
        model: secondModel,
        repoRoot,
        continueSessionId: first.sessionId,
      });

      const seeded = secondModel.requests[0]?.messages ?? [];
      const nonSystem = seeded.filter((m) => m.role !== "system");
      expect(nonSystem.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(nonSystem[2]?.content).toBe("Acknowledged.");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("continueSessionId repairs an incomplete prior tool turn before model continuation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-dangling-tool-"));
    let sessionId = "";
    try {
      const store = await SessionStore.open(repoRoot);
      try {
        const session = await store.createSession({
          kind: "query",
          title: "dangling tool",
          model: "sequence-test",
        });
        sessionId = session.id;
        await store.recordUserMessage({ sessionId, content: "Start." });
        await store.recordAssistantMessage({
          sessionId,
          iteration: 1,
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_missing",
              name: "shell.run",
              argumentsText: JSON.stringify({ command: "echo never-finished" }),
            },
          ],
        });
        await store.recordToolStart({
          sessionId,
          toolCallId: "call_missing",
          toolName: "shell.run",
          argumentsText: JSON.stringify({ command: "echo never-finished" }),
        });
        await store.recordUserMessage({ sessionId, content: "Continue" });
      } finally {
        store.close();
      }

      const model = new SequenceModelAdapter([
        { content: "Recovered.", finishReason: "stop", toolCalls: [] },
      ]);
      const result = await runAgentLoop({
        question: "Continue",
        model,
        repoRoot,
        continueSessionId: sessionId,
      });

      expect(result.status).toBe("completed");
      const nonSystem = (model.requests[0]?.messages ?? []).filter((m) => m.role !== "system");
      expect(nonSystem.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
      expect(nonSystem[2]).toMatchObject({
        role: "tool",
        toolCallId: "call_missing",
      });
      expect(nonSystem[2]?.content).toContain("missing_tool_result");
      expect(nonSystem[3]?.content).toBe("Continue");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("continueSessionId rejects prior context ending in assistant when no new prompt is provided", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-continue-assistant-"));
    try {
      const firstModel = new SequenceModelAdapter([
        { content: "Hi, I'm Strata.", finishReason: "stop", toolCalls: [] },
      ]);
      const first = await runAgentLoop({
        question: "Who are you?",
        model: firstModel,
        repoRoot,
      });
      expect(first.status).toBe("completed");

      const secondModel = new SequenceModelAdapter([
        { content: "unreachable", finishReason: "stop", toolCalls: [] },
      ]);
      const second = await runAgentLoop({
        question: "",
        model: secondModel,
        repoRoot,
        continueSessionId: first.sessionId,
      });

      expect(second.status).toBe("failed");
      expect(secondModel.requests).toHaveLength(0);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("auto-compacts after a completed turn when context usage crosses the reserve threshold", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-compact-"));
    try {
      const model = new SequenceModelAdapter(
        [
          {
            content: "final answer",
            finishReason: "stop",
            toolCalls: [],
            usage: { total_tokens: 950 },
          },
          {
            content: "## Goal\nsummarized",
            finishReason: "stop",
            toolCalls: [],
          },
        ],
        1_000,
      );
      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Use a lot of context.",
        model,
        repoRoot,
        autoCompactReserveTokens: 100,
      })) {
        events.push(event);
      }

      expect(events.some((event) => event.type === "compaction.started")).toBe(true);
      expect(events.some((event) => event.type === "compaction.completed")).toBe(true);
      expect(model.requests).toHaveLength(2);
      expect(model.requests[1]?.messages[1]?.content).toContain("<conversation>");

      const completed = events.find((event) => event.type === "agent.completed");
      if (completed?.type !== "agent.completed") {
        throw new Error("missing completion event");
      }
      const store = await SessionStore.open(repoRoot);
      try {
        const remaining = store.listMessages(completed.result.sessionId);
        expect(remaining.filter((message) => message.role === "system")).not.toHaveLength(0);
        expect(
          remaining.filter((message) => message.role !== "system").map((message) => message.role),
        ).toEqual(["user", "assistant"]);
        const compacted = buildCompactedMessageRecords(store, completed.result.sessionId);
        expect(compacted).toHaveLength(1);
        expect(compacted[0]?.content).toContain("Summary of our earlier conversation");
        expect(compacted[0]?.content).toContain("summarized");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("auto-compacts a continued session before seeding the next user turn", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-precompact-"));
    try {
      const firstModel = new SequenceModelAdapter([
        {
          content: "large prior answer",
          finishReason: "stop",
          toolCalls: [],
          usage: { total_tokens: 950 },
        },
      ]);
      const first = await runAgentLoop({
        question: "Build context.",
        model: firstModel,
        repoRoot,
        autoCompact: false,
      });

      const secondModel = new SequenceModelAdapter(
        [
          {
            content: "## Goal\nprior context summarized",
            finishReason: "stop",
            toolCalls: [],
          },
          {
            content: "continued",
            finishReason: "stop",
            toolCalls: [],
          },
        ],
        1_000,
      );
      await runAgentLoop({
        question: "Continue.",
        model: secondModel,
        repoRoot,
        continueSessionId: first.sessionId,
        autoCompactReserveTokens: 100,
      });

      expect(secondModel.requests).toHaveLength(2);
      expect(secondModel.requests[0]?.messages[1]?.content).toContain("<conversation>");
      const seeded = secondModel.requests[1]?.messages ?? [];
      const nonSystem = seeded.filter((message) => message.role !== "system");
      expect(nonSystem.map((message) => message.role)).toEqual(["user", "user"]);
      expect(nonSystem[0]?.content).toContain("Summary of our earlier conversation");
      expect(nonSystem[0]?.content).toContain("prior context summarized");
      expect(nonSystem[1]?.content).toBe("Continue.");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("compacts and retries once after a context overflow error", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-overflow-"));
    try {
      const model = new FlakyModelAdapter([
        new ModelAdapterError(
          "model_http_error",
          "Model request failed with HTTP 400: context length exceeded",
        ),
        {
          content: "## Goal\noverflow context summarized",
          finishReason: "stop",
          toolCalls: [],
        },
        {
          content: "Recovered after compaction.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "This prompt is too large.",
        model,
        repoRoot,
      })) {
        events.push(event);
      }

      const completed = events.find((event) => event.type === "agent.completed");
      if (completed?.type !== "agent.completed") {
        throw new Error("missing completion event");
      }
      expect(completed.result.status).toBe("completed");
      expect(completed.result.finalAnswer).toBe("Recovered after compaction.");
      expect(model.requests).toHaveLength(3);
      expect(model.requests[1]?.messages[1]?.content).toContain("<conversation>");
      const retriedMessages = model.requests[2]?.messages.filter(
        (message) => message.role !== "system",
      );
      expect(retriedMessages).toHaveLength(1);
      expect(retriedMessages?.[0]?.content).toContain("Summary of our earlier conversation");
      expect(retriedMessages?.[0]?.content).toContain("overflow context summarized");
      expect(
        events.filter((event) => event.type === "compaction.started").map((event) => event.reason),
      ).toEqual(["overflow"]);
      expect(
        events
          .filter((event) => event.type === "compaction.completed")
          .map((event) => event.reason),
      ).toEqual(["overflow"]);
      expect(events.some((event) => event.type === "model.retry")).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("does not attempt overflow recovery more than once in a run", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-overflow-fail-"));
    try {
      const model = new FlakyModelAdapter([
        new ModelAdapterError(
          "model_http_error",
          "Model request failed with HTTP 400: context length exceeded",
        ),
        {
          content: "## Goal\noverflow context summarized",
          finishReason: "stop",
          toolCalls: [],
        },
        new ModelAdapterError(
          "model_http_error",
          "Model request failed with HTTP 400: prompt is too long",
        ),
      ]);

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Still too large.",
        model,
        repoRoot,
      })) {
        events.push(event);
      }

      const failed = events.find((event) => event.type === "agent.failed");
      if (failed?.type !== "agent.failed") {
        throw new Error("missing failure event");
      }
      expect(failed.message).toContain("after one compact-and-retry attempt");
      expect(model.requests).toHaveLength(3);
      expect(events.filter((event) => event.type === "compaction.completed")).toHaveLength(1);
      expect(events.some((event) => event.type === "model.retry")).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
