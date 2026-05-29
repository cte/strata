import type { DailyTodoCandidate } from "@/lib/api";

export type EditableActionOwner = "mine" | "theirs";

export function candidateReviewStats(candidates: DailyTodoCandidate[]): {
  pending: number;
  confirmed: number;
  needsReview: number;
} {
  let confirmed = 0;
  let needsReview = 0;
  for (const candidate of candidates) {
    if (candidate.status === "confirmed") {
      confirmed += 1;
    } else if (candidate.status === "needs_review") {
      needsReview += 1;
    }
  }
  return { pending: candidates.length, confirmed, needsReview };
}

export function sortReviewCandidates(candidates: DailyTodoCandidate[]): DailyTodoCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftRank = candidateStatusRank(left);
    const rightRank = candidateStatusRank(right);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }
    if (left.sourcePath !== right.sourcePath) {
      return left.sourcePath.localeCompare(right.sourcePath);
    }
    return left.lineStart - right.lineStart;
  });
}

export function candidateDefaultOwner(candidate: DailyTodoCandidate): EditableActionOwner {
  return candidate.owner === "theirs" ? "theirs" : "mine";
}

export function candidateDefaultActionText(candidate: DailyTodoCandidate): string {
  const actionText = candidate.actionText.trim();
  return actionText.length > 0 ? actionText : candidate.candidateText;
}

function candidateStatusRank(candidate: DailyTodoCandidate): number {
  if (candidate.status === "confirmed" && candidate.owner !== "unknown") {
    return 0;
  }
  if (candidate.status === "needs_review") {
    return 1;
  }
  return 2;
}
