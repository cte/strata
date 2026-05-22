import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AgentRunConfig,
  type AgentRunEvent,
  type AgentRunResult,
  type ModelAdapter,
} from "@strata/agent";
import { SessionStore } from "@strata/core/session-store";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createWebApiHandler } from "./server.js";
import type { AppRouter } from "./trpc.js";

describe("web api", () => {
  test("lists connector setup state without exposing secrets", async () => {
    const handler = createWebApiHandler({
      repoRoot: "/tmp/strata",
      env: { NOTION_TOKEN: "secret_should_not_render" },
    });

    const response = await handler(new Request("http://127.0.0.1/api/connectors"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("notion");
    expect(text).toContain("Token configured");
    expect(text).not.toContain("secret_should_not_render");
  });

  test("dry-runs Notion through a trace-backed session", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: { NOTION_TOKEN: "secret" },
        fetchImpl: fakeNotionFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);

      try {
        const body = await client.connectors.notion.dryRun.mutate({ pageId: "page_123" });
        expect(body.connector).toBe("notion");
        expect(body.rawPath).toBe("wiki/raw/notion/2026-05-04-strategy-doc.md");
        expect(body.dryRun).toBe(true);
        expect(typeof body.sessionId).toBe("string");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports browser-safe chat model status", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {
          OPENAI_API_KEY: "secret_should_not_render",
          OPENAI_MODEL: "gpt-test",
        },
      });
      const { client, close } = createTestClient(handler);

      try {
        const status = await client.chat.models.status.query();
        expect(status).toEqual({
          provider: "openai-compatible",
          model: "gpt-test",
          codexLoggedIn: false,
          apiKeyConfigured: true,
        });
        expect(JSON.stringify(status)).not.toContain("secret_should_not_render");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists repo files for chat composer autocomplete", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      await mkdir(path.join(repoRoot, "packages/core/src"), { recursive: true });
      await mkdir(path.join(repoRoot, "docs"), { recursive: true });
      await writeFile(path.join(repoRoot, "packages/core/src/repoFiles.ts"), "export {};\n");
      await writeFile(path.join(repoRoot, "docs/web-chat-plan.md"), "# Web chat\n");

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const files = await client.chat.files.list.query({ query: "src", limit: 10 });
        expect(files.entries).toContainEqual({
          path: "packages/core/src/repoFiles.ts",
          isDirectory: false,
        });
        expect(files.entries).toContainEqual({
          path: "packages/core/src",
          isDirectory: true,
        });

        const limited = await client.chat.files.list.query({ query: "", limit: 1 });
        expect(limited.entries).toHaveLength(1);
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists OpenAI-compatible models for chat composer model controls", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    const originalFetch = globalThis.fetch;
    const seenRequests: Request[] = [];
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request =
          args[0] instanceof Request ? args[0] : new Request(String(args[0]), args[1]);
        if (new URL(request.url).hostname !== "models.example") {
          return originalFetch(...args);
        }
        seenRequests.push(request);
        return Response.json({
          data: [
            { id: "text-embedding-3-large", owned_by: "openai" },
            { id: "gpt-4o-mini", owned_by: "openai" },
            { id: "gpt-5.5", owned_by: "openai" },
            { id: "gpt-4o-mini", owned_by: "duplicate" },
          ],
        });
      },
      { preconnect: fetch.preconnect },
    );
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {
          OPENAI_API_KEY: "secret_should_not_render",
          OPENAI_BASE_URL: "https://models.example/v1",
        },
      });
      const { client, close } = createTestClient(handler);
      try {
        const body = await client.chat.models.list.query({ provider: "openai-compatible" });
        expect(body.models).toEqual([
          { id: "gpt-4o-mini", description: "openai" },
          { id: "gpt-5.5", description: "openai" },
        ]);
        expect(seenRequests).toHaveLength(1);
        expect(seenRequests[0]?.url).toBe("https://models.example/v1/models");
        expect(seenRequests[0]?.headers.get("authorization")).toBe(
          "Bearer secret_should_not_render",
        );
        expect(JSON.stringify(body)).not.toContain("secret_should_not_render");
      } finally {
        close();
      }
    } finally {
      globalThis.fetch = originalFetch;
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists, loads, and searches chat/query sessions through tRPC metadata procedures", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const store = await SessionStore.open(repoRoot);
      let querySessionId = "";
      let chatSessionId = "";
      let ingestSessionId = "";
      try {
        const querySession = await store.createSession({
          kind: "query",
          title: "Launch plan",
          model: "fake:model",
        });
        querySessionId = querySession.id;
        await store.appendMessage({
          sessionId: querySession.id,
          role: "user",
          content: "Find the launch decision",
        });
        await store.appendMessage({
          sessionId: querySession.id,
          role: "assistant",
          content: "The launch decision is ready.",
          toolCalls: [{ id: "call-1", name: "wiki.search", argumentsText: "{}" }],
        });
        await store.endSession(querySession.id, "completed");

        const chatSession = await store.createSession({
          kind: "chat",
          title: "Browser chat",
          model: "fake:model",
        });
        chatSessionId = chatSession.id;
        await store.appendMessage({
          sessionId: chatSession.id,
          role: "user",
          content: "Hello from the browser",
          attachments: [{ kind: "image", mimeType: "image/png", dataBase64: "abc" }],
        });
        await store.endSession(chatSession.id, "interrupted");

        const ingestSession = await store.createSession({ kind: "ingest", title: "Notion pull" });
        ingestSessionId = ingestSession.id;
        await store.appendMessage({
          sessionId: ingestSession.id,
          role: "user",
          content: "Ingest only",
        });
        await store.endSession(ingestSession.id, "completed");
      } finally {
        store.close();
      }

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const listed = await client.chat.sessions.list.query({ limit: 10 });
        const listedIds = listed.sessions.map((session) => session.id);
        expect(listedIds).toContain(querySessionId);
        expect(listedIds).toContain(chatSessionId);
        expect(listedIds).not.toContain(ingestSessionId);

        const loaded = await client.chat.sessions.get.query({ sessionId: querySessionId });
        expect(loaded?.session).toMatchObject({
          id: querySessionId,
          kind: "query",
          title: "Launch plan",
          status: "completed",
          model: "fake:model",
        });
        expect(loaded?.messages).toHaveLength(2);
        expect(loaded?.messages[1]).toMatchObject({
          role: "assistant",
          content: "The launch decision is ready.",
          toolCalls: [{ id: "call-1", name: "wiki.search", argumentsText: "{}" }],
        });

        await expect(
          client.chat.sessions.get.query({ sessionId: ingestSessionId }),
        ).resolves.toBeNull();

        const search = await client.chat.sessions.search.query({ query: "launch decision" });
        expect(search.sessions.map((session) => session.id)).toContain(querySessionId);
        expect(search.sessions.map((session) => session.id)).not.toContain(ingestSessionId);

        const forked = await client.chat.sessions.fork.mutate({ sessionId: querySessionId });
        expect(forked.session.id).not.toBe(querySessionId);
        expect(forked.session).toMatchObject({
          kind: "query",
          title: "Fork of Launch plan",
          status: "running",
          model: "fake:model",
        });
        expect(forked.messages).toHaveLength(2);
        expect(forked.messages[0]).toMatchObject({
          role: "user",
          content: "Find the launch decision",
        });
        expect(forked.messages[1]).toMatchObject({
          role: "assistant",
          content: "The launch decision is ready.",
        });

        const forkedLoad = await client.chat.sessions.get.query({ sessionId: forked.session.id });
        expect(forkedLoad?.messages).toHaveLength(2);
        await expect(
          client.chat.sessions.fork.mutate({ sessionId: ingestSessionId }),
        ).rejects.toThrow("Session not found");

        const deleted = await client.chat.sessions.delete.mutate({ sessionId: chatSessionId });
        expect(deleted).toMatchObject({
          id: chatSessionId,
          title: "Browser chat",
        });
        await expect(
          client.chat.sessions.get.query({ sessionId: chatSessionId }),
        ).resolves.toBeNull();
        await expect(
          access(path.join(repoRoot, ".strata", "traces", `${chatSessionId}.jsonl`)),
        ).rejects.toThrow();
        await expect(
          client.chat.sessions.delete.mutate({ sessionId: ingestSessionId }),
        ).rejects.toThrow("Session not found");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("streams chat run events as server-sent events and cleans up after completion", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        expect(config.question).toBe("hello");
        yield sessionStarted("session-1");
        yield { type: "assistant.delta", iteration: 1, contentDelta: "Hel" };
        yield { type: "assistant.delta", iteration: 1, contentDelta: "lo" };
        yield completed("session-1");
      },
    });

    const response = await handler(chatRunRequest({ message: "hello" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const events = parseSse(text);
    expect(events.map((event) => event.event)).toEqual([
      "run.started",
      "session.started",
      "assistant.delta",
      "assistant.delta",
      "agent.completed",
    ]);
    expect(events[0]?.data).toEqual({ type: "run.started", runId: "run-1" });
    expect(events[1]?.data).toMatchObject({ type: "session.started", sessionId: "session-1" });
    expect(events[4]?.data).toMatchObject({
      type: "agent.completed",
      result: { sessionId: "session-1", status: "completed" },
    });

    const cancelAfterCompletion = await handler(cancelRequest("run-1"));
    expect(cancelAfterCompletion.status).toBe(404);
  });

  test("replays durable chat run events and exposes final run status", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        yield { type: "assistant.delta", iteration: 1, contentDelta: "Stored" };
        yield completed("session-1");
      },
    });
    const { client, close } = createTestClient(handler);

    try {
      const response = await handler(chatRunRequest({ message: "store events" }));
      expect(response.status).toBe(200);
      const originalEvents = parseSse(await response.text());
      expect(originalEvents.map((event) => event.id)).toEqual([1, 2, 3, 4]);

      const replay = await handler(chatEventsRequest("run-1", 2));
      expect(replay.status).toBe(200);
      expect(parseSse(await replay.text())).toMatchObject([
        { id: 3, event: "assistant.delta", data: { contentDelta: "Stored" } },
        { id: 4, event: "agent.completed", data: { result: { status: "completed" } } },
      ]);

      await expect(client.chat.runs.get.query({ runId: "run-1" })).resolves.toEqual({
        run: expect.objectContaining({
          runId: "run-1",
          status: "completed",
          cancelled: false,
          sessionId: "session-1",
          lastEventId: 4,
          stoppedReason: "final_answer",
        }),
      });
    } finally {
      close();
    }
  });

  test("sends SSE heartbeat comments while waiting for agent events", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      chatStreamHeartbeatMs: 5,
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        await sleep(30);
        yield completed("session-1");
      },
    });

    const response = await handler(chatRunRequest({ message: "wait" }));
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain(": keepalive\n\n");
    expect(parseSse(text).map((event) => event.event)).toEqual([
      "run.started",
      "session.started",
      "agent.completed",
    ]);
  });

  test("returns a conflict response when a continued chat session is already running", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: sequenceIds("run-1", "run-2"),
      runAgentLoopEvents: async function* (config) {
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
        yield interrupted("session-1");
      },
    });

    const first = await handler(
      chatRunRequest({ message: "first", continueSessionId: "session-1" }),
    );
    expect(first.status).toBe(200);

    const second = await handler(
      chatRunRequest({ message: "second", continueSessionId: "session-1" }),
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: {
        code: "chat_run_conflict",
        runId: "run-1",
        sessionId: "session-1",
      },
    });

    const cancelled = await handler(cancelRequest("run-1"));
    expect(cancelled.status).toBe(200);
    await first.text();
  });

  test("cancels an active chat run through the cancel endpoint", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
        yield interrupted("session-1");
      },
    });

    const response = await handler(chatRunRequest({ message: "cancel me" }));
    expect(response.status).toBe(200);

    const cancelled = await handler(cancelRequest("run-1"));
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({ cancelled: true, runId: "run-1" });

    const text = await response.text();
    const events = parseSse(text);
    expect(events.at(-1)?.data).toMatchObject({
      type: "agent.completed",
      result: { sessionId: "session-1", status: "interrupted", stoppedReason: "cancelled" },
    });

    const missing = await handler(cancelRequest("run-1"));
    expect(missing.status).toBe(404);
  });

  test("keeps the chat run alive when the stream reader disconnects", async () => {
    let seenSignal: AbortSignal | undefined;
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        seenSignal = config.signal;
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
      },
    });
    const { client, close } = createTestClient(handler);

    try {
      const response = await handler(chatRunRequest({ message: "disconnect" }));
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await reader?.read();
      await reader?.cancel();

      expect(seenSignal?.aborted).toBe(false);
      await expect(client.chat.runs.active.query()).resolves.toEqual({
        runs: [
          expect.objectContaining({
            runId: "run-1",
            cancelled: false,
            sessionId: "session-1",
          }),
        ],
      });
      const cancelled = await handler(cancelRequest("run-1"));
      expect(cancelled.status).toBe(200);
      expect(seenSignal?.aborted).toBe(true);
    } finally {
      close();
    }
  });

  test("validates chat run requests", async () => {
    const handler = createWebApiHandler(chatTestOptions());
    const response = await handler(chatRunRequest({ message: "hi", provider: "other" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "provider must be openai-codex or openai-compatible.",
      },
    });
  });
});

