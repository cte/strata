import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { runAgentLoop } from "./agentLoop.js";
import { compactSession, shouldAutoCompact } from "./compaction.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

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
  test("replaces the session message log with a single user-role summary", async () => {
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
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.role).toBe("user");
        expect(remaining[0]?.content).toContain("Summary of our earlier conversation");
        expect(remaining[0]?.content).toContain("Goal");
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

      // Add another turn after compaction.
      const m2 = new SequenceModelAdapter([
        { content: "ok2", finishReason: "stop", toolCalls: [] },
      ]);
      await runAgentLoop({
        question: "q2",
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
    expect(shouldAutoCompact({ contextWindow: 1000, latestContextTokens: 750 })).toBe(true);
    expect(shouldAutoCompact({ contextWindow: 1000, latestContextTokens: 749 })).toBe(false);
    // Default threshold 0.75; explicit threshold overrides.
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
      await runAgentLoop({
        question: "follow-up",
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
});
