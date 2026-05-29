import { describe, expect, test } from "bun:test";
import type { DailyTodoCandidate } from "@/lib/api";
import {
  candidateDefaultActionText,
  candidateDefaultOwner,
  candidateReviewStats,
  sortReviewCandidates,
} from "../actionReview";

describe("action extraction review helpers", () => {
  test("sorts ready candidates before review-needed candidates", () => {
    const review = candidate({ id: "review", status: "needs_review", confidence: 0.99 });
    const readyLow = candidate({
      id: "ready-low",
      status: "confirmed",
      owner: "theirs",
      confidence: 0.82,
    });
    const readyHigh = candidate({
      id: "ready-high",
      status: "confirmed",
      owner: "mine",
      confidence: 0.91,
    });

    expect(sortReviewCandidates([review, readyLow, readyHigh]).map((item) => item.id)).toEqual([
      "ready-high",
      "ready-low",
      "review",
    ]);
  });

  test("counts pending review states and chooses editable defaults", () => {
    const candidates = [
      candidate({ id: "a", status: "confirmed", owner: "theirs" }),
      candidate({ id: "b", status: "needs_review", owner: "unknown", actionText: "" }),
    ];

    expect(candidateReviewStats(candidates)).toEqual({
      pending: 2,
      confirmed: 1,
      needsReview: 1,
    });
    expect(candidateDefaultOwner(candidates[0] ?? candidate({ id: "fallback" }))).toBe("theirs");
    expect(candidateDefaultOwner(candidates[1] ?? candidate({ id: "fallback" }))).toBe("mine");
    expect(candidateDefaultActionText(candidates[1] ?? candidate({ id: "fallback" }))).toBe(
      "Original candidate text",
    );
  });
});

function candidate(overrides: Partial<DailyTodoCandidate> & { id: string }): DailyTodoCandidate {
  const { id, ...rest } = overrides;
  return {
    id,
    runId: "run",
    day: "2026-05-29",
    sourcePath: "wiki/raw/slack/2026-05-29-launch.md",
    sourceKind: "raw",
    sourceType: "slack",
    sourceTarget: "raw/slack/2026-05-29-launch",
    sourceLabel: "Launch thread",
    lineStart: 1,
    lineEnd: 1,
    evidenceText: "Evidence",
    candidateKind: "direct_request",
    candidateText: "Original candidate text",
    status: "confirmed",
    owner: "mine",
    actionText: "Default action text",
    confidence: 0.8,
    rationale: "Rationale",
    deterministicReasons: [],
    publishedTarget: null,
    createdAt: "2026-05-29T10:00:00.000Z",
    updatedAt: "2026-05-29T10:00:00.000Z",
    ...rest,
  };
}
