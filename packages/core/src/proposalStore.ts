import { createHash } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "./events.js";
import { isNotFoundError, readTextFileOrUndefined, writeTextFile } from "./fileStore.js";
import { getStrataPaths } from "./paths.js";
import type { JsonObject } from "./types.js";
import { refreshWikiSearchIndex } from "./wikiSearchIndex.js";

export type LearningProposalKind = "memory" | "skill" | "schema" | "wiki";
export type LearningProposalStatus = "pending" | "deferred" | "applied" | "rejected" | "superseded";

export type LearningProposalStatusFilter = LearningProposalStatus | "all";

export interface LearningProposalInput {
  kind: LearningProposalKind;
  sessionId: string;
  title: string;
  reason: string;
  evidence: string[];
  proposedChange: string;
  risk: string;
  applyCommand?: string;
  dedupeKey?: string;
}

export interface LearningProposalRecord extends JsonObject {
  id: string;
  kind: LearningProposalKind;
  sessionId: string;
  title: string;
  path: string;
  created: string;
  status: LearningProposalStatus;
  dedupeKey?: string;
  updated?: string;
  appliedAt?: string;
  rejectedAt?: string;
  deferredAt?: string;
  supersededAt?: string;
  statusReason?: string;
  statusActor?: string;
}

export interface LearningProposalDetail {
  proposal: LearningProposalRecord;
  content: string;
  sections: Record<string, string>;
  apply: LearningProposalApplyPreview;
  operationPlan?: LearningProposalOperationPlanPreview;
}

export interface LearningProposalApplyPreview {
  supported: boolean;
  mode:
    | "wiki.createPage"
    | "wiki.patchPage"
    | "wiki.consolidateEntity"
    | "ingest.taxonomy"
    | "manual";
  targetPath?: string;
  previewFingerprint?: string;
  message: string;
}

export type LearningProposalOperationPlanSource = "explicitJson" | "legacyProse";
export type LearningProposalOperationPlanReadiness = "invalid" | "manualReview" | "exact";

export interface LearningProposalOperationPlanPreview {
  mode: "wiki.consolidateEntity";
  source: LearningProposalOperationPlanSource;
  valid: boolean;
  applySupported: boolean;
  readiness: LearningProposalOperationPlanReadiness;
  previewFingerprint: string;
  summary: string;
  issues: string[];
  warnings: string[];
  diffs: WikiConsolidationDiffPreview[];
  plan?: WikiConsolidationOperationPlan;
}

type LearningProposalOperationPlanPreviewWithoutFingerprint = Omit<
  LearningProposalOperationPlanPreview,
  "previewFingerprint"
>;

type ExactConsolidationApplyablePreview = LearningProposalOperationPlanPreview & {
  plan: WikiConsolidationOperationPlan;
};

export type WikiConsolidationDiffPreviewStatus =
  | "ready"
  | "unchanged"
  | "missing"
  | "noMatches"
  | "ambiguous";

export interface WikiConsolidationDiffPreview {
  operation: "mergeIntoCanonical" | "supersedePage" | "rewriteBacklinks";
  status: WikiConsolidationDiffPreviewStatus;
  targetPath: string;
  summary: string;
  replacementCount: number;
  patchCount?: number;
  sourcePath?: string;
  canonicalPath?: string;
  fromPath?: string;
  toPath?: string;
  diff?: string;
  truncated?: boolean;
}

export interface WikiConsolidationOperationPlan {
  kind: "wiki.consolidateEntity";
  entityType: "project";
  topic: string;
  canonicalPath: string;
  sourcePaths: string[];
  operations: WikiConsolidationOperation[];
  evidenceLinks: string[];
}

export type WikiConsolidationOperation =
  | WikiConsolidationMergeOperation
  | WikiConsolidationSupersedeOperation
  | WikiConsolidationBacklinkRewriteOperation
  | WikiConsolidationRefreshSearchIndexOperation;

export interface WikiConsolidationMergeOperation {
  type: "mergeIntoCanonical";
  targetPath: string;
  sourcePaths: string[];
  mode: "manualReview" | "exactPatch";
  patches?: WikiConsolidationMergePatch[];
}

export interface WikiConsolidationMergePatch {
  expectedOldText: string;
  replacementText: string;
}

export interface WikiConsolidationSupersedeOperation {
  type: "supersedePage";
  sourcePath: string;
  canonicalPath: string;
  replacementContent: string;
  preserveEvidenceLinks: boolean;
}

export interface WikiConsolidationBacklinkRewriteOperation {
  type: "rewriteBacklinks";
  fromPath: string;
  toPath: string;
}

export interface WikiConsolidationRefreshSearchIndexOperation {
  type: "refreshSearchIndex";
  source: "all";
}

export interface LearningProposalListOptions {
  status?: LearningProposalStatusFilter;
  kind?: LearningProposalKind;
  limit?: number;
}

export interface LearningProposalStatusUpdateInput {
  selector: string;
  status: Exclude<LearningProposalStatus, "superseded">;
  actor?: string;
  reason?: string;
  now?: string;
}

export interface LearningProposalApplyInput {
  selector: string;
  actor?: string;
  reason?: string;
  previewFingerprint?: string;
  now?: string;
}

export interface LearningProposalApplyResult {
  proposal: LearningProposalRecord;
  applied: boolean;
  mode:
    | "wiki.createPage"
    | "wiki.patchPage"
    | "wiki.consolidateEntity"
    | "ingest.taxonomy"
    | "alreadyExists"
    | "alreadyApplied";
  writtenPaths: string[];
  message: string;
}

export interface LearningProposalWriteResult {
  proposal: LearningProposalRecord;
  created: boolean;
}

type LearningProposalApplyPlan =
  | WikiCreatePageApplyPlan
  | WikiPatchPageApplyPlan
  | WikiConsolidationApplyPlan;

interface WikiCreatePageApplyPlan {
  mode: "wiki.createPage";
  relativePath: string;
  absolutePath: string;
  content: string;
}

interface WikiPatchPageApplyPlan {
  mode: "wiki.patchPage";
  relativePath: string;
  absolutePath: string;
  expectedOldText: string;
  replacementText: string;
}

interface WikiConsolidationApplyPlan {
  mode: "wiki.consolidateEntity";
  relativePath: string;
  operationPlan: WikiConsolidationOperationPlan;
  previewFingerprint: string;
  diffs: WikiConsolidationDiffPreview[];
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
    id: proposalIdFromPath(file),
    kind: input.kind,
    sessionId: input.sessionId,
    title: input.title,
    path: path.relative(repoRoot, file),
    created,
    status: "pending",
    ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
  };
}

export async function writeOrReuseLearningProposal(
  repoRoot: string,
  input: LearningProposalInput,
): Promise<LearningProposalWriteResult> {
  const existing =
    input.dedupeKey === undefined
      ? undefined
      : await findPendingLearningProposalByDedupeKey(repoRoot, input.kind, input.dedupeKey);
  if (existing !== undefined) {
    return { proposal: existing, created: false };
  }
  return { proposal: await writeLearningProposal(repoRoot, input), created: true };
}

