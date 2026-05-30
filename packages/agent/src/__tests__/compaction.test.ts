import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { runAgentLoop } from "../agentLoop.js";
import {
  buildCompactedMessageRecords,
  compactSession,
  latestCompactionRecord,
  shouldAutoCompact,
} from "../compaction.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "../types.js";

class SequenceModelAdapter implements ModelAdapter {
  readonly name = "sequence-test";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const { onAssistantDelta: _omit, ...rest } = request;
    this.requests.push(structuredClone(rest));
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No fake model response configured");
    }
    return response;
  }
}

describe("compactSession", () => {
  test("appends a compaction checkpoint without deleting the message log", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-compact-"));
    try {
      const initial = new SequenceModelAdapter([
        { content: "Strata here.", finishReason: "stop", toolCalls: [] },
      ]);
      const first = await runAgentLoop({
        question: "hi",
        model: initial,
        repoRoot,
      });
      expect(first.status).toBe("completed");

      const summarizer = new SequenceModelAdapter([
        {
          content: "## Goal\n[user wanted greeting]\n## Progress\n### Done\n- greeted",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      const result = await compactSession({
        sessionId: first.sessionId,
        model: summarizer,
        repoRoot,
      });

      expect(result.messagesSummarized).toBeGreaterThan(0);
      expect(result.summary).toContain("Goal");
      // The model saw a system + user prompt with our conversation tags.
      expect(summarizer.requests).toHaveLength(1);
      expect(summarizer.requests[0]?.messages[1]?.content).toContain("<conversation>");

      const store = await SessionStore.open(repoRoot);
      try {
        const remaining = store.listMessages(first.sessionId);
        expect(remaining.filter((message) => message.role === "system")).not.toHaveLength(0);
        expect(
          remaining.filter((message) => message.role !== "system").map((message) => message.role),
        ).toEqual(["user", "assistant"]);
        expect(remaining.find((message) => message.role === "user")?.content).toBe("hi");
        expect(remaining.find((message) => message.role === "assistant")?.content).toBe(
          "Strata here.",
        );

        const checkpoint = latestCompactionRecord(store, first.sessionId);
        expect(checkpoint?.summary).toContain("Goal");
        expect(checkpoint?.firstKeptMessageId).toBeGreaterThan(0);

        const compacted = buildCompactedMessageRecords(store, first.sessionId);
        expect(compacted).toHaveLength(1);
        expect(compacted[0]?.role).toBe("user");
        expect(compacted[0]?.content).toContain("Summary of our earlier conversation");
        expect(compacted[0]?.content).toContain("Goal");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("a second compaction uses the update prompt and merges", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-compact-"));
    try {
      // First turn
      const m1 = new SequenceModelAdapter([{ content: "hi", finishReason: "stop", toolCalls: [] }]);
      const first = await runAgentLoop({ question: "q1", model: m1, repoRoot });

      // First compaction (initial)
      const initialSummarizer = new SequenceModelAdapter([
        { content: "## Goal\ngreet", finishReason: "stop", toolCalls: [] },
      ]);
      const r1 = await compactSession({
        sessionId: first.sessionId,
        model: initialSummarizer,
        repoRoot,
      });
      expect(r1.incremental).toBe(false);
      // The initial-compact request must NOT contain <previous-summary> tags.
      expect(initialSummarizer.requests[0]?.messages[1]?.content).not.toContain(
        "<previous-summary>",
      );

      // Add another user-initiated turn after compaction, then continue from it.
      const store = await SessionStore.open(repoRoot);
      try {
        await store.recordUserMessage({ sessionId: first.sessionId, content: "q2" });
      } finally {
        store.close();
      }
      const m2 = new SequenceModelAdapter([
        { content: "ok2", finishReason: "stop", toolCalls: [] },
      ]);
      await runAgentLoop({
        question: "",
        model: m2,
        repoRoot,
        continueSessionId: first.sessionId,
      });

      // Second compaction (incremental).
      const updateSummarizer = new SequenceModelAdapter([
        { content: "## Goal\ngreet (updated)", finishReason: "stop", toolCalls: [] },
      ]);
      const r2 = await compactSession({
        sessionId: first.sessionId,
        model: updateSummarizer,
        repoRoot,
      });
      expect(r2.incremental).toBe(true);
      const updatePrompt = String(updateSummarizer.requests[0]?.messages[1]?.content ?? "");
      expect(updatePrompt).toContain("<previous-summary>");
      expect(updatePrompt).toContain("greet"); // includes the prior summary text
      expect(updatePrompt).toContain("q2");
      expect(updatePrompt).toContain("ok2");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("compacting twice with no new turns errors clearly", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-compact-"));
    try {
      const m = new SequenceModelAdapter([{ content: "x", finishReason: "stop", toolCalls: [] }]);
      const session = await runAgentLoop({ question: "q", model: m, repoRoot });
      const sum = new SequenceModelAdapter([
        { content: "## Goal", finishReason: "stop", toolCalls: [] },
      ]);
      await compactSession({ sessionId: session.sessionId, model: sum, repoRoot });
      await expect(
        compactSession({ sessionId: session.sessionId, model: sum, repoRoot }),
      ).rejects.toThrow(/nothing new/);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("shouldAutoCompact crosses the threshold", () => {
    expect(shouldAutoCompact({ contextWindow: 100_000, latestContextTokens: 83_617 })).toBe(true);
    expect(shouldAutoCompact({ contextWindow: 100_000, latestContextTokens: 83_616 })).toBe(false);
    expect(
      shouldAutoCompact({ contextWindow: 1000, latestContextTokens: 900, reserveTokens: 100 }),
    ).toBe(false);
    expect(
      shouldAutoCompact({ contextWindow: 1000, latestContextTokens: 901, reserveTokens: 100 }),
    ).toBe(true);
    // Explicit threshold remains available as a ratio override.
    expect(shouldAutoCompact({ contextWindow: 100, latestContextTokens: 50, threshold: 0.4 })).toBe(
      true,
    );
    expect(shouldAutoCompact({ contextWindow: 100, latestContextTokens: undefined })).toBe(false);
    expect(shouldAutoCompact({ contextWindow: undefined, latestContextTokens: 9999 })).toBe(false);
  });

  test("a continuation after compaction sees the summary as prior context", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-compact-"));
    try {
      const initial = new SequenceModelAdapter([
        { content: "Reply 1", finishReason: "stop", toolCalls: [] },
      ]);
      const first = await runAgentLoop({ question: "first", model: initial, repoRoot });

      const summarizer = new SequenceModelAdapter([
        { content: "## Goal\nuser asked first\n", finishReason: "stop", toolCalls: [] },
      ]);
      await compactSession({ sessionId: first.sessionId, model: summarizer, repoRoot });

      const continuation = new SequenceModelAdapter([
        { content: "Reply 2", finishReason: "stop", toolCalls: [] },
      ]);
      const store = await SessionStore.open(repoRoot);
      try {
        await store.recordUserMessage({ sessionId: first.sessionId, content: "follow-up" });
      } finally {
        store.close();
      }
      await runAgentLoop({
        question: "",
        model: continuation,
        repoRoot,
        continueSessionId: first.sessionId,
      });

      const seeded = continuation.requests[0]?.messages ?? [];
      const nonSystem = seeded.filter((m) => m.role !== "system");
      expect(nonSystem.map((m) => m.role)).toEqual(["user", "user"]);
      expect(nonSystem[0]?.content).toContain("Summary of our earlier conversation");
      expect(nonSystem[1]?.content).toBe("follow-up");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("summarizes a split turn prefix while keeping the suffix", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-compact-split-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "assistant suffix ".repeat(200),
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      const first = await runAgentLoop({
        question: "user prefix ".repeat(200),
        model,
        repoRoot,
      });

      const summarizer = new SequenceModelAdapter([
        {
          content: "original request and early progress",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      const result = await compactSession({
        sessionId: first.sessionId,
        model: summarizer,
        repoRoot,
        keepRecentTokens: 1,
      });

      expect(result.isSplitTurn).toBe(true);
      expect(result.turnPrefixMessagesSummarized).toBe(1);
      expect(result.summary).toContain("Turn Context (split turn)");
      expect(summarizer.requests).toHaveLength(1);
      expect(summarizer.requests[0]?.messages[1]?.content).toContain("PREFIX of a turn");

      const store = await SessionStore.open(repoRoot);
      try {
        const compacted = buildCompactedMessageRecords(store, first.sessionId);
        expect(compacted.map((message) => message.role)).toEqual(["user", "assistant"]);
        expect(compacted[0]?.content).toContain("Turn Context (split turn)");
        expect(compacted[1]?.content).toContain("assistant suffix");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
