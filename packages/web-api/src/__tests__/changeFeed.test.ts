import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { SessionStore } from "@strata/core/session-store";
import { SessionChangeFeed, type SessionChangeNotice } from "../changeFeed.js";
import { QueueChangeStore } from "../queueChangeStore.js";

/**
 * Fake event log exposing the two methods the feed tails, honoring
 * `afterEventId` semantics so baseline/replay behavior is exercised for real.
 */
function fakeStore(): { store: SessionStore; append: (sessionId: string) => void } {
  let maxId = 0;
  const log: Array<{ id: number; sessionId: string }> = [];
  const store = {
    latestEventId: () => maxId,
    sessionChangesSince: (after: number) => {
      const newer = log.filter((entry) => entry.id > after && entry.id <= maxId);
      return { maxEventId: maxId, sessionIds: [...new Set(newer.map((e) => e.sessionId))] };
    },
  } as unknown as SessionStore;
  return {
    store,
    append: (sessionId: string) => {
      maxId += 1;
      log.push({ id: maxId, sessionId });
    },
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read one notice with a timeout; returns "timeout" if none arrives. */
async function takeOne(
  iterable: AsyncIterable<SessionChangeNotice>,
  timeoutMs: number,
): Promise<SessionChangeNotice | "timeout"> {
  const iterator = iterable[Symbol.asyncIterator]();
  const result = await Promise.race([
    iterator.next(),
    sleep(timeoutMs).then(() => "timeout" as const),
  ]);
  void iterator.return?.();
  if (result === "timeout" || result.done === true) {
    return "timeout";
  }
  return result.value;
}

const POLL = 5;

function testRepoRoot(): string {
  return path.join(os.tmpdir(), `strata-change-feed-${randomUUID()}`);
}

describe("SessionChangeFeed", () => {
  test("first poll establishes a baseline and does not replay history", async () => {
    const { store, append } = fakeStore();
    // Pre-existing history before anyone subscribes.
    append("old-session");
    append("old-session");
    const feed = new SessionChangeFeed(async () => store, POLL);
    try {
      // No new events after subscribing → the baseline swallows history.
      const notice = await takeOne(feed.subscribe(), POLL * 8);
      expect(notice).toBe("timeout");
    } finally {
      feed.close();
    }
  });

  test("fans out a notice for post-baseline changes to every subscriber", async () => {
    const { store, append } = fakeStore();
    const feed = new SessionChangeFeed(async () => store, POLL);
    try {
      const a = feed.subscribe();
      const b = feed.subscribe();
      await sleep(POLL * 4); // let the baseline tick run first
      append("sess-a");
      append("sess-b");
      const [noticeA, noticeB] = await Promise.all([takeOne(a, POLL * 20), takeOne(b, POLL * 20)]);
      expect(noticeA).not.toBe("timeout");
      expect(noticeB).not.toBe("timeout");
      expect((noticeA as SessionChangeNotice).sessionIds.sort()).toEqual(["sess-a", "sess-b"]);
      expect((noticeB as SessionChangeNotice).sessionIds.sort()).toEqual(["sess-a", "sess-b"]);
    } finally {
      feed.close();
    }
  });

  test("fans out queue-only notices for post-baseline changes", async () => {
    const { store } = fakeStore();
    const repoRoot = testRepoRoot();
    const queueChanges = new QueueChangeStore(repoRoot);
    const feed = new SessionChangeFeed(async () => store, POLL, repoRoot);
    try {
      const subscriber = feed.subscribe();
      await sleep(POLL * 4); // let the baseline tick run first
      queueChanges.appendQueueChange({ runId: "run-1" });
      const notice = await takeOne(subscriber, POLL * 20);
      expect(notice).not.toBe("timeout");
      expect((notice as SessionChangeNotice).sessionIds).toEqual([]);
      expect((notice as SessionChangeNotice).queue).toMatchObject({
        runIds: ["run-1"],
        sessionIds: [],
      });
    } finally {
      queueChanges.close();
      feed.close();
    }
  });

  test("close ends active subscribers", async () => {
    const { store } = fakeStore();
    const feed = new SessionChangeFeed(async () => store, POLL);
    const iterator = feed.subscribe()[Symbol.asyncIterator]();
    const nextPromise = iterator.next();
    feed.close();
    const result = await nextPromise;
    expect(result.done).toBe(true);
  });
});
