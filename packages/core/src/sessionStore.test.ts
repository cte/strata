import { describe, expect, test } from "bun:test";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "./sessionStore.js";
import type { TokenUsage } from "./types.js";

async function withTempStore<T>(fn: (store: SessionStore) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-session-store-"));
  const store = await SessionStore.open(repoRoot);
  try {
    return await fn(store);
  } finally {
    store.close();
    await rm(repoRoot, { recursive: true, force: true });
  }
}

describe("SessionStore.appendMessage with usage", () => {
  test("persists per-turn usage on assistant messages and surfaces it on read", async () => {
    await withTempStore(async (store) => {
      const session = await store.createSession({ kind: "chat", title: "Usage round-trip" });
      const usage: TokenUsage = {
        input: 1000,
        output: 250,
        cacheRead: 100,
        cacheWrite: 50,
        total: 1400,
        cost: 0.0123,
      };
      await store.appendMessage({
        sessionId: session.id,
        role: "assistant",
        content: "hi",
        usage,
      });
      const messages = store.listMessages(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.usage).toEqual(usage);
    });
  });

  test("returns null usage for messages that pre-date the column", async () => {
    await withTempStore(async (store) => {
      const session = await store.createSession({ kind: "chat", title: "No usage" });
      await store.appendMessage({
        sessionId: session.id,
        role: "user",
        content: "what's up?",
      });
      const messages = store.listMessages(session.id);
      expect(messages[0]?.usage).toBeNull();
    });
  });
});

describe("SessionStore.backfillAssistantUsage", () => {
  test("populates usage on assistant messages from matching model.response events", async () => {
    await withTempStore(async (store) => {
      const session = await store.createSession({ kind: "chat", title: "Backfill" });
      // Simulate the agent loop's two writes for one assistant turn: first the
      // model.response event with raw provider-shaped usage, then the assistant
      // message without usage attached (the pre-Phase-A behavior).
      await store.appendEvent(session.id, "model.response", {
        iteration: 1,
        content: "answer",
        toolCalls: [],
        usage: {
          prompt_tokens: 800,
          completion_tokens: 200,
          total_tokens: 1000,
        },
      });
      await store.appendMessage({
        sessionId: session.id,
        role: "assistant",
        content: "answer",
      });
      // Verify the precondition: the assistant message has no usage yet.
      expect(store.listMessages(session.id)[0]?.usage).toBeNull();

      const outcome = store.backfillAssistantUsage();

      expect(outcome.sessionsScanned).toBeGreaterThanOrEqual(1);
      expect(outcome.messagesUpdated).toBe(1);
      const restored = store.listMessages(session.id)[0]?.usage;
      expect(restored).toEqual({
        input: 800,
        output: 200,
        cacheRead: 0,
        cacheWrite: 0,
        total: 1000,
        cost: 0,
      });
    });
  });

  test("leaves messages alone when usage is already present", async () => {
    await withTempStore(async (store) => {
      const session = await store.createSession({ kind: "chat", title: "Idempotent" });
      const usage: TokenUsage = {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        total: 150,
        cost: 0,
      };
      await store.appendEvent(session.id, "model.response", {
        iteration: 1,
        content: "answer",
        toolCalls: [],
        usage: {
          prompt_tokens: 999,
          completion_tokens: 999,
          total_tokens: 1998,
        },
      });
      await store.appendMessage({
        sessionId: session.id,
        role: "assistant",
        content: "answer",
        usage,
      });

      const outcome = store.backfillAssistantUsage();

      expect(outcome.messagesUpdated).toBe(0);
      expect(store.listMessages(session.id)[0]?.usage).toEqual(usage);
    });
  });
});

describe("SessionStore.deleteSession", () => {
  test("deletes the session row, cascades messages/events, and removes the trace file", async () => {
    await withTempStore(async (store) => {
      const session = await store.createSession({ kind: "chat", title: "Delete me" });
      await store.appendMessage({
        sessionId: session.id,
        role: "user",
        content: "remove this",
      });
      const tracePath = path.join(store.paths.traceDir, `${session.id}.jsonl`);
      await access(tracePath);

      const result = await store.deleteSession(session.id);

      expect(result.id).toBe(session.id);
      expect(store.getSession(session.id)).toBeUndefined();
      expect(store.listMessages(session.id)).toEqual([]);
      await expect(access(tracePath)).rejects.toThrow();
    });
  });

  test("finds sessions by id prefix for CLI ergonomics", async () => {
    await withTempStore(async (store) => {
      const session = await store.createSession({ kind: "query", title: "Prefix target" });

      expect(store.findSessionsByIdPrefix(session.id.slice(0, 12))).toEqual([session]);
      expect(store.findSessionsByIdPrefix("does-not-exist")).toEqual([]);
    });
  });
});

describe("SessionStore.sessionChangesSince", () => {
  test("reports distinct changed sessions and advances the high-water mark", async () => {
    await withTempStore(async (store) => {
      // createSession already appends a `session.started` event.
      const a = await store.createSession({ kind: "chat", title: "A" });
      const b = await store.createSession({ kind: "chat", title: "B" });
      const baseline = store.latestEventId();
      expect(baseline).toBeGreaterThan(0);

      // No new events yet → no changes, watermark unchanged.
      const quiet = store.sessionChangesSince(baseline);
      expect(quiet.sessionIds).toEqual([]);
      expect(quiet.maxEventId).toBe(baseline);

      await store.appendEvent(a.id, "model.response", { iteration: 1 });
      await store.appendEvent(a.id, "tool.call", { iteration: 1 });
      await store.appendEvent(b.id, "model.response", { iteration: 1 });

      const changed = store.sessionChangesSince(baseline);
      expect(changed.maxEventId).toBe(store.latestEventId());
      expect(changed.maxEventId).toBeGreaterThan(baseline);
      // Distinct sessions, not one entry per event.
      expect([...changed.sessionIds].sort()).toEqual([a.id, b.id].sort());

      // Polling again from the new watermark sees nothing.
      expect(store.sessionChangesSince(changed.maxEventId).sessionIds).toEqual([]);
    });
  });

  test("latestEventId is 0 for a store with no events", async () => {
    await withTempStore(async (store) => {
      expect(store.latestEventId()).toBe(0);
      expect(store.sessionChangesSince(0)).toEqual({ maxEventId: 0, sessionIds: [] });
    });
  });
});
