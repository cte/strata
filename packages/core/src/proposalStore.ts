import path from "node:path";
import { nowIso } from "./events.js";
import { readTextFileOrUndefined, writeTextFile } from "./fileStore.js";
import { getStrataPaths } from "./paths.js";
import type { JsonObject } from "./types.js";

export type LearningProposalKind = "memory" | "skill" | "schema" | "wiki";

export interface LearningProposalInput {
  kind: LearningProposalKind;
  sessionId: string;
  title: string;
  reason: string;
  evidence: string[];
  proposedChange: string;
  risk: string;
  applyCommand?: string;
}

export interface LearningProposalRecord extends JsonObject {
  kind: LearningProposalKind;
  sessionId: string;
  title: string;
  path: string;
  created: string;
  status: "pending";
}

export async function writeLearningProposal(
  repoRoot: string,
  input: LearningProposalInput,
): Promise<LearningProposalRecord> {
  const file = learningProposalPath(repoRoot, input.sessionId, input.kind, input.title);
  const existingCreated = await readExistingCreated(file);
  const created = existingCreated ?? nowIso();
  await writeTextFile(file, formatLearningProposal(input, created));
  return {
    kind: input.kind,
    sessionId: input.sessionId,
    title: input.title,
    path: path.relative(repoRoot, file),
    created,
    status: "pending",
  };
}

export function learningProposalPath(
  repoRoot: string,
  sessionId: string,
  kind: LearningProposalKind,
  title: string,
): string {
  return path.join(
    getStrataPaths(repoRoot).proposalsDir,
    `${sessionId}-${kind}-${slugify(title)}.md`,
  );
}

function formatLearningProposal(input: LearningProposalInput, created: string): string {
  return [
    "---",
    "type: learning-proposal",
    `kind: ${input.kind}`,
    `session: ${input.sessionId}`,
    "status: pending",
    `created: ${created}`,
    "---",
    "",
    `# Proposal: ${input.title}`,
    "",
    "## Reason",
    "",
    input.reason.trim() || "No reason provided.",
    "",
    "## Evidence",
    "",
    formatEvidence(input.evidence),
    "",
    "## Proposed Change",
    "",
    input.proposedChange.trim() || "No proposed change provided.",
    "",
    "## Risk",
    "",
    input.risk.trim() || "unspecified",
    "",
    "## Apply Command",
    "",
    "```text",
    input.applyCommand?.trim() || "Manual review required.",
    "```",
    "",
  ].join("\n");
}

function formatEvidence(evidence: string[]): string {
  const normalized = evidence.map((item) => item.trim()).filter((item) => item !== "");
  if (normalized.length === 0) {
    return "- No specific evidence provided.";
  }
  return normalized.map((item) => `- ${item}`).join("\n");
}

async function readExistingCreated(file: string): Promise<string | undefined> {
  const content = await readTextFileOrUndefined(file);
  if (content === undefined) {
    return undefined;
  }
  const match = /^created:\s*(.+)$/m.exec(content);
  return match?.[1]?.trim();
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug === "" ? "proposal" : slug;
}
