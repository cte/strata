import type { CandidateLine } from "./types.js";

const ACTION_PATTERNS = [
  /^\s*[-*]\s+\[[ x]\]\s+/i,
  /\b(action item|todo|follow[- ]?up|next step|owner:|due:)\b/i,
  /\b(I|we|they|[A-Z][a-z]+)\s+(will|should|need to|needs to|must)\b/,
];

const DECISION_PATTERNS = [
  /\b(decision|decided|agreed|approved|greenlit|settled)\b/i,
  /\b(we will|we're going to|going forward|the plan is)\b/i,
];

export function candidateLines(body: string, patterns: RegExp[], limit: number): CandidateLine[] {
  return collectCandidateLines(body, patterns, limit);
}

export function actionCandidateLines(body: string, limit: number): CandidateLine[] {
  return collectCandidateLines(
    body,
    ACTION_PATTERNS,
    limit,
    isExplicitActionCandidate,
    cleanActionCandidateText,
  );
}

export function decisionCandidateLines(body: string, limit: number): CandidateLine[] {
  return collectCandidateLines(
    body,
    DECISION_PATTERNS,
    limit,
    isExplicitDecisionCandidate,
    cleanDecisionCandidateText,
  );
}

export function speakerCandidates(body: string): string[] {
  return body.split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Z][A-Za-z .'-]{1,60}):\s+\S/.exec(line.trim());
    const name = match?.[1]?.trim() ?? "";
    return looksLikePersonName(name) ? [name] : [];
  });
}

export function looksLikePersonName(value: string): boolean {
  if (value === "" || value.includes("@")) {
    return false;
  }
  if (/^(speaker|microphone|summary|transcript|action|decision|next step)$/i.test(value)) {
    return false;
  }
  return value.split(/\s+/).every((part) => /^[A-Z][A-Za-z.'-]*$/.test(part));
}

export function cleanCandidateText(line: string): string {
  return stripSpeakerPrefix(line)
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectCandidateLines(
  body: string,
  patterns: RegExp[],
  limit: number,
  allowCandidate?: (text: string, rawLine: string) => boolean,
  normalizeCandidate?: (text: string) => string,
): CandidateLine[] {
  const candidates: CandidateLine[] = [];
  const seen = new Set<string>();
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (!patterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    const normalized = normalizeCandidate?.(cleanCandidateText(line)) ?? cleanCandidateText(line);
    if (normalized === "") {
      continue;
    }
    if (allowCandidate && !allowCandidate(normalized, rawLine)) {
      continue;
    }
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    candidates.push({ line: index + 1, text: normalized });
    if (candidates.length >= limit) {
      break;
    }
  }
  return candidates;
}

function cleanActionCandidateText(text: string): string {
  return text
    .replace(/^(?:action item|todo|follow[- ]?up|next step)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanDecisionCandidateText(text: string): string {
  return text
    .replace(/^(?:decision|outcome)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplicitActionCandidate(text: string, rawLine: string): boolean {
  if (isOpenQuestionLike(text) || /\b(should we|need to decide|decision needed)\b/i.test(text)) {
    return false;
  }
  if (/^(?:ok|okay|sure|thanks|thank you)\s+(?:will|should|need to|needs to|must)\b/i.test(text)) {
    return false;
  }
  if (/^\s*[-*]\s+\[[ x]\]\s+/i.test(rawLine)) {
    return true;
  }
  if (/\b(?:owner|assignee)\s*:\s*\S+/i.test(text)) {
    return true;
  }
  if (/\bdue\s*:\s*\S+/i.test(text)) {
    return true;
  }
  return /^(?:I|I'll|I’ll|They|[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s+(?:will|must|needs? to|owns?|is responsible for|is going to)\b/i.test(
    text,
  );
}

function isExplicitDecisionCandidate(text: string, rawLine: string): boolean {
  if (
    isOpenQuestionLike(text) ||
    /\b(?:need to decide|decision needed|still deciding|not decided|undecided|pending|tentative)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (/^\s*[-*]?\s*(?:decision|outcome)\s*:/i.test(rawLine)) {
    return true;
  }
  return (
    /\b(?:we|team|leadership|product|engineering)\s+(?:agreed|decided|approved|greenlit|settled)\s+(?:to|that|on)\b/i.test(
      text,
    ) ||
    /\b(?:agreed|decided|approved|greenlit|settled)\s+(?:to|that|on)\b/i.test(text) ||
    /\bgoing forward\b.*\b(?:we|the team)\s+(?:will|are going to|use|keep|ship|adopt)\b/i.test(
      text,
    ) ||
    /\bthe plan is\s+(?:to|that)\b/i.test(text)
  );
}

function isOpenQuestionLike(text: string): boolean {
  return (
    /\?$/.test(text.trim()) || /^(?:open question|question|unclear|unknown|todo\?)\s*:/i.test(text)
  );
}

function stripSpeakerPrefix(line: string): string {
  const match = /^([A-Z][A-Za-z .'-]{1,60}):\s+(.+)$/.exec(line);
  return match && looksLikePersonName(match[1] ?? "") ? (match[2] ?? line) : line;
}