function createTestClient(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler,
  });
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${server.hostname}:${server.port}/api/trpc`,
      }),
    ],
  });
  return {
    client,
    close: () => server.stop(true),
  };
}

function fakeNotionFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      if (url.pathname === "/v1/pages/page_123") {
        return Response.json({
          id: "page_123",
          url: "https://notion.so/page_123",
          last_edited_time: "2026-05-04T12:00:00.000Z",
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Strategy Doc" }],
            },
          },
        });
      }
      if (url.pathname === "/v1/blocks/page_123/children") {
        return Response.json({
          results: [
            {
              id: "block_1",
              type: "paragraph",
              has_children: false,
              paragraph: { rich_text: [{ plain_text: "API preview." }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}

const fakeModel: ModelAdapter = {
  name: "fake:model",
  complete: async () => ({
    content: "unused",
    finishReason: "stop",
    toolCalls: [],
  }),
};

function chatTestOptions() {
  return {
    repoRoot: path.join(os.tmpdir(), `strata-chat-${randomUUID()}`),
    env: { STRATA_API_KEY: "sk-test", STRATA_MODEL: "gpt-test" },
    createModelAdapter: async () => fakeModel,
  };
}

function chatRunRequest(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1/api/chat/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cancelRequest(runId: string): Request {
  return new Request(`http://127.0.0.1/api/chat/runs/${runId}/cancel`, {
    method: "POST",
  });
}

function chatEventsRequest(runId: string, afterEventId: number): Request {
  return new Request(`http://127.0.0.1/api/chat/runs/${runId}/events?after=${afterEventId}`);
}

function parseSse(text: string): { id: number | null; event: string; data: unknown }[] {
  return text
    .trim()
    .split("\n\n")
    .filter((frame) => frame.trim() !== "")
    .flatMap((frame) => {
      const idLine = frame.split("\n").find((line) => line.startsWith("id: "));
      const eventLine = frame.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (eventLine === undefined && dataLine === undefined) {
        return [];
      }
      if (eventLine === undefined || dataLine === undefined) {
        throw new Error(`Invalid SSE frame: ${frame}`);
      }
      return [
        {
          id: idLine === undefined ? null : Number.parseInt(idLine.slice("id: ".length), 10),
          event: eventLine.slice("event: ".length),
          data: JSON.parse(dataLine.slice("data: ".length)),
        },
      ];
    });
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
