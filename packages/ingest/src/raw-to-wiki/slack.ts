import { actionCandidateLines, looksLikePersonName } from "./extraction.js";
import type { CandidateLine } from "./types.js";

export interface SlackMessage {
  speaker: string;
  text: string;
  line: number;
}

export function slackMessageTexts(body: string): string[] {
  return slackMessages(body).map((message) => message.text);
}

export function slackMessages(body: string): SlackMessage[] {
  const messages: SlackMessage[] = [];
  let speaker = "";
  let startLine = 1;
  let current: string[] = [];
  const flush = () => {
    const text = current
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^reactions?:/i.test(line))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") {
      messages.push({ speaker, text, line: startLine });
    }
    current = [];
  };
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const heading = /^##\s+\d+\.\d+\s+\|\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      speaker = heading[1]?.trim() ?? "";
      startLine = index + 2;
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    current.push(line);
  }
  flush();
  return messages;
}

export function slackActionCandidateLines(body: string, limit: number): CandidateLine[] {
  const candidates: CandidateLine[] = [];
  const seen = new Set<string>();
  for (const message of slackMessages(body)) {
    const attributedText = slackCommitmentTextWithSpeaker(message);
    for (const candidate of actionCandidateLines(attributedText, 1)) {
      if (isUnattributedSlackFirstPersonActionCandidate(candidate.text, message.speaker)) {
        continue;
      }
      if (seen.has(candidate.text.toLowerCase())) {
        continue;
      }
      seen.add(candidate.text.toLowerCase());
      candidates.push({ line: message.line, text: candidate.text });
      if (candidates.length >= limit) {
        return candidates;
      }
    }
  }
  return candidates;
}

export function slackParticipantsFromHeadings(body: string): string[] {
  return uniqueStrings(
    [...body.matchAll(/^##\s+\d+\.\d+\s+\|\s+(.+)$/gm)].map((match) => {
      return (match[1] ?? "").trim();
    }),
  );
}

function slackCommitmentTextWithSpeaker(message: SlackMessage): string {
  if (!looksLikePersonName(message.speaker)) {
    return message.text;
  }
  const text = message.text.trim();
  const explicitFirstPerson = /^(?:I will|I'll|I’ll)\s+(.+)$/i.exec(text);
  if (explicitFirstPerson) {
    return `${message.speaker} will ${explicitFirstPerson[1]?.trim() ?? ""}`.trim();
  }
  const firstPersonNeed = /^I need to\s+(.+)$/i.exec(text);
  if (firstPersonNeed) {
    return `${message.speaker} needs to ${firstPersonNeed[1]?.trim() ?? ""}`.trim();
  }
  const firstPersonGoing = /^(?:I am|I'm|I’m)\s+going to\s+(.+)$/i.exec(text);
  if (firstPersonGoing) {
    return `${message.speaker} will ${firstPersonGoing[1]?.trim() ?? ""}`.trim();
  }
  return text;
}

function isUnattributedSlackFirstPersonActionCandidate(text: string, speaker: string): boolean {
  if (looksLikePersonName(speaker)) {
    return false;
  }
  return /(?:^|[.!?,;:]\s*)(?:ok\s+)?(?:i|i'll|i’ll|i am|i'm|i’m)\s+(?:will|should|need to|must|am going to|going to)\b/i.test(
    text,
  );
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result = [];
  for (const item of items) {
    const normalized = item.trim().replace(/\s+/g, " ");
    if (normalized === "" || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}