export async function findPendingLearningProposalByDedupeKey(
  repoRoot: string,
  kind: LearningProposalKind,
  dedupeKey: string,
): Promise<LearningProposalRecord | undefined> {
  const proposalsDir = getStrataPaths(repoRoot).proposalsDir;
  let entries;
  try {
    entries = await readdir(proposalsDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const absolutePath = path.join(proposalsDir, entry.name);
    const content = await readTextFileOrUndefined(absolutePath);
    if (content === undefined) {
      continue;
    }
    const proposal = parseLearningProposalRecord(repoRoot, absolutePath, content);
    if (
      proposal !== undefined &&
      isActiveProposalStatus(proposal.status) &&
      proposal.kind === kind &&
      proposal.dedupeKey === dedupeKey
    ) {
      return proposal;
    }
  }
  return undefined;
}

export async function listLearningProposals(
  repoRoot: string,
  options: LearningProposalListOptions = {},
): Promise<LearningProposalRecord[]> {
  const proposalsDir = getStrataPaths(repoRoot).proposalsDir;
  let entries;
  try {
    entries = await readdir(proposalsDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const proposals: LearningProposalRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const absolutePath = path.join(proposalsDir, entry.name);
    const content = await readTextFileOrUndefined(absolutePath);
    if (content === undefined) {
      continue;
    }
    const proposal = parseLearningProposalRecord(repoRoot, absolutePath, content);
    if (proposal === undefined) {
      continue;
    }
    if (options.kind !== undefined && proposal.kind !== options.kind) {
      continue;
    }
    if (
      options.status !== undefined &&
      options.status !== "all" &&
      proposal.status !== options.status
    ) {
      continue;
    }
    proposals.push(proposal);
  }

  return proposals.sort(compareProposalRecords).slice(0, options.limit ?? proposals.length);
}

export async function readLearningProposal(
  repoRoot: string,
  selector: string,
): Promise<LearningProposalDetail | undefined> {
  const absolutePath = await resolveLearningProposalPath(repoRoot, selector);
  if (absolutePath === undefined) {
    return undefined;
  }
  const content = await readTextFileOrUndefined(absolutePath);
  if (content === undefined) {
    return undefined;
  }
  const proposal = parseLearningProposalRecord(repoRoot, absolutePath, content);
  if (proposal === undefined) {
    return undefined;
  }
  const operationPlan = await previewLearningProposalOperationPlan(repoRoot, content);
  return {
    proposal,
    content,
    sections: parseMarkdownSections(content),
    apply: previewLearningProposalApply(repoRoot, content, operationPlan),
    ...(operationPlan === undefined ? {} : { operationPlan }),
  };
}

export async function updateLearningProposalStatus(
  repoRoot: string,
  input: LearningProposalStatusUpdateInput,
): Promise<LearningProposalRecord> {
  const absolutePath = await requireLearningProposalPath(repoRoot, input.selector);
  const content = await requireLearningProposalContent(absolutePath);
  const current = parseLearningProposalRecord(repoRoot, absolutePath, content);
  if (current === undefined) {
    throw new Error(`Not a learning proposal: ${path.relative(repoRoot, absolutePath)}`);
  }
  validateStatusTransition(current.status, input.status);
  const now = input.now ?? nowIso();
  const statusUpdate = {
    status: input.status,
    now,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
  const nextContent = updateProposalContentStatus(content, statusUpdate);
  await writeTextFile(absolutePath, nextContent);
  const next = parseLearningProposalRecord(repoRoot, absolutePath, nextContent);
  if (next === undefined) {
    throw new Error(
      `Updated proposal could not be parsed: ${path.relative(repoRoot, absolutePath)}`,
    );
  }
  return next;
}

export async function applyLearningProposal(
  repoRoot: string,
  input: LearningProposalApplyInput,
): Promise<LearningProposalApplyResult> {
  const absolutePath = await requireLearningProposalPath(repoRoot, input.selector);
  const content = await requireLearningProposalContent(absolutePath);
  const current = parseLearningProposalRecord(repoRoot, absolutePath, content);
  if (current === undefined) {
    throw new Error(`Not a learning proposal: ${path.relative(repoRoot, absolutePath)}`);
  }
  validateStatusTransition(current.status, "applied");
  const operationPlan = await previewLearningProposalOperationPlan(repoRoot, content);
  if (
    input.previewFingerprint !== undefined &&
    operationPlan?.previewFingerprint !== input.previewFingerprint
  ) {
    throw new Error("Proposal preview changed; reload the proposal and review the latest diffs.");
  }
  const plan = await buildLearningProposalApplyPlan(repoRoot, content, operationPlan);
  if (plan === null) {
    throw new Error("Proposal cannot be auto-applied. Manual review is required.");
  }

  const now = input.now ?? nowIso();
  const writtenPaths: string[] = [];
  const mode = await executeLearningProposalApplyPlan(repoRoot, current, plan, {
    now,
    writtenPaths,
  });

  const proposal = await updateLearningProposalStatus(repoRoot, {
    selector: path.relative(repoRoot, absolutePath),
    status: "applied",
    reason: input.reason ?? applyStatusReason(mode, plan.relativePath),
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    now,
  });

  return {
    proposal,
    applied: true,
    mode,
    writtenPaths,
    message: applyResultMessage(mode, plan.relativePath),
  };
}

async function executeLearningProposalApplyPlan(
  repoRoot: string,
  proposal: LearningProposalRecord,
  plan: LearningProposalApplyPlan,
  options: { now: string; writtenPaths: string[] },
): Promise<LearningProposalApplyResult["mode"]> {
  if (plan.mode === "wiki.createPage") {
    const existing = await readTextFileOrUndefined(plan.absolutePath);
    if (existing === undefined) {
      await writeTextFile(plan.absolutePath, plan.content);
      pushUnique(options.writtenPaths, plan.relativePath);
      await appendWikiProposalApplyLog(repoRoot, proposal, plan.relativePath, options.now);
      return "wiki.createPage";
    }
    if (normalizeText(existing) === normalizeText(plan.content)) {
      return "alreadyExists";
    }
    throw new Error(
      `Refusing to overwrite existing wiki page with different content: ${plan.relativePath}`,
    );
  }

  if (plan.mode === "wiki.consolidateEntity") {
    return executeWikiConsolidationApplyPlan(repoRoot, proposal, plan, options);
  }

  const existing = await readTextFileOrUndefined(plan.absolutePath);
  if (existing === undefined) {
    throw new Error(`Cannot patch missing wiki page: ${plan.relativePath}`);
  }
  const oldMatches = countOccurrences(existing, plan.expectedOldText);
  if (oldMatches === 1) {
    await writeTextFile(
      plan.absolutePath,
      existing.replace(plan.expectedOldText, plan.replacementText),
    );
    pushUnique(options.writtenPaths, plan.relativePath);
    await appendWikiProposalApplyLog(repoRoot, proposal, plan.relativePath, options.now);
    return "wiki.patchPage";
  }
  const replacementMatches = countOccurrences(existing, plan.replacementText);
  if (oldMatches === 0 && replacementMatches === 1) {
    return "alreadyApplied";
  }
  throw new Error(
    `Expected old text matched ${oldMatches} times in ${plan.relativePath}; refusing ambiguous patch.`,
  );
}

async function executeWikiConsolidationApplyPlan(
  repoRoot: string,
  proposal: LearningProposalRecord,
  plan: WikiConsolidationApplyPlan,
  options: { now: string; writtenPaths: string[] },
): Promise<"wiki.consolidateEntity"> {
  const latestPreview = await validateConsolidationOperationPlan(
    repoRoot,
    plan.operationPlan,
    "explicitJson",
  );
  if (!isExactConsolidationPreviewApplyable(latestPreview)) {
    throw new Error(consolidationApplyBlockedMessage(latestPreview));
  }
  if (latestPreview.previewFingerprint !== plan.previewFingerprint) {
    throw new Error("Consolidation preview changed before apply; reload and review latest diffs.");
  }

  let shouldRefreshSearchIndex = false;
  for (const operation of plan.operationPlan.operations) {
    if (operation.type === "mergeIntoCanonical") {
      await applyCanonicalMergeOperation(repoRoot, operation, options.writtenPaths);
    } else if (operation.type === "supersedePage") {
      await applySupersedePageOperation(repoRoot, operation, options.writtenPaths);
    } else if (operation.type === "rewriteBacklinks") {
      await applyBacklinkRewriteOperation(repoRoot, operation, options.writtenPaths);
    } else {
      shouldRefreshSearchIndex = true;
    }
  }

  if (shouldRefreshSearchIndex) {
    await refreshWikiSearchIndex({
      repoRoot,
      source: "all",
      now: new Date(options.now),
    });
  }
  await appendWikiProposalApplyLog(repoRoot, proposal, options.writtenPaths, options.now);
  return "wiki.consolidateEntity";
}

async function applyCanonicalMergeOperation(
  repoRoot: string,
  operation: WikiConsolidationMergeOperation,
  writtenPaths: string[],
): Promise<void> {
  if (operation.mode !== "exactPatch") {
    throw new Error(`Cannot auto-apply manual canonical merge: ${operation.targetPath}`);
  }
  const target = resolveWritableWikiPagePath(repoRoot, operation.targetPath);
  const existing = await readTextFileOrUndefined(target.absolutePath);
  if (existing === undefined) {
    throw new Error(`Cannot merge into missing canonical page: ${target.relativePath}`);
  }

  let next = existing;
  let changed = false;
  const patches = operation.patches ?? [];
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index];
    if (patch === undefined) {
      continue;
    }
    const expectedMatches = countOccurrences(next, patch.expectedOldText);
    if (expectedMatches === 1) {
      next = next.replace(patch.expectedOldText, patch.replacementText);
      changed = true;
      continue;
    }
    const replacementMatches = countOccurrences(next, patch.replacementText);
    if (expectedMatches === 0 && replacementMatches === 1) {
      continue;
    }
    throw new Error(
      expectedMatches === 0
        ? `Canonical merge patch ${index + 1} did not match ${target.relativePath}.`
        : `Canonical merge patch ${index + 1} matched ${expectedMatches} times in ${target.relativePath}.`,
    );
  }

  if (changed) {
    await writeTextFile(target.absolutePath, next);
    pushUnique(writtenPaths, target.relativePath);
  }
}

async function applySupersedePageOperation(
  repoRoot: string,
  operation: WikiConsolidationSupersedeOperation,
  writtenPaths: string[],
): Promise<void> {
  const source = resolveWritableWikiPagePath(repoRoot, operation.sourcePath);
  const existing = await readTextFileOrUndefined(source.absolutePath);
  if (existing === undefined) {
    throw new Error(`Cannot supersede missing wiki page: ${source.relativePath}`);
  }
  const replacement = `${operation.replacementContent.trimEnd()}\n`;
  if (normalizeText(existing) === normalizeText(replacement)) {
    return;
  }
  await writeTextFile(source.absolutePath, replacement);
  pushUnique(writtenPaths, source.relativePath);
}

async function applyBacklinkRewriteOperation(
  repoRoot: string,
  operation: WikiConsolidationBacklinkRewriteOperation,
  writtenPaths: string[],
): Promise<void> {
  const files = await listWritableWikiMarkdownPages(repoRoot);
  const replacementPairs = backlinkReplacementPairs(operation.fromPath, operation.toPath);
  for (const relativePath of files) {
    if (relativePath === operation.fromPath) {
      continue;
    }
    const absolutePath = path.join(repoRoot, relativePath);
    const existing = await readTextFileOrUndefined(absolutePath);
    if (existing === undefined) {
      continue;
    }
    let next = existing;
    for (const pair of replacementPairs) {
      next = replacePathReferences(next, pair.from, pair.to).text;
    }
    if (next !== existing) {
      await writeTextFile(absolutePath, next);
      pushUnique(writtenPaths, relativePath);
    }
  }
}

function consolidationApplyBlockedMessage(preview: LearningProposalOperationPlanPreview): string {
  if (!preview.valid) {
    return `Proposal cannot be auto-applied. Consolidation plan is invalid: ${preview.issues.join("; ")}`;
  }
  if (preview.readiness !== "exact") {
    return "Proposal cannot be auto-applied. Consolidation plan requires manual merge review.";
  }
  const unsafe = preview.diffs.filter(
    (diff) => diff.status !== "ready" && diff.status !== "unchanged",
  );
  if (unsafe.length > 0) {
    return `Proposal cannot be auto-applied. Consolidation previews are not safe: ${unsafe
      .map((diff) => `${diff.targetPath} is ${diff.status}`)
      .join("; ")}`;
  }
  return "Proposal cannot be auto-applied. Consolidation plan has no applyable previews.";
}

function applyStatusReason(
  mode: LearningProposalApplyResult["mode"],
  relativePath: string,
): string {
  switch (mode) {
    case "wiki.createPage":
      return `Created wiki page: ${relativePath}`;
    case "wiki.patchPage":
      return `Patched wiki page: ${relativePath}`;
    case "wiki.consolidateEntity":
      return `Applied wiki consolidation plan: ${relativePath}`;
    case "ingest.taxonomy":
      return `Applied ingest taxonomy update: ${relativePath}`;
    case "alreadyExists":
      return `Wiki page already existed: ${relativePath}`;
    case "alreadyApplied":
      return `Wiki patch already applied: ${relativePath}`;
  }
}

function applyResultMessage(
  mode: LearningProposalApplyResult["mode"],
  relativePath: string,
): string {
  switch (mode) {
    case "wiki.createPage":
      return `Created ${relativePath} and marked proposal applied.`;
    case "wiki.patchPage":
      return `Patched ${relativePath} and marked proposal applied.`;
    case "wiki.consolidateEntity":
      return `Applied consolidation plan for ${relativePath} and marked proposal applied.`;
    case "ingest.taxonomy":
      return `Applied ingest taxonomy update for ${relativePath} and marked proposal applied.`;
    case "alreadyExists":
      return `Marked applied; wiki page already exists at ${relativePath}.`;
    case "alreadyApplied":
      return `Marked applied; wiki patch already appears applied at ${relativePath}.`;
  }
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
    `title: ${quoteYamlScalar(input.title)}`,
    ...(input.dedupeKey === undefined ? [] : [`dedupe_key: ${quoteYamlScalar(input.dedupeKey)}`]),
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

function parseLearningProposalRecord(
  repoRoot: string,
  absolutePath: string,
  content: string,
): LearningProposalRecord | undefined {
  const frontmatter = parseFrontmatter(content);
  if (frontmatter.type !== "learning-proposal") {
    return undefined;
  }
  const kind = frontmatter.kind;
  const sessionId = frontmatter.session;
  const status = frontmatter.status ?? "pending";
  const created = frontmatter.created;
  if (
    !isLearningProposalKind(kind) ||
    sessionId === undefined ||
    !isLearningProposalStatus(status)
  ) {
    return undefined;
  }
  const title = frontmatter.title ?? /^# Proposal:\s*(.+)$/m.exec(content)?.[1]?.trim();
  if (title === undefined || title === "" || created === undefined || created === "") {
    return undefined;
  }
  return {
    id: proposalIdFromPath(absolutePath),
    kind,
    sessionId,
    title,
    path: path.relative(repoRoot, absolutePath),
    created,
    status,
    ...(frontmatter.dedupe_key === undefined ? {} : { dedupeKey: frontmatter.dedupe_key }),
    ...(frontmatter.updated === undefined ? {} : { updated: frontmatter.updated }),
    ...(frontmatter.applied_at === undefined ? {} : { appliedAt: frontmatter.applied_at }),
    ...(frontmatter.rejected_at === undefined ? {} : { rejectedAt: frontmatter.rejected_at }),
    ...(frontmatter.deferred_at === undefined ? {} : { deferredAt: frontmatter.deferred_at }),
    ...(frontmatter.superseded_at === undefined ? {} : { supersededAt: frontmatter.superseded_at }),
    ...(frontmatter.status_reason === undefined ? {} : { statusReason: frontmatter.status_reason }),
    ...(frontmatter.status_actor === undefined ? {} : { statusActor: frontmatter.status_actor }),
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of content.slice(4, end).trim().split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key !== "") {
      values[key] = unquoteYamlScalar(rawValue);
    }
  }
  return values;
}

function isLearningProposalKind(value: string | undefined): value is LearningProposalKind {
  return value === "memory" || value === "skill" || value === "schema" || value === "wiki";
}

function isLearningProposalStatus(value: string | undefined): value is LearningProposalStatus {
  return (
    value === "pending" ||
    value === "deferred" ||
    value === "applied" ||
    value === "rejected" ||
    value === "superseded"
  );
}

function isActiveProposalStatus(status: LearningProposalStatus): boolean {
  return status === "pending" || status === "deferred";
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function unquoteYamlScalar(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value.replace(/^'|'$/g, "");
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

function proposalIdFromPath(file: string): string {
  return path.basename(file, ".md");
}

async function resolveLearningProposalPath(
  repoRoot: string,
  selector: string,
): Promise<string | undefined> {
  const normalized = selector.trim();
  if (normalized === "") {
    return undefined;
  }
  const proposalsDir = getStrataPaths(repoRoot).proposalsDir;
  const candidates = await proposalPathCandidates(repoRoot, normalized);
  const exact = candidates.find((candidate) => candidate.key === normalized);
  if (exact !== undefined) {
    return exact.absolutePath;
  }
  const withoutSuffix = normalized.endsWith(".md") ? normalized.slice(0, -3) : normalized;
  const matches = candidates.filter(
    (candidate) =>
      candidate.id.startsWith(withoutSuffix) ||
      candidate.relativePath.startsWith(withoutSuffix) ||
      candidate.relativePath === path.join(".strata", "proposals", normalized) ||
      path.relative(proposalsDir, candidate.absolutePath).startsWith(withoutSuffix),
  );
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length > 1) {
    throw new Error(
      `Proposal selector is ambiguous: ${selector} matched ${matches
        .slice(0, 5)
        .map((match) => match.id)
        .join(", ")}`,
    );
  }
  return matches[0]?.absolutePath;
}

async function requireLearningProposalPath(repoRoot: string, selector: string): Promise<string> {
  const absolutePath = await resolveLearningProposalPath(repoRoot, selector);
  if (absolutePath === undefined) {
    throw new Error(`Proposal not found: ${selector}`);
  }
  return absolutePath;
}

async function proposalPathCandidates(
  repoRoot: string,
  selector: string,
): Promise<Array<{ id: string; key: string; relativePath: string; absolutePath: string }>> {
  const proposalsDir = getStrataPaths(repoRoot).proposalsDir;
  const direct = normalizeProposalSelectorPath(repoRoot, proposalsDir, selector);
  const candidates: Array<{ id: string; key: string; relativePath: string; absolutePath: string }> =
    [];
  if (direct !== undefined && (await readTextFileOrUndefined(direct)) !== undefined) {
    candidates.push({
      id: proposalIdFromPath(direct),
      key: selector,
      relativePath: path.relative(repoRoot, direct),
      absolutePath: direct,
    });
  }
  let entries;
  try {
    entries = await readdir(proposalsDir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return candidates;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }
    const absolutePath = path.join(proposalsDir, entry.name);
    if (candidates.some((candidate) => candidate.absolutePath === absolutePath)) {
      continue;
    }
    candidates.push({
      id: proposalIdFromPath(entry.name),
      key: proposalIdFromPath(entry.name),
      relativePath: path.relative(repoRoot, absolutePath),
      absolutePath,
    });
  }
  return candidates;
}

function normalizeProposalSelectorPath(
  repoRoot: string,
  proposalsDir: string,
  selector: string,
): string | undefined {
  const withSuffix = selector.endsWith(".md") ? selector : `${selector}.md`;
  const possible = selector.startsWith(".strata/")
    ? path.resolve(repoRoot, withSuffix)
    : selector.startsWith("proposals/")
      ? path.resolve(proposalsDir, withSuffix.slice("proposals/".length))
      : path.resolve(proposalsDir, withSuffix);
  const relative = path.relative(proposalsDir, possible);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return undefined;
  }
  return possible;
}

async function requireLearningProposalContent(absolutePath: string): Promise<string> {
  const content = await readTextFileOrUndefined(absolutePath);
  if (content === undefined) {
    throw new Error(`Proposal file is missing: ${absolutePath}`);
  }
  return content;
}

function compareProposalRecords(
  left: LearningProposalRecord,
  right: LearningProposalRecord,
): number {
  const leftStatus = statusSortWeight(left.status);
  const rightStatus = statusSortWeight(right.status);
  if (leftStatus !== rightStatus) {
    return leftStatus - rightStatus;
  }
  return right.created.localeCompare(left.created);
}

function statusSortWeight(status: LearningProposalStatus): number {
  switch (status) {
    case "pending":
      return 0;
    case "deferred":
      return 1;
    case "rejected":
      return 2;
    case "applied":
      return 3;
    case "superseded":
      return 4;
  }
}

function validateStatusTransition(
  current: LearningProposalStatus,
  next: LearningProposalStatus,
): void {
  if (current === next) {
    return;
  }
  if (current === "applied" || current === "rejected" || current === "superseded") {
    throw new Error(`Cannot change a ${current} proposal to ${next}.`);
  }
  if (next === "superseded") {
    throw new Error("Use a dedicated supersede flow to mark proposals superseded.");
  }
}

function updateProposalContentStatus(
  content: string,
  input: {
    status: Exclude<LearningProposalStatus, "superseded">;
    actor?: string;
    reason?: string;
    now: string;
  },
): string {
  const split = splitFrontmatter(content);
  if (split === null) {
    throw new Error("Proposal is missing frontmatter.");
  }
  const values = parseFrontmatter(content);
  values.status = input.status;
  values.updated = input.now;
  values[`${input.status}_at`] = input.now;
  if (input.actor !== undefined && input.actor.trim() !== "") {
    values.status_actor = input.actor.trim();
  }
  if (input.reason !== undefined && input.reason.trim() !== "") {
    values.status_reason = input.reason.trim();
  }

  const historyInput = {
    status: input.status,
    now: input.now,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
  return `${formatFrontmatter(values)}\n${appendReviewHistory(split.body, historyInput)}`;
}

function splitFrontmatter(
  content: string,
): { values: Record<string, string>; body: string } | null {
  if (!content.startsWith("---\n")) {
    return null;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return null;
  }
  const after = content.indexOf("\n", end + 4);
  const body = after === -1 ? "" : content.slice(after + 1);
  return { values: parseFrontmatter(content), body };
}

function formatFrontmatter(values: Record<string, string>): string {
  const orderedKeys = [
    "type",
    "kind",
    "session",
    "title",
    "dedupe_key",
    "status",
    "created",
    "updated",
    "applied_at",
    "rejected_at",
    "deferred_at",
    "superseded_at",
    "status_actor",
    "status_reason",
  ];
  const emitted = new Set<string>();
  const lines = ["---"];
  for (const key of orderedKeys) {
    const value = values[key];
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${formatYamlScalar(key, value)}`);
    emitted.add(key);
  }
  for (const key of Object.keys(values).sort()) {
    if (emitted.has(key)) {
      continue;
    }
    lines.push(`${key}: ${formatYamlScalar(key, values[key] ?? "")}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function formatYamlScalar(key: string, value: string): string {
  if (
    key === "title" ||
    key === "dedupe_key" ||
    key === "status_actor" ||
    key === "status_reason" ||
    /[:#\n\r]/.test(value)
  ) {
    return quoteYamlScalar(value);
  }
  return value;
}

function appendReviewHistory(
  body: string,
  input: {
    status: LearningProposalStatus;
    actor?: string;
    reason?: string;
    now: string;
  },
): string {
  const actor = input.actor?.trim() ? ` by ${input.actor.trim()}` : "";
  const reason = input.reason?.trim() ? `: ${input.reason.trim()}` : "";
  const entry = `- ${input.now}: marked ${input.status}${actor}${reason}`;
  const sectionPattern = /^## Review History\s*$/m;
  const match = sectionPattern.exec(body);
  if (match === null || match.index === undefined) {
    return `${body.trimEnd()}\n\n## Review History\n\n${entry}\n`;
  }
  const sectionStart = match.index + match[0].length;
  const nextSection = /^##\s+/m.exec(body.slice(sectionStart));
  if (nextSection === null || nextSection.index === undefined) {
    return `${body.trimEnd()}\n${entry}\n`;
  }
  const insertAt = sectionStart + nextSection.index;
  return `${body.slice(0, insertAt).trimEnd()}\n${entry}\n\n${body.slice(insertAt).trimStart()}`;
}

function parseMarkdownSections(content: string): Record<string, string> {
  const withoutFrontmatter = splitFrontmatter(content)?.body ?? content;
  const sections: Record<string, string> = {};
  let currentTitle: string | undefined;
  let currentLines: string[] = [];
  let inFence = false;

  const flush = () => {
    if (currentTitle !== undefined) {
      sections[currentTitle] = currentLines.join("\n").trim();
    }
  };

  for (const line of withoutFrontmatter.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
    }
    const heading = inFence ? null : /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1] !== undefined) {
      flush();
      currentTitle = heading[1].trim();
      currentLines = [];
      continue;
    }
    if (currentTitle !== undefined) {
      currentLines.push(line);
    }
  }
  flush();
  return sections;
}

function previewLearningProposalApply(
  repoRoot: string,
  content: string,
  operationPlan?: LearningProposalOperationPlanPreview,
): LearningProposalApplyPreview {
  const patch = extractWikiPatchPagePayload(content);
  if (patch !== null) {
    const target = previewWritableWikiPagePath(repoRoot, patch.relativePath);
    if (target === null) {
      return unsupportedApplyPreview();
    }
    return {
      supported: true,
      mode: "wiki.patchPage",
      targetPath: target.relativePath,
      message: `Can patch ${target.relativePath} by replacing the expected old text.`,
    };
  }
  const create = extractWikiCreatePagePayload(content);
  if (create !== null) {
    const target = previewWritableWikiPagePath(repoRoot, create.relativePath);
    if (target === null) {
      return unsupportedApplyPreview();
    }
    return {
      supported: true,
      mode: "wiki.createPage",
      targetPath: target.relativePath,
      message: `Can create ${target.relativePath} from the fenced Markdown payload.`,
    };
  }
  if (operationPlan !== undefined && isExactConsolidationPreviewApplyable(operationPlan)) {
    return {
      supported: true,
      mode: "wiki.consolidateEntity",
      targetPath: operationPlan.plan.canonicalPath,
      previewFingerprint: operationPlan.previewFingerprint,
      message: `Can apply exact consolidation plan for ${operationPlan.plan.canonicalPath} after revalidation.`,
    };
  }
  return unsupportedApplyPreview();
}

async function buildLearningProposalApplyPlan(
  repoRoot: string,
  content: string,
  operationPlan?: LearningProposalOperationPlanPreview,
): Promise<LearningProposalApplyPlan | null> {
  const patch = extractWikiPatchPagePayload(content);
  if (patch !== null) {
    const target = resolveWritableWikiPagePath(repoRoot, patch.relativePath);
    return {
      mode: "wiki.patchPage",
      relativePath: target.relativePath,
      absolutePath: target.absolutePath,
      expectedOldText: patch.expectedOldText,
      replacementText: patch.replacementText,
    };
  }
  const create = extractWikiCreatePagePayload(content);
  if (create !== null) {
    const target = resolveWritableWikiPagePath(repoRoot, create.relativePath);
    return {
      mode: "wiki.createPage",
      relativePath: target.relativePath,
      absolutePath: target.absolutePath,
      content: `${create.content.trimEnd()}\n`,
    };
  }

  const preview = operationPlan ?? (await previewLearningProposalOperationPlan(repoRoot, content));
  if (preview !== undefined && isExactConsolidationPreviewApplyable(preview)) {
    return {
      mode: "wiki.consolidateEntity",
      relativePath: preview.plan.canonicalPath,
      operationPlan: preview.plan,
      previewFingerprint: preview.previewFingerprint,
      diffs: preview.diffs,
    };
  }
  return null;
}

function resolveWritableWikiPagePath(
  repoRoot: string,
  relativePath: string,
): { relativePath: string; absolutePath: string } {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, absolutePath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !relative.startsWith(`wiki${path.sep}`) ||
    relative.startsWith(path.join("wiki", "raw") + path.sep) ||
    !relative.endsWith(".md")
  ) {
    throw new Error(`Refusing to apply proposal outside writable wiki pages: ${relativePath}`);
  }
  return {
    relativePath: relative,
    absolutePath,
  };
}

function previewWritableWikiPagePath(
  repoRoot: string,
  relativePath: string,
): { relativePath: string; absolutePath: string } | null {
  try {
    return resolveWritableWikiPagePath(repoRoot, relativePath);
  } catch {
    return null;
  }
}

function unsupportedApplyPreview(): LearningProposalApplyPreview {
  return {
    supported: false,
    mode: "manual",
    message: "Manual review required.",
  };
}

function isExactConsolidationPreviewApplyable(
  preview: LearningProposalOperationPlanPreview,
): preview is ExactConsolidationApplyablePreview {
  return (
    preview.valid &&
    preview.readiness === "exact" &&
    preview.plan !== undefined &&
    preview.diffs.length > 0 &&
    preview.diffs.every((diff) => diff.status === "ready" || diff.status === "unchanged")
  );
}

async function previewLearningProposalOperationPlan(
  repoRoot: string,
  content: string,
): Promise<LearningProposalOperationPlanPreview | undefined> {
  const explicitPayload = extractExplicitOperationPlanJsonPayload(content);
  if (explicitPayload !== null) {
    try {
      return await validateConsolidationOperationPlan(
        repoRoot,
        JSON.parse(explicitPayload) as unknown,
        "explicitJson",
      );
    } catch (error: unknown) {
      return invalidOperationPlanPreview("explicitJson", [
        `Operation plan JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
  }

  const legacyPlan = extractLegacyConsolidationOperationPlan(content);
  if (legacyPlan !== null) {
    return validateConsolidationOperationPlan(repoRoot, legacyPlan, "legacyProse", [
      "Plan was inferred from legacy prose. Regenerate the proposal with an explicit JSON plan before considering auto-apply.",
    ]);
  }
  return undefined;
}

function extractExplicitOperationPlanJsonPayload(content: string): string | null {
  const sections = parseMarkdownSections(content);
  const candidates = [sections["Operation Plan"], sections["Proposed Change"]].filter(
    (section): section is string => section !== undefined,
  );
  for (const candidate of candidates) {
    const labelled =
      fencedBlockAfterLabel(candidate, "Consolidation operation plan") ??
      fencedBlockAfterLabel(candidate, "Operation plan");
    if (labelled !== null) {
      return labelled;
    }
    const jsonFence = /```json\r?\n([\s\S]*?)\r?\n```/.exec(candidate);
    if (jsonFence?.[1] !== undefined) {
      return jsonFence[1];
    }
  }
  return null;
}

function extractLegacyConsolidationOperationPlan(
  content: string,
): WikiConsolidationOperationPlan | null {
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title ?? "";
  const dedupeKey = frontmatter.dedupe_key ?? "";
  if (
    !dedupeKey.startsWith("wiki.entities:project-topic:") &&
    !title.startsWith("Consolidate wiki project entity:")
  ) {
    return null;
  }

  const sections = parseMarkdownSections(content);
  const evidence = sections.Evidence;
  if (evidence === undefined) {
    return null;
  }
  const canonicalPath = evidenceValuesForLabel(evidence, "Canonical candidate")[0];
  const duplicatePaths = evidenceValuesForLabel(evidence, "Duplicate candidate");
  if (canonicalPath === undefined || duplicatePaths.length === 0) {
    return null;
  }
  return buildConsolidationOperationPlan({
    topic: title.replace(/^Consolidate wiki project entity:\s*/, "").trim() || "Project",
    canonicalPath: repoRelativeWikiPath(canonicalPath),
    sourcePaths: duplicatePaths.map(repoRelativeWikiPath),
  });
}

async function validateConsolidationOperationPlan(
  repoRoot: string,
  rawPlan: unknown,
  source: LearningProposalOperationPlanSource,
  initialWarnings: string[] = [],
): Promise<LearningProposalOperationPlanPreview> {
  const issues: string[] = [];
  const warnings = [...initialWarnings];
  const plan = normalizeConsolidationOperationPlan(repoRoot, rawPlan, issues);
  let diffs: WikiConsolidationDiffPreview[] = [];
  if (plan !== null) {
    validateConsolidationOperationCoverage(plan, issues, warnings);
    await validateConsolidationOperationFiles(repoRoot, plan, issues);
    diffs = await buildConsolidationDiffPreviews(repoRoot, plan);
    validateConsolidationDiffPreviews(diffs, issues);
  }

  const valid = issues.length === 0;
  const hasManualMerge =
    plan?.operations.some(
      (operation) => operation.type === "mergeIntoCanonical" && operation.mode === "manualReview",
    ) ?? true;
  const readiness: LearningProposalOperationPlanReadiness = valid
    ? hasManualMerge
      ? "manualReview"
      : "exact"
    : "invalid";
  const applySupported =
    valid &&
    readiness === "exact" &&
    plan !== null &&
    diffs.length > 0 &&
    diffs.every((diff) => diff.status === "ready" || diff.status === "unchanged");
  if (valid && readiness === "manualReview") {
    warnings.push("Canonical page merge operation remains manual review.");
  } else if (valid && readiness === "exact" && applySupported) {
    warnings.push("Exact consolidation diffs are available for guarded apply.");
  } else if (valid && readiness === "exact") {
    warnings.push(
      "Exact consolidation diffs are available, but one or more previews are not safe to apply.",
    );
  }

  return withConsolidationPreviewFingerprint({
    mode: "wiki.consolidateEntity",
    source,
    valid,
    applySupported,
    readiness,
    summary:
      plan === null
        ? "Consolidation operation plan could not be normalized."
        : `Consolidate ${plan.sourcePaths.length} project page(s) into ${plan.canonicalPath}.`,
    issues,
    warnings,
    diffs,
    ...(plan === null ? {} : { plan }),
  });
}

function invalidOperationPlanPreview(
  source: LearningProposalOperationPlanSource,
  issues: string[],
): LearningProposalOperationPlanPreview {
  return withConsolidationPreviewFingerprint({
    mode: "wiki.consolidateEntity",
    source,
    valid: false,
    applySupported: false,
    readiness: "invalid",
    summary: "Consolidation operation plan could not be parsed.",
    issues,
    warnings: [],
    diffs: [],
  });
}

function normalizeConsolidationOperationPlan(
  repoRoot: string,
  rawPlan: unknown,
  issues: string[],
): WikiConsolidationOperationPlan | null {
  if (!isRecord(rawPlan)) {
    issues.push("Operation plan must be a JSON object.");
    return null;
  }
  const kind = rawPlan.kind;
  if (kind !== "wiki.consolidateEntity") {
    issues.push('Operation plan kind must be "wiki.consolidateEntity".');
    return null;
  }
  const entityType = rawPlan.entityType;
  if (entityType !== "project") {
    issues.push('Operation plan entityType must be "project".');
  }
  const topic = requiredString(rawPlan, "topic", issues);
  const canonicalPath = normalizePlanWikiPath(
    repoRoot,
    rawPlan.canonicalPath,
    "canonicalPath",
    issues,
  );
  const sourcePaths = normalizePlanWikiPathArray(
    repoRoot,
    rawPlan.sourcePaths,
    "sourcePaths",
    issues,
  );
  const operations = normalizeConsolidationOperations(repoRoot, rawPlan.operations, issues);
  const evidenceLinks =
    rawPlan.evidenceLinks === undefined
      ? [canonicalPath, ...sourcePaths].filter((value) => value !== "")
      : normalizePlanWikiPathArray(repoRoot, rawPlan.evidenceLinks, "evidenceLinks", issues);

  if (
    entityType !== "project" ||
    topic === "" ||
    canonicalPath === "" ||
    sourcePaths.length === 0 ||
    operations.length === 0 ||
    issues.length > 0
  ) {
    return null;
  }
  const uniqueSourcePaths = uniqueStrings(sourcePaths);
  if (uniqueSourcePaths.length !== sourcePaths.length) {
    issues.push("sourcePaths must not contain duplicates.");
    return null;
  }
  return {
    kind: "wiki.consolidateEntity",
    entityType: "project",
    topic,
    canonicalPath,
    sourcePaths: uniqueSourcePaths,
    operations,
    evidenceLinks: uniqueStrings(evidenceLinks),
  };
}

function normalizeConsolidationOperations(
  repoRoot: string,
  rawOperations: unknown,
  issues: string[],
): WikiConsolidationOperation[] {
  if (!Array.isArray(rawOperations)) {
    issues.push("operations must be an array.");
    return [];
  }
  const operations: WikiConsolidationOperation[] = [];
  rawOperations.forEach((rawOperation, index) => {
    if (!isRecord(rawOperation)) {
      issues.push(`operations[${index}] must be an object.`);
      return;
    }
    const type = rawOperation.type;
    if (type === "mergeIntoCanonical") {
      const targetPath = normalizePlanWikiPath(
        repoRoot,
        rawOperation.targetPath,
        `operations[${index}].targetPath`,
        issues,
      );
      const sourcePaths = normalizePlanWikiPathArray(
        repoRoot,
        rawOperation.sourcePaths,
        `operations[${index}].sourcePaths`,
        issues,
      );
      const mode = rawOperation.mode;
      if (mode !== "manualReview" && mode !== "exactPatch") {
        issues.push(`operations[${index}].mode must be "manualReview" or "exactPatch".`);
        return;
      }
      if (mode === "exactPatch") {
        const patches = normalizeConsolidationMergePatches(
          rawOperation.patches,
          `operations[${index}].patches`,
          issues,
        );
        if (targetPath !== "" && sourcePaths.length > 0 && patches.length > 0) {
          operations.push({
            type,
            targetPath,
            sourcePaths: uniqueStrings(sourcePaths),
            mode,
            patches,
          });
        }
        return;
      }
      if (targetPath !== "" && sourcePaths.length > 0) {
        operations.push({ type, targetPath, sourcePaths: uniqueStrings(sourcePaths), mode });
      }
      return;
    }
    if (type === "supersedePage") {
      const sourcePath = normalizePlanWikiPath(
        repoRoot,
        rawOperation.sourcePath,
        `operations[${index}].sourcePath`,
        issues,
      );
      const canonicalPath = normalizePlanWikiPath(
        repoRoot,
        rawOperation.canonicalPath,
        `operations[${index}].canonicalPath`,
        issues,
      );
      const replacementContent = requiredString(rawOperation, "replacementContent", issues);
      const preserveEvidenceLinks = rawOperation.preserveEvidenceLinks;
      if (preserveEvidenceLinks !== true) {
        issues.push(`operations[${index}].preserveEvidenceLinks must be true.`);
      }
      if (sourcePath !== "" && canonicalPath !== "" && replacementContent !== "") {
        operations.push({
          type,
          sourcePath,
          canonicalPath,
          replacementContent,
          preserveEvidenceLinks: true,
        });
      }
      return;
    }
    if (type === "rewriteBacklinks") {
      const fromPath = normalizePlanWikiPath(
        repoRoot,
        rawOperation.fromPath,
        `operations[${index}].fromPath`,
        issues,
      );
      const toPath = normalizePlanWikiPath(
        repoRoot,
        rawOperation.toPath,
        `operations[${index}].toPath`,
        issues,
      );
      if (fromPath !== "" && toPath !== "") {
        operations.push({ type, fromPath, toPath });
      }
      return;
    }
    if (type === "refreshSearchIndex") {
      if (rawOperation.source !== "all") {
        issues.push(`operations[${index}].source must be "all".`);
        return;
      }
      operations.push({ type, source: "all" });
      return;
    }
    issues.push(`operations[${index}].type is not supported: ${String(type)}`);
  });
  return operations;
}

function validateConsolidationOperationCoverage(
  plan: WikiConsolidationOperationPlan,
  issues: string[],
  warnings: string[],
): void {
  const sourceSet = new Set(plan.sourcePaths);
  if (sourceSet.has(plan.canonicalPath)) {
    issues.push("canonicalPath must not also appear in sourcePaths.");
  }

  const mergeSources = new Set<string>();
  for (const operation of plan.operations) {
    if (operation.type === "mergeIntoCanonical" && operation.targetPath === plan.canonicalPath) {
      for (const sourcePath of operation.sourcePaths) {
        mergeSources.add(sourcePath);
      }
    }
  }
  for (const sourcePath of plan.sourcePaths) {
    if (!mergeSources.has(sourcePath)) {
      issues.push(`Missing mergeIntoCanonical coverage for ${sourcePath}.`);
    }
  }

  const supersededSources = new Set(
    plan.operations
      .filter(
        (operation): operation is WikiConsolidationSupersedeOperation =>
          operation.type === "supersedePage",
      )
      .map((operation) => operation.sourcePath),
  );
  const backlinkSources = new Set(
    plan.operations
      .filter(
        (operation): operation is WikiConsolidationBacklinkRewriteOperation =>
          operation.type === "rewriteBacklinks",
      )
      .filter((operation) => operation.toPath === plan.canonicalPath)
      .map((operation) => operation.fromPath),
  );
  for (const sourcePath of plan.sourcePaths) {
    if (!supersededSources.has(sourcePath)) {
      issues.push(`Missing supersedePage operation for ${sourcePath}.`);
    }
    if (!backlinkSources.has(sourcePath)) {
      issues.push(`Missing rewriteBacklinks operation for ${sourcePath}.`);
    }
  }
  if (!plan.operations.some((operation) => operation.type === "refreshSearchIndex")) {
    issues.push("Missing refreshSearchIndex operation.");
  }
  for (const sourcePath of plan.sourcePaths) {
    if (!plan.evidenceLinks.includes(sourcePath)) {
      warnings.push(`sourcePaths entry is not listed in evidenceLinks: ${sourcePath}`);
    }
  }
}

function normalizeConsolidationMergePatches(
  rawPatches: unknown,
  label: string,
  issues: string[],
): WikiConsolidationMergePatch[] {
  if (!Array.isArray(rawPatches)) {
    issues.push(`${label} must be an array when mode is "exactPatch".`);
    return [];
  }
  if (rawPatches.length === 0) {
    issues.push(`${label} must include at least one exact patch.`);
    return [];
  }

  const patches: WikiConsolidationMergePatch[] = [];
  rawPatches.forEach((rawPatch, index) => {
    if (!isRecord(rawPatch)) {
      issues.push(`${label}[${index}] must be an object.`);
      return;
    }
    const expectedOldText = requiredString(
      rawPatch,
      "expectedOldText",
      issues,
      `${label}[${index}].expectedOldText`,
    );
    const replacementText = requiredString(
      rawPatch,
      "replacementText",
      issues,
      `${label}[${index}].replacementText`,
    );
    if (
      expectedOldText !== "" &&
      replacementText !== "" &&
      normalizeText(expectedOldText) === normalizeText(replacementText)
    ) {
      issues.push(`${label}[${index}] must change the canonical page content.`);
      return;
    }
    if (expectedOldText !== "" && replacementText !== "") {
      patches.push({ expectedOldText, replacementText });
    }
  });
  return patches;
}

async function validateConsolidationOperationFiles(
  repoRoot: string,
  plan: WikiConsolidationOperationPlan,
  issues: string[],
): Promise<void> {
  for (const relativePath of uniqueStrings([plan.canonicalPath, ...plan.sourcePaths])) {
    const text = await readTextFileOrUndefined(path.join(repoRoot, relativePath));
    if (text === undefined) {
      issues.push(`Referenced wiki page does not exist: ${relativePath}`);
    }
  }
}

async function buildConsolidationDiffPreviews(
  repoRoot: string,
  plan: WikiConsolidationOperationPlan,
): Promise<WikiConsolidationDiffPreview[]> {
  const previews: WikiConsolidationDiffPreview[] = [];
  for (const operation of plan.operations) {
    if (operation.type === "mergeIntoCanonical" && operation.mode === "exactPatch") {
      previews.push(await buildCanonicalMergeDiffPreview(repoRoot, operation));
    }
    if (operation.type === "supersedePage") {
      previews.push(await buildSupersedePageDiffPreview(repoRoot, operation));
    }
    if (operation.type === "rewriteBacklinks") {
      previews.push(...(await buildBacklinkRewriteDiffPreviews(repoRoot, operation)));
    }
  }
  return previews;
}

function validateConsolidationDiffPreviews(
  diffs: WikiConsolidationDiffPreview[],
  issues: string[],
): void {
  for (const diff of diffs) {
    if (diff.operation !== "mergeIntoCanonical") {
      continue;
    }
    if (diff.status === "missing") {
      issues.push(`Canonical merge target is missing: ${diff.targetPath}`);
    } else if (diff.status === "noMatches") {
      issues.push(`Canonical merge patch did not match ${diff.targetPath}: ${diff.summary}`);
    } else if (diff.status === "ambiguous") {
      issues.push(`Canonical merge patch is ambiguous in ${diff.targetPath}: ${diff.summary}`);
    }
  }
}

async function buildCanonicalMergeDiffPreview(
  repoRoot: string,
  operation: WikiConsolidationMergeOperation,
): Promise<WikiConsolidationDiffPreview> {
  const existing = await readTextFileOrUndefined(path.join(repoRoot, operation.targetPath));
  if (existing === undefined) {
    return {
      operation: "mergeIntoCanonical",
      status: "missing",
      targetPath: operation.targetPath,
      canonicalPath: operation.targetPath,
      summary: `Cannot preview canonical merge because ${operation.targetPath} is missing.`,
      replacementCount: 0,
      patchCount: operation.patches?.length ?? 0,
    };
  }

  let next = existing;
  let replacementCount = 0;
  let unchangedCount = 0;
  const patches = operation.patches ?? [];
  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index];
    if (patch === undefined) {
      continue;
    }
    const expectedMatches = countOccurrences(next, patch.expectedOldText);
    if (expectedMatches === 1) {
      next = next.replace(patch.expectedOldText, patch.replacementText);
      replacementCount += 1;
      continue;
    }

    const replacementMatches = countOccurrences(next, patch.replacementText);
    if (expectedMatches === 0 && replacementMatches === 1) {
      unchangedCount += 1;
      continue;
    }

    return {
      operation: "mergeIntoCanonical",
      status: expectedMatches === 0 ? "noMatches" : "ambiguous",
      targetPath: operation.targetPath,
      canonicalPath: operation.targetPath,
      summary:
        expectedMatches === 0
          ? `Patch ${index + 1} expected old text was not found in ${operation.targetPath}.`
          : `Patch ${index + 1} expected old text matched ${expectedMatches} times in ${operation.targetPath}.`,
      replacementCount,
      patchCount: patches.length,
    };
  }

  if (replacementCount === 0) {
    return {
      operation: "mergeIntoCanonical",
      status: "unchanged",
      targetPath: operation.targetPath,
      canonicalPath: operation.targetPath,
      summary:
        unchangedCount === patches.length
          ? `${operation.targetPath} already contains all exact canonical merge patch replacements.`
          : `${operation.targetPath} has no canonical merge patch changes to preview.`,
      replacementCount: 0,
      patchCount: patches.length,
    };
  }

  const diff = buildUnifiedDiffPreview(operation.targetPath, existing, next);
  return {
    operation: "mergeIntoCanonical",
    status: "ready",
    targetPath: operation.targetPath,
    canonicalPath: operation.targetPath,
    summary: `Would apply ${replacementCount} exact canonical merge patch(es) to ${operation.targetPath}.`,
    replacementCount,
    patchCount: patches.length,
    diff: diff.text,
    truncated: diff.truncated,
  };
}

async function buildSupersedePageDiffPreview(
  repoRoot: string,
  operation: WikiConsolidationSupersedeOperation,
): Promise<WikiConsolidationDiffPreview> {
  const existing = await readTextFileOrUndefined(path.join(repoRoot, operation.sourcePath));
  if (existing === undefined) {
    return {
      operation: "supersedePage",
      status: "missing",
      targetPath: operation.sourcePath,
      sourcePath: operation.sourcePath,
      canonicalPath: operation.canonicalPath,
      summary: `Cannot preview superseded redirect because ${operation.sourcePath} is missing.`,
      replacementCount: 0,
    };
  }
  const replacement = `${operation.replacementContent.trimEnd()}\n`;
  if (normalizeText(existing) === normalizeText(replacement)) {
    return {
      operation: "supersedePage",
      status: "unchanged",
      targetPath: operation.sourcePath,
      sourcePath: operation.sourcePath,
      canonicalPath: operation.canonicalPath,
      summary: `${operation.sourcePath} already matches the superseded redirect content.`,
      replacementCount: 0,
    };
  }
  const diff = buildUnifiedDiffPreview(operation.sourcePath, existing, replacement);
  return {
    operation: "supersedePage",
    status: "ready",
    targetPath: operation.sourcePath,
    sourcePath: operation.sourcePath,
    canonicalPath: operation.canonicalPath,
    summary: `Would replace ${operation.sourcePath} with a superseded redirect to ${operation.canonicalPath}.`,
    replacementCount: 1,
    diff: diff.text,
    truncated: diff.truncated,
  };
}

async function buildBacklinkRewriteDiffPreviews(
  repoRoot: string,
  operation: WikiConsolidationBacklinkRewriteOperation,
): Promise<WikiConsolidationDiffPreview[]> {
  const files = await listWritableWikiMarkdownPages(repoRoot);
  const replacementPairs = backlinkReplacementPairs(operation.fromPath, operation.toPath);
  const previews: WikiConsolidationDiffPreview[] = [];
  let totalReplacementCount = 0;

  for (const relativePath of files) {
    if (relativePath === operation.fromPath) {
      continue;
    }
    const existing = await readTextFileOrUndefined(path.join(repoRoot, relativePath));
    if (existing === undefined) {
      continue;
    }
    let replacementCount = 0;
    let next = existing;
    for (const pair of replacementPairs) {
      const replacement = replacePathReferences(next, pair.from, pair.to);
      if (replacement.count === 0) {
        continue;
      }
      replacementCount += replacement.count;
      next = replacement.text;
    }
    if (replacementCount === 0) {
      continue;
    }
    totalReplacementCount += replacementCount;
    const diff = buildUnifiedDiffPreview(relativePath, existing, next);
    previews.push({
      operation: "rewriteBacklinks",
      status: "ready",
      targetPath: relativePath,
      fromPath: operation.fromPath,
      toPath: operation.toPath,
      summary: `Would rewrite ${replacementCount} backlink reference(s) from ${operation.fromPath} to ${operation.toPath} in ${relativePath}.`,
      replacementCount,
      diff: diff.text,
      truncated: diff.truncated,
    });
  }

  if (previews.length === 0) {
    return [
      {
        operation: "rewriteBacklinks",
        status: "noMatches",
        targetPath: operation.fromPath,
        fromPath: operation.fromPath,
        toPath: operation.toPath,
        summary: `No backlink references to ${operation.fromPath} were found in writable wiki pages.`,
        replacementCount: totalReplacementCount,
      },
    ];
  }
  return previews;
}

async function listWritableWikiMarkdownPages(repoRoot: string): Promise<string[]> {
  const wikiRoot = path.join(repoRoot, "wiki");
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "raw") {
          await walk(absolutePath);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(path.relative(repoRoot, absolutePath));
      }
    }
  }

  await walk(wikiRoot);
  return files.sort();
}

function backlinkReplacementPairs(
  fromPath: string,
  toPath: string,
): Array<{ from: string; to: string }> {
  const fromWithoutWiki = fromPath.startsWith("wiki/") ? fromPath.slice("wiki/".length) : fromPath;
  const toWithoutWiki = toPath.startsWith("wiki/") ? toPath.slice("wiki/".length) : toPath;
  const pairs = [
    { from: fromPath, to: toPath },
    { from: fromWithoutWiki, to: toWithoutWiki },
  ];
  return pairs
    .filter((pair, index) => pairs.findIndex((candidate) => candidate.from === pair.from) === index)
    .sort((left, right) => right.from.length - left.from.length);
}

function replacePathReferences(
  text: string,
  fromPath: string,
  toPath: string,
): { text: string; count: number } {
  const pathTokenBoundary = "[A-Za-z0-9_./-]";
  const pattern = new RegExp(
    `(?<!${pathTokenBoundary})${escapeRegExp(fromPath)}(?!${pathTokenBoundary})`,
    "g",
  );
  let count = 0;
  return {
    text: text.replace(pattern, () => {
      count += 1;
      return toPath;
    }),
    count,
  };
}

function buildUnifiedDiffPreview(
  relativePath: string,
  before: string,
  after: string,
): { text: string; truncated: boolean } {
  const beforeLines = diffLines(before);
  const afterLines = diffLines(after);
  let prefixLength = 0;
  while (
    prefixLength < beforeLines.length &&
    prefixLength < afterLines.length &&
    beforeLines[prefixLength] === afterLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let beforeSuffixStart = beforeLines.length - 1;
  let afterSuffixStart = afterLines.length - 1;
  while (
    beforeSuffixStart >= prefixLength &&
    afterSuffixStart >= prefixLength &&
    beforeLines[beforeSuffixStart] === afterLines[afterSuffixStart]
  ) {
    beforeSuffixStart -= 1;
    afterSuffixStart -= 1;
  }

  const context = 3;
  const contextStart = Math.max(0, prefixLength - context);
  const afterContextEnd = Math.min(afterLines.length - 1, afterSuffixStart + context);
  const lines = [`--- ${relativePath}`, `+++ ${relativePath}`, "@@"];

  for (const line of beforeLines.slice(contextStart, prefixLength)) {
    lines.push(` ${line}`);
  }
  for (const line of beforeLines.slice(prefixLength, beforeSuffixStart + 1)) {
    lines.push(`-${line}`);
  }
  for (const line of afterLines.slice(prefixLength, afterSuffixStart + 1)) {
    lines.push(`+${line}`);
  }
  for (const line of afterLines.slice(afterSuffixStart + 1, afterContextEnd + 1)) {
    lines.push(` ${line}`);
  }

  const text = lines.join("\n");
  const maxChars = 12_000;
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: `${text.slice(0, maxChars)}\n... diff truncated ...`,
    truncated: true,
  };
}

function diffLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n").trimEnd();
  return normalized === "" ? [] : normalized.split("\n");
}

function buildConsolidationOperationPlan(input: {
  topic: string;
  canonicalPath: string;
  sourcePaths: string[];
}): WikiConsolidationOperationPlan {
  const sourcePaths = uniqueStrings(input.sourcePaths);
  return {
    kind: "wiki.consolidateEntity",
    entityType: "project",
    topic: input.topic,
    canonicalPath: input.canonicalPath,
    sourcePaths,
    operations: [
      {
        type: "mergeIntoCanonical",
        targetPath: input.canonicalPath,
        sourcePaths,
        mode: "manualReview",
      },
      ...sourcePaths.map(
        (sourcePath): WikiConsolidationSupersedeOperation => ({
          type: "supersedePage",
          sourcePath,
          canonicalPath: input.canonicalPath,
          replacementContent: supersededProjectPageContent(
            input.topic,
            sourcePath,
            input.canonicalPath,
          ),
          preserveEvidenceLinks: true,
        }),
      ),
      ...sourcePaths.map(
        (sourcePath): WikiConsolidationBacklinkRewriteOperation => ({
          type: "rewriteBacklinks",
          fromPath: sourcePath,
          toPath: input.canonicalPath,
        }),
      ),
      { type: "refreshSearchIndex", source: "all" },
    ],
    evidenceLinks: uniqueStrings([input.canonicalPath, ...sourcePaths]),
  };
}

function supersededProjectPageContent(
  topic: string,
  sourcePath: string,
  canonicalPath: string,
): string {
  const title = titleFromWikiPath(sourcePath);
  return [
    "---",
    "type: project",
    `title: ${quoteYamlScalar(title)}`,
    "status: superseded",
    `superseded_by: ${canonicalPath}`,
    "---",
    "",
    `# ${title}`,
    "",
    `Superseded by [[${topic}]].`,
    "",
    `Canonical page: ${canonicalPath}`,
    "",
    "Preserve source evidence links and merge durable context into the canonical page before applying this redirect.",
    "",
  ].join("\n");
}

function evidenceValuesForLabel(section: string, label: string): string[] {
  const pattern = new RegExp(`^-\\s*${escapeRegExp(label)}:\\s*(.+?)\\s*$`, "gim");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) {
    if (match[1] !== undefined) {
      values.push(match[1].trim().replace(/^`|`$/g, ""));
    }
  }
  return values;
}

function repoRelativeWikiPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("wiki/") ? normalized : `wiki/${normalized}`;
}

function titleFromWikiPath(value: string): string {
  const basename = path.basename(value, ".md");
  return basename
    .split(/[-_]+/g)
    .filter((part) => part !== "")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizePlanWikiPath(
  repoRoot: string,
  value: unknown,
  label: string,
  issues: string[],
): string {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${label} must be a non-empty string.`);
    return "";
  }
  try {
    return resolveWritableWikiPagePath(repoRoot, value).relativePath;
  } catch (error: unknown) {
    issues.push(`${label} is not a writable wiki markdown path: ${String(value)}`);
    if (error instanceof Error && error.message.trim() !== "") {
      issues.push(error.message);
    }
    return "";
  }
}

function normalizePlanWikiPathArray(
  repoRoot: string,
  value: unknown,
  label: string,
  issues: string[],
): string[] {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array.`);
    return [];
  }
  return value
    .map((item, index) => normalizePlanWikiPath(repoRoot, item, `${label}[${index}]`, issues))
    .filter((item) => item !== "");
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  issues: string[],
  label = key,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${label} must be a non-empty string.`);
    return "";
  }
  return value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractWikiCreatePagePayload(
  content: string,
): { relativePath: string; content: string } | null {
  const proposedChange = parseMarkdownSections(content)["Proposed Change"];
  if (proposedChange === undefined) {
    return null;
  }
  const pathMatch =
    /(?:Proposed\s+[\w -]*page|Create wiki page):\s*`(wiki\/(?!raw\/)[^`]+\.md)`/i.exec(
      proposedChange,
    );
  const markdownMatch = /```(?:markdown|md)\r?\n([\s\S]*?)\r?\n```/.exec(proposedChange);
  if (pathMatch?.[1] === undefined || markdownMatch?.[1] === undefined) {
    return null;
  }
  return {
    relativePath: pathMatch[1],
    content: markdownMatch[1],
  };
}

function extractWikiPatchPagePayload(
  content: string,
): { relativePath: string; expectedOldText: string; replacementText: string } | null {
  const proposedChange = parseMarkdownSections(content)["Proposed Change"];
  if (proposedChange === undefined) {
    return null;
  }
  const pathMatch = /Patch wiki page:\s*`(wiki\/(?!raw\/)[^`]+\.md)`/i.exec(proposedChange);
  if (pathMatch?.[1] === undefined) {
    return null;
  }
  const expectedOldText = fencedBlockAfterLabel(proposedChange, "Expected old text");
  const replacementText = fencedBlockAfterLabel(proposedChange, "Replacement text");
  if (expectedOldText === null || expectedOldText.trim() === "" || replacementText === null) {
    return null;
  }
  return {
    relativePath: pathMatch[1],
    expectedOldText,
    replacementText,
  };
}

function fencedBlockAfterLabel(text: string, label: string): string | null {
  const escapedLabel = escapeRegExp(label);
  const match = new RegExp(
    `${escapedLabel}:\\s*\\r?\\n\\s*\`\`\`(?:markdown|md|text)?\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\``,
    "i",
  ).exec(text);
  return match?.[1] ?? null;
}

