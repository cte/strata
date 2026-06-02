import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AgentRunConfig,
  type AgentRunEvent,
  type AgentRunResult,
  type ModelAdapter,
} from "@strata/agent";
import { SessionStore } from "@strata/core";
import { ChatRunConflictError, type CreateChatServiceOptions, createChatService } from "../chat.js";
import { ChatRunStore } from "../chatRunStore.js";

const fakeModel: ModelAdapter = {
  name: "fake:model",
  complete: async () => ({
    content: "unused",
    finishReason: "stop",
    toolCalls: [],
  }),
};

describe("chat service", () => {
  test("registers an active run and cleans it up after completion", async () => {
    const repoRoot = testRepoRoot();
    const seenModelOptions: unknown[] = [];
    const seenConfigs: AgentRunConfig[] = [];
    const releaseRun = createDeferred<void>();
    const service = createChatService({
      repoRoot,
      env: { STRATA_API_KEY: "sk-test", STRATA_MODEL: "gpt-test" },
      createRunId: () => "run-1",
      createModelAdapter: async (options) => {
        seenModelOptions.push(options);
        return fakeModel;
      },
      runAgentLoopEvents: async function* (config) {
        seenConfigs.push(config);
        yield sessionStarted("session-1");
        await releaseRun.promise;
        yield completed("session-1");
      },
    });

    const run = await service.startRun({ message: "hello" });
    expect(run.runId).toBe("run-1");
    expect(service.getActiveRun("run-1")?.runId).toBe("run-1");
    expect(seenModelOptions).toEqual([
      {
        repoRoot,
        env: { STRATA_API_KEY: "sk-test", STRATA_MODEL: "gpt-test" },
      },
    ]);

    const iterator = run.events[Symbol.asyncIterator]();
    await expect(nextEvent(iterator)).resolves.toEqual({ type: "run.started", runId: "run-1" });
    await expect(nextEvent(iterator)).resolves.toEqual(sessionStarted("session-1"));
    expect(service.getActiveRunForSession("session-1")?.runId).toBe("run-1");
    releaseRun.resolve();

    await expect(nextEvent(iterator)).resolves.toEqual(completed("session-1"));
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(service.listActiveRuns()).toEqual([]);
    expect(seenConfigs[0]).toMatchObject({
      question: "hello",
      model: fakeModel,
      repoRoot,
    });
    expect(seenConfigs[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  test("rejects duplicate active runs for the same continued session", async () => {
    const releaseRun = createDeferred<void>();
    const service = createChatService({
      ...baseOptions(),
      createRunId: sequenceIds("run-1", "run-2"),
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        await releaseRun.promise;
        yield completed("session-1");
      },
    });

    const first = await service.startRun({
      message: "continue",
      continueSessionId: "session-1",
    });
    expect(service.getActiveRunForSession("session-1")?.runId).toBe("run-1");

    await expect(
      service.startRun({
        message: "also continue",
        continueSessionId: "session-1",
      }),
    ).rejects.toBeInstanceOf(ChatRunConflictError);

    releaseRun.resolve();
    await collect(first.events);
    expect(service.getActiveRunForSession("session-1")).toBeUndefined();
  });

  test("queued follow-up messages are persisted before Pi-style continuation", async () => {
    const repoRoot = testRepoRoot();
    const seenConfigs: AgentRunConfig[] = [];
    const service = createChatService({
      ...baseOptions(),
      repoRoot,
      createRunId: sequenceIds("run-1", "run-2"),
      runAgentLoopEvents: async function* (config) {
        seenConfigs.push(config);
        yield sessionStarted("session-1");
        yield completed("session-1");
      },
    });

    const first = await service.startRun({ message: "first" });
    await service.addQueuedMessage({
      id: "queued-1",
      sessionId: "session-1",
      message: "follow-up",
      attachments: [],
      delivery: "follow-up",
    });
    const events = await collect(first.events);

    await waitUntil(() => seenConfigs.length === 2);
    expect(seenConfigs[0]).toMatchObject({ question: "first" });
    expect(seenConfigs[0]?.continueSessionId).toBeUndefined();
    expect(seenConfigs[1]?.question).toBe("follow-up");
    expect(seenConfigs[1]?.continueSessionId).toBe("session-1");
    expect(events).toContainEqual({
      type: "run.replaced",
      previousRunId: "run-1",
      runId: "run-2",
      sessionId: "session-1",
    });
  });

  test("queued messages promoted to steering render pending and drain into the active run", async () => {
    let seenConfig: AgentRunConfig | undefined;
    const releaseRun = createDeferred<void>();
    const service = createChatService({
      ...baseOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        seenConfig = config;
        yield sessionStarted("session-1");
        await releaseRun.promise;
        const steering = await config.getSteeringMessages?.();
        for (const message of steering ?? []) {
          yield {
            type: "message.user",
            content: message.content,
            ...(message.clientMessageId === undefined
              ? {}
              : { clientMessageId: message.clientMessageId }),
          };
        }
        yield completed("session-1");
      },
    });

    const run = await service.startRun({ message: "first" });
    const iterator = run.events[Symbol.asyncIterator]();
    await expect(nextEvent(iterator)).resolves.toEqual({ type: "run.started", runId: "run-1" });
    await expect(nextEvent(iterator)).resolves.toEqual(sessionStarted("session-1"));

    await service.addQueuedMessage({
      id: "queued-1",
      sessionId: "session-1",
      message: "steer now",
      attachments: [],
      delivery: "follow-up",
    });
    expect(service.listQueuedMessages({ sessionId: "session-1" })).toHaveLength(1);

    await expect(service.setQueuedMessageDelivery("queued-1", "steering")).resolves.toMatchObject({
      id: "queued-1",
      delivery: "steering",
    });
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: "message.user.pending",
      content: "steer now",
      clientMessageId: "queued-1",
    });

    releaseRun.resolve();
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: "message.user",
      content: "steer now",
      clientMessageId: "queued-1",
    });
    await expect(nextEvent(iterator)).resolves.toEqual(completed("session-1"));
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    expect(seenConfig?.getSteeringMessages).toEqual(expect.any(Function));
    expect(service.listQueuedMessages({ sessionId: "session-1" })).toHaveLength(0);
  });

  test("queued messages can be reordered before delivery", async () => {
    const service = createChatService(baseOptions());
    await service.addQueuedMessage({
      id: "queued-1",
      sessionId: "session-1",
      message: "first",
      attachments: [],
      delivery: "follow-up",
    });
    await service.addQueuedMessage({
      id: "queued-2",
      sessionId: "session-1",
      message: "second",
      attachments: [],
      delivery: "follow-up",
    });

    await service.moveQueuedMessage("queued-2", "queued-1");

    expect(
      service.listQueuedMessages({ sessionId: "session-1" }).map((message) => message.id),
    ).toEqual(["queued-2", "queued-1"]);
  });

  test("cleans up active state after agent-loop failure", async () => {
    const service = createChatService({
      ...baseOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        throw new Error("loop failed");
      },
    });

    const run = await service.startRun({ message: "fail" });
    await expect(collect(run.events)).resolves.toEqual([
      { type: "run.started", runId: "run-1" },
      sessionStarted("session-1"),
      { type: "agent.failed", message: "loop failed" },
    ]);
    expect(service.getActiveRun("run-1")).toBeUndefined();
    expect(service.getActiveRunForSession("session-1")).toBeUndefined();
  });

  test("persists terminal run status and replays stored events", async () => {
    const service = createChatService({
      ...baseOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        yield { type: "assistant.delta", iteration: 1, contentDelta: "Done" };
        yield completed("session-1");
      },
    });

    const run = await service.startRun({ message: "persist me" });
    await collect(run.events);

    expect(service.getActiveRun("run-1")).toBeUndefined();
    expect(service.getRun("run-1")).toMatchObject({
      runId: "run-1",
      status: "completed",
      cancelled: false,
      sessionId: "session-1",
      lastEventId: 4,
      stoppedReason: "final_answer",
    });
    await expect(collect(requiredEvents(service.subscribeRunEvents("run-1", 2)))).resolves.toEqual([
      { type: "assistant.delta", iteration: 1, contentDelta: "Done" },
      completed("session-1"),
    ]);
  });

  test("cleans up active state when model construction fails", async () => {
    const service = createChatService({
      ...baseOptions(),
      createRunId: () => "run-1",
      createModelAdapter: async () => {
        throw new Error("missing auth");
      },
    });

    await expect(service.startRun({ message: "hi" })).rejects.toThrow("missing auth");
    expect(service.listActiveRuns()).toEqual([]);
  });

  test("cancels an active run by aborting its controller", async () => {
    let seenSignal: AbortSignal | undefined;
    const service = createChatService({
      ...baseOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        seenSignal = config.signal;
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
        yield interrupted("session-1");
      },
    });

    const run = await service.startRun({ message: "stop me" });
    const iterator = run.events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();

    await expect(service.cancelRun("run-1")).resolves.toBe(true);
    expect(seenSignal?.aborted).toBe(true);
    expect(service.getRun("run-1")?.cancelled).toBe(true);

    await expect(nextEvent(iterator)).resolves.toEqual(interrupted("session-1"));
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(service.cancelRun("run-1")).resolves.toBe(false);
    expect(service.listActiveRuns()).toEqual([]);
  });

  test("requires a non-empty message", async () => {
    const service = createChatService(baseOptions());
    await expect(service.startRun({ message: "   " })).rejects.toThrow("Chat message is required");
    expect(service.listActiveRuns()).toEqual([]);
  });

  test("keeps the agent run alive when an event subscriber disconnects", async () => {
    let seenSignal: AbortSignal | undefined;
    const service = createChatService({
      ...baseOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        seenSignal = config.signal;
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
        yield interrupted("session-1");
      },
    });

    const run = await service.startRun({ message: "disconnect" });
    const iterator = run.events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await iterator.return?.();

    expect(seenSignal?.aborted).toBe(false);
    expect(service.getActiveRun("run-1")?.runId).toBe("run-1");
    await expect(service.cancelRun("run-1")).resolves.toBe(true);
    expect(seenSignal?.aborted).toBe(true);
    await waitUntil(() => service.getActiveRun("run-1") === undefined);
  });

  test("records web run diagnostics in the session trace", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-chat-diagnostics-"));
    try {
      const store = await SessionStore.open(repoRoot);
      const session = await store.createSession({
        kind: "query",
        title: "Diagnostic session",
        model: fakeModel.name,
      });
      store.close();

      const service = createChatService({
        ...baseOptions(),
        repoRoot,
        createRunId: () => "run-1",
        runAgentLoopEvents: async function* (config) {
          yield sessionStarted(session.id);
          await onceAborted(config.signal);
          yield interrupted(session.id);
        },
      });

      const run = await service.startRun({ message: "trace me" });
      const iterator = run.events[Symbol.asyncIterator]();
      await iterator.next();
      await iterator.next();

      await expect(service.recordStreamClosed("run-1", "reader_cancelled")).resolves.toBe(true);
      await expect(service.cancelRun("run-1")).resolves.toBe(true);
      await waitUntil(() => service.getActiveRun("run-1") === undefined);

      const traceEvents = await readTraceEvents(repoRoot, session.id);
      expect(traceEvents.map((event) => event.type)).toContain("web.chat.run.started");
      expect(
        traceEvents.find((event) => event.type === "web.chat.stream.closed")?.payload,
      ).toMatchObject({
        runId: "run-1",
        reason: "reader_cancelled",
      });
      expect(
        traceEvents.find((event) => event.type === "web.chat.run.cancel_requested")?.payload,
      ).toMatchObject({
        runId: "run-1",
        source: "web.cancel_endpoint",
      });
      expect(
        traceEvents.find((event) => event.type === "web.chat.run.finished")?.payload,
      ).toMatchObject({
        runId: "run-1",
        cancelled: true,
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("marks abandoned durable runs as failed on service startup", async () => {
    const repoRoot = testRepoRoot();
    const sessionStore = await SessionStore.open(repoRoot);
    const session = await sessionStore.createSession({
      kind: "query",
      title: "Abandoned session",
      model: fakeModel.name,
    });
    sessionStore.close();

    const store = new ChatRunStore(repoRoot);
    try {
      store.createRun({ runId: "run-1" });
      store.bindSession("run-1", session.id);
      store.appendEvent("run-1", "run.started", { type: "run.started", runId: "run-1" });
    } finally {
      store.close();
    }

    const service = createChatService({ ...baseOptions(), repoRoot });

    expect(service.listActiveRuns()).toEqual([]);
    expect(service.getRun("run-1")).toMatchObject({
      runId: "run-1",
      status: "failed",
      stoppedReason: "server_restarted",
      errorMessage: "Server restarted while this run was active.",
    });
    const recoveredSessionStore = await SessionStore.open(repoRoot);
    const recoveredSession = recoveredSessionStore.getSession(session.id);
    recoveredSessionStore.close();
    expect(recoveredSession).toMatchObject({
      id: session.id,
      status: "failed",
    });
    expect(recoveredSession?.endedAt).toEqual(expect.any(String));
    const traceEvents = await readTraceEvents(repoRoot, session.id);
    expect(traceEvents.find((event) => event.type === "session.ended")?.payload).toMatchObject({
      status: "failed",
      stoppedReason: "server_restarted",
    });
    await expect(collect(requiredEvents(service.subscribeRunEvents("run-1")))).resolves.toEqual([
      { type: "run.started", runId: "run-1" },
      { type: "agent.failed", message: "Server restarted while this run was active." },
    ]);
  });

  test("recovers sessions left running by older server restart handling", async () => {
    const repoRoot = testRepoRoot();
    const sessionStore = await SessionStore.open(repoRoot);
    const session = await sessionStore.createSession({
      kind: "query",
      title: "Already failed web run",
      model: fakeModel.name,
    });
    sessionStore.close();

    const store = new ChatRunStore(repoRoot);
    try {
      store.createRun({ runId: "run-1" });
      store.bindSession("run-1", session.id);
      store.appendEvent("run-1", "agent.failed", {
        type: "agent.failed",
        message: "Server restarted while this run was active.",
      });
      store.finishRun("run-1", {
        status: "failed",
        stoppedReason: "server_restarted",
        errorMessage: "Server restarted while this run was active.",
      });
    } finally {
      store.close();
    }

    createChatService({ ...baseOptions(), repoRoot });

    const recoveredSessionStore = await SessionStore.open(repoRoot);
    const recoveredSession = recoveredSessionStore.getSession(session.id);
    recoveredSessionStore.close();
    expect(recoveredSession).toMatchObject({
      id: session.id,
      status: "failed",
    });
    expect(recoveredSession?.endedAt).toEqual(expect.any(String));
  });
});

function baseOptions(): CreateChatServiceOptions {
  return {
    repoRoot: testRepoRoot(),
    env: { STRATA_API_KEY: "sk-test", STRATA_MODEL: "gpt-test" },
    createModelAdapter: async () => fakeModel,
    runAgentLoopEvents: async function* () {
      yield sessionStarted("session-1");
      yield completed("session-1");
    },
  };
}

function testRepoRoot(): string {
  return path.join(os.tmpdir(), `strata-chat-${randomUUID()}`);
}

function requiredEvents<T>(events: AsyncIterable<T> | undefined): AsyncIterable<T> {
  if (events === undefined) {
    throw new Error("expected event stream");
  }
  return events;
}

async function collect<T>(events: AsyncIterable<T>): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(unwrapEvent(event));
  }
  return collected;
}

async function nextEvent<T>(iterator: AsyncIterator<T>): Promise<unknown> {
  const next = await iterator.next();
  if (next.done === true) {
    return undefined;
  }
  return unwrapEvent(next.value);
}

function unwrapEvent(value: unknown): unknown {
  return isRecord(value) && "event" in value ? value.event : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sequenceIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `run-${index}`;
}

function sessionStarted(sessionId: string): AgentRunEvent {
  return {
    type: "session.started",
    sessionId,
    title: "Test session",
    model: fakeModel.name,
  };
}

function completed(sessionId: string): AgentRunEvent {
  return {
    type: "agent.completed",
    result: result(sessionId, "completed"),
  };
}

function interrupted(sessionId: string): AgentRunEvent {
  return {
    type: "agent.completed",
    result: result(sessionId, "interrupted"),
  };
}

function result(sessionId: string, status: "completed" | "interrupted"): AgentRunResult {
  return {
    sessionId,
    status,
    stoppedReason: status === "completed" ? "final_answer" : "cancelled",
    finalAnswer: status === "completed" ? "done" : "",
    iterations: 1,
    toolCalls: 0,
  };
}

async function onceAborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    throw new Error("expected signal");
  }
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition was not met");
}

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