async function appendWikiProposalApplyLog(
  repoRoot: string,
  proposal: LearningProposalRecord,
  targetPath: string | string[],
  iso: string,
): Promise<void> {
  const logPath = path.join(repoRoot, "wiki", "log.md");
  await mkdir(path.dirname(logPath), { recursive: true });
  const existing = await readTextFileOrUndefined(logPath);
  const stamp = iso.slice(0, 16).replace("T", " ");
  const targetPaths = Array.isArray(targetPath) ? targetPath : [targetPath];
  const wroteLines =
    targetPaths.length === 0
      ? ["- Wrote: (no wiki page changes)"]
      : targetPaths.map((item) => `- Wrote: ${item}`);
  const entry = [
    `## [${stamp}] proposal.apply | ${proposal.title}`,
    "",
    `- Applied proposal: ${proposal.path}`,
    ...wroteLines,
    "",
  ].join("\n");
  await writeTextFile(logPath, `${existing?.trimEnd() ?? "# Log"}\n\n${entry}`);
}

function withConsolidationPreviewFingerprint(
  preview: LearningProposalOperationPlanPreviewWithoutFingerprint,
): LearningProposalOperationPlanPreview {
  return {
    ...preview,
    previewFingerprint: consolidationPreviewFingerprint(preview),
  };
}

function consolidationPreviewFingerprint(
  preview: LearningProposalOperationPlanPreviewWithoutFingerprint,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        mode: preview.mode,
        source: preview.source,
        valid: preview.valid,
        readiness: preview.readiness,
        applySupported: preview.applySupported,
        issues: preview.issues,
        warnings: preview.warnings,
        plan: preview.plan ?? null,
        diffs: preview.diffs.map((diff) => ({
          operation: diff.operation,
          status: diff.status,
          targetPath: diff.targetPath,
          summary: diff.summary,
          replacementCount: diff.replacementCount,
          patchCount: diff.patchCount ?? null,
          sourcePath: diff.sourcePath ?? null,
          canonicalPath: diff.canonicalPath ?? null,
          fromPath: diff.fromPath ?? null,
          toPath: diff.toPath ?? null,
          diff: diff.diff ?? null,
          truncated: diff.truncated ?? null,
        })),
      }),
    )
    .digest("hex");
}

function normalizeText(value: string): string {
  return value.trimEnd().replace(/\r\n/g, "\n");
}

function countOccurrences(text: string, needle: string): number {
  if (needle === "") {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index === -1) {
      return count;
    }
    count += 1;
    offset = index + needle.length;
  }
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
