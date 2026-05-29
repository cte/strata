import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getStrataPaths,
  type JsonObject,
  type LearningProposalRecord,
  listSkills,
  listTodos,
  type MemoryDocument,
  readMemoryDocuments,
  SessionStore,
  type SkillMetadata,
  type TodoItem,
  writeLearningProposal,
  writeOrReuseLearningProposal,
} from "@strata/core";

export type MaintenanceJobStatus = "ok" | "needs_attention";
export type MaintenanceFindingSeverity = "info" | "warning" | "error";

export interface MaintenanceJobMetadata extends JsonObject {
  name: string;
  description: string;
}

export interface MaintenanceFinding extends JsonObject {
  severity: MaintenanceFindingSeverity;
  title: string;
  detail: string;
  path: string | null;
  line: number | null;
  data: JsonObject | null;
}

export interface MaintenanceJobOutput extends JsonObject {
  status: MaintenanceJobStatus;
  summary: string;
  findings: MaintenanceFinding[];
  proposals: LearningProposalRecord[];
  metrics: JsonObject;
}

export interface MaintenanceRunResult extends JsonObject {
  sessionId: string;
  job: string;
  status: MaintenanceJobStatus;
  summary: string;
  reportPath: string;
  findings: MaintenanceFinding[];
  proposals: LearningProposalRecord[];
  metrics: JsonObject;
}

interface MaintenanceRunConfig {
  jobName: string;
  repoRoot?: string;
}

interface MaintenanceJobContext {
  repoRoot: string;
  sessionId: string;
}

interface MaintenanceJob {
  metadata: MaintenanceJobMetadata;
  run(context: MaintenanceJobContext): Promise<MaintenanceJobOutput>;
}

interface WikiPage {
  absolutePath: string;
  relativePath: string;
  basename: string;
  text: string;
  metadata: Record<string, string>;
  body: string;
}

interface ProjectEntityPageSummary extends JsonObject {
  path: string;
  title: string;
  overSpecific: boolean;
}

interface ProjectEntityConsolidationGroup extends JsonObject {
  id: string;
  topic: string;
  canonicalPath: string;
  duplicatePaths: string[];
  overSpecificPaths: string[];
  paths: string[];
  pages: ProjectEntityPageSummary[];
  proposalPath: string | null;
}

interface ProjectConsolidationOperationPlanResult {
  plan: JsonObject;
  mergeMode: "exactPatch" | "manualReview";
}

interface ProjectConsolidationExactMergePatch extends JsonObject {
  expectedOldText: string;
  replacementText: string;
}

interface MarkdownSection {
  title: string;
  lines: string[];
}

const EXACT_PROJECT_MERGE_MAX_CANONICAL_CHARS = 16_000;
const EXACT_PROJECT_MERGE_MAX_SOURCE_CHARS = 12_000;
const EXACT_PROJECT_MERGE_MAX_REPLACEMENT_CHARS = 30_000;
const EXACT_PROJECT_MERGE_MAX_LINES_PER_SOURCE = 40;
const EXACT_PROJECT_MERGE_SECTIONS = new Set([
  "actions",
  "context",
  "decisions",
  "meetings",
  "notes",
  "open-threads",
  "source-evidence",
  "status",
  "threads",
]);

const JOBS: MaintenanceJob[] = [
  {
    metadata: {
      name: "wiki.lint",
      description: "Dry-run wiki health checks without mutating wiki files.",
    },
    run: runWikiLintJob,
  },
  {
    metadata: {
      name: "wiki.entities",
      description: "Audit wiki entity pages for duplicate topics and over-specific project pages.",
    },
    run: runWikiEntitiesJob,
  },
  {
    metadata: {
      name: "actions.review",
      description: "Find stale or overdue runtime todos and wiki action items.",
    },
    run: runActionsReviewJob,
  },
  {
    metadata: {
      name: "memory.review",
      description: "Check durable memory documents for size, duplication, and missing files.",
    },
    run: runMemoryReviewJob,
  },
  {
    metadata: {
      name: "skills.inventory",
      description: "Inventory procedural skills and flag missing metadata.",
    },
    run: runSkillsInventoryJob,
  },
  {
    metadata: {
      name: "index.refresh",
      description: "Check whether wiki/index.md appears stale and stage an index proposal.",
    },
    run: runIndexRefreshJob,
  },
];

export function listMaintenanceJobs(): MaintenanceJobMetadata[] {
  return JOBS.map((job) => job.metadata);
}

export async function runMaintenanceJob(
  config: MaintenanceRunConfig,
): Promise<MaintenanceRunResult> {
  const repoRoot = getStrataPaths(config.repoRoot).repoRoot;
  const job = JOBS.find((candidate) => candidate.metadata.name === config.jobName);
  if (job === undefined) {
    throw new Error(`Unknown maintenance job: ${config.jobName}`);
  }

  const store = await SessionStore.open(repoRoot);
  let sessionId: string | undefined;
  try {
    const session = await store.createSession({
      kind: "maintain",
      title: `Maintenance: ${job.metadata.name}`,
    });
    sessionId = session.id;
    await store.appendEvent(session.id, "maintenance.started", {
      job: job.metadata.name,
      description: job.metadata.description,
    });

    const output = await job.run({ repoRoot, sessionId: session.id });
    const reportPath = await writeMaintenanceReport(repoRoot, session.id, job.metadata, output);
    const result: MaintenanceRunResult = {
      sessionId: session.id,
      job: job.metadata.name,
      status: output.status,
      summary: output.summary,
      reportPath,
      findings: output.findings,
      proposals: output.proposals,
      metrics: output.metrics,
    };
    await store.appendEvent(session.id, "maintenance.completed", result);
    await store.endSession(session.id, "completed");
    return result;
  } catch (error: unknown) {
    if (sessionId !== undefined) {
      await store.appendEvent(sessionId, "maintenance.failed", {
        job: job.metadata.name,
        message: error instanceof Error ? error.message : String(error),
      });
      await store.endSession(sessionId, "failed");
    }
    throw error;
  } finally {
    store.close();
  }
}

async function runWikiLintJob(context: MaintenanceJobContext): Promise<MaintenanceJobOutput> {
  const pages = await readWikiPages(context.repoRoot);
  const today = todayUtc();
  const findings: MaintenanceFinding[] = [];
  const inbound = buildInboundIndex(pages);
  const decisionKeys = new Set(
    pages
      .filter((page) => page.relativePath.startsWith(`decisions${path.sep}`))
      .map((page) => pageKey(page.basename)),
  );

  for (const page of pages) {
    const pageType = page.metadata.type ?? "";
    if (!skipFrontmatterCheck(page) && Object.keys(page.metadata).length === 0) {
      findings.push(
        finding("warning", "Missing frontmatter", `${page.relativePath} has no YAML frontmatter.`, {
          path: page.relativePath,
        }),
      );
    }

    if (pageType === "thread" && (page.metadata.status ?? "open") === "open") {
      const opened = parseIsoDate(page.metadata.opened);
      if (opened !== null && dateDiffDays(today, opened) > 30) {
        findings.push(
          finding(
            "warning",
            "Stale open thread",
            `${page.relativePath} has been open for ${dateDiffDays(today, opened)} days.`,
            { path: page.relativePath },
          ),
        );
      }
    }

    if (page.basename === "priorities.md") {
      const lastUpdated = parseIsoDate(page.metadata.last_updated);
      if (lastUpdated === null) {
        findings.push(
          finding("warning", "Stale priorities", "priorities.md has no last_updated date.", {
            path: page.relativePath,
          }),
        );
      } else if (dateDiffDays(today, lastUpdated) > 30) {
        findings.push(
          finding(
            "warning",
            "Stale priorities",
            `priorities.md was last updated ${lastUpdated.toISOString().slice(0, 10)}.`,
            { path: page.relativePath },
          ),
        );
      }
    }

    if (isEntityPage(page) && !inbound.has(pageKey(page.basename))) {
      findings.push(
        finding("info", "Orphan wiki page", `${page.relativePath} has no inbound wikilinks.`, {
          path: page.relativePath,
        }),
      );
    }

    for (const action of actionDueDates(page.text)) {
      if (action.due < today) {
        findings.push(
          finding(
            "warning",
            "Overdue wiki action",
            `Due ${action.due.toISOString().slice(0, 10)}: ${action.line}`,
            { path: page.relativePath, line: action.lineNumber },
          ),
        );
      }
    }

    for (const link of wikilinks(page.body)) {
      const key = pageKey(path.basename(link, ".md"));
      if (/^\d{4}-\d{2}-\d{2}-/.test(key) && key.includes("decision") && !decisionKeys.has(key)) {
        findings.push(
          finding(
            "warning",
            "Missing linked decision",
            `${page.relativePath} links to missing decision [[${link}]].`,
            { path: page.relativePath },
          ),
        );
      }
    }
  }

  return outputFromFindings("wiki.lint", findings, {
    pages: pages.length,
    warnings: findings.filter((item) => item.severity === "warning").length,
    errors: findings.filter((item) => item.severity === "error").length,
  });
}

async function runWikiEntitiesJob(context: MaintenanceJobContext): Promise<MaintenanceJobOutput> {
  const pages = await readWikiPages(context.repoRoot);
  const projectPages = pages.filter(
    (page) => page.relativePath.startsWith(`projects${path.sep}`) && !isSupersededPage(page),
  );
  const projectPagesByPath = new Map(projectPages.map((page) => [page.relativePath, page]));
  const findings: MaintenanceFinding[] = [];
  const canonicalTopics = new Map<string, WikiPage[]>();
  let overSpecificProjectPages = 0;
  const overSpecificPages: ProjectEntityPageSummary[] = [];

  for (const page of projectPages) {
    const title = pageTitle(page);
    for (const topic of canonicalEntityTopics(`${title}\n${page.basename}`)) {
      const pagesForTopic = canonicalTopics.get(topic) ?? [];
      pagesForTopic.push(page);
      canonicalTopics.set(topic, pagesForTopic);
    }

    if (looksOverSpecificProjectPage(page, title)) {
      overSpecificProjectPages += 1;
      overSpecificPages.push(projectEntityPageSummary(page));
      findings.push(
        finding(
          "warning",
          "Over-specific project page",
          `${page.relativePath} looks source-derived rather than canonical; consider merging it into a stable project/topic page.`,
          {
            path: page.relativePath,
            data: {
              page: projectEntityPageSummary(page),
              topics: canonicalEntityTopics(`${title}\n${page.basename}`),
            },
          },
        ),
      );
    }
  }

  let duplicateProjectTopics = 0;
  const consolidationGroups: ProjectEntityConsolidationGroup[] = [];
  for (const [topic, topicPages] of [...canonicalTopics.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const uniqueTopicPages = uniquePages(topicPages);
    if (uniqueTopicPages.length <= 1) {
      continue;
    }
    const canonicalPage = chooseCanonicalProjectPage(topic, uniqueTopicPages);
    const duplicatePaths = uniqueTopicPages
      .filter((page) => page.relativePath !== canonicalPage.relativePath)
      .map((page) => page.relativePath);
    const overSpecificPaths = uniqueTopicPages
      .filter((page) => looksOverSpecificProjectPage(page, pageTitle(page)))
      .map((page) => page.relativePath);
    const group: ProjectEntityConsolidationGroup = {
      id: `project-topic:${pageKey(topic)}`,
      topic,
      canonicalPath: canonicalPage.relativePath,
      duplicatePaths,
      overSpecificPaths,
      paths: uniqueTopicPages.map((page) => page.relativePath),
      pages: uniqueTopicPages.map(projectEntityPageSummary),
      proposalPath: null,
    };
    consolidationGroups.push(group);
    duplicateProjectTopics += 1;
    findings.push(
      finding(
        "warning",
        "Duplicate project topic",
        `${topic} appears to have ${uniqueTopicPages.length} project pages: ${uniqueTopicPages
          .map((page) => page.relativePath)
          .join(", ")}.`,
        { path: canonicalPage.relativePath, data: group },
      ),
    );
  }

  const proposalResults = await stageProjectEntityConsolidationProposals(
    context,
    consolidationGroups,
    overSpecificPages,
    projectPagesByPath,
  );
  for (const proposal of proposalResults.proposals) {
    const group = consolidationGroups.find(
      (candidate) => candidate.id === proposal.dedupeKey?.replace(/^wiki\.entities:/, ""),
    );
    if (group !== undefined) {
      group.proposalPath = proposal.path;
    }
  }

  return {
    status: findings.some(
      (finding) => finding.severity === "error" || finding.severity === "warning",
    )
      ? "needs_attention"
      : "ok",
    summary:
      findings.length === 0
        ? "wiki.entities completed with no findings."
        : `wiki.entities produced ${findings.length} finding(s) across ${consolidationGroups.length} consolidation group(s).`,
    findings,
    proposals: proposalResults.proposals,
    metrics: {
      projectPages: projectPages.length,
      duplicateProjectTopics,
      overSpecificProjectPages,
      consolidationGroups,
      proposals: proposalResults.proposals.length,
      newProposals: proposalResults.created,
      reusedProposals: proposalResults.reused,
    },
  };
}

async function stageProjectEntityConsolidationProposals(
  context: MaintenanceJobContext,
  groups: ProjectEntityConsolidationGroup[],
  overSpecificPages: ProjectEntityPageSummary[],
  pagesByPath: Map<string, WikiPage>,
): Promise<{ proposals: LearningProposalRecord[]; created: number; reused: number }> {
  const proposals: LearningProposalRecord[] = [];
  let created = 0;
  let reused = 0;

  for (const group of groups) {
    const operationPlan = projectConsolidationOperationPlan(group, pagesByPath);
    const mergeInstruction =
      operationPlan.mergeMode === "exactPatch"
        ? "The operation plan includes an exact append-only canonical merge patch for durable context that can be reviewed before accepting."
        : "Merge durable context, decisions, active threads, and source evidence links from:";
    const result = await writeOrReuseLearningProposal(context.repoRoot, {
      kind: "wiki",
      sessionId: context.sessionId,
      title: `Consolidate wiki project entity: ${group.topic}`,
      reason:
        "Maintenance found multiple project pages that appear to describe the same canonical topic.",
      evidence: [
        `Canonical candidate: ${group.canonicalPath}`,
        ...group.duplicatePaths.map((pagePath) => `Duplicate candidate: ${pagePath}`),
        ...group.overSpecificPaths.map((pagePath) => `Over-specific page: ${pagePath}`),
      ],
      proposedChange: [
        `Keep ${group.canonicalPath} as the canonical ${group.topic} project page unless review finds a better target.`,
        "",
        mergeInstruction,
        "",
        ...group.duplicatePaths.map((pagePath) => `- ${pagePath}`),
        "",
        "After merging, replace duplicate pages with short superseded notes that link to the canonical page and preserve source evidence links. Do not delete decision pages or raw/source pages.",
        "",
        "Then refresh retrieval with:",
        "",
        "```bash",
        "bun run strata wiki search-index refresh --source all",
        "```",
        "",
        "If this cluster recurs from ingest, update raw-to-wiki canonical project aliases after reviewing the merge.",
        "",
        "Consolidation operation plan:",
        "",
        "```json",
        JSON.stringify(operationPlan.plan, null, 2),
        "```",
      ].join("\n"),
      risk: "medium: project-page merges can lose nuance if source evidence or active threads are dropped.",
      applyCommand:
        operationPlan.mergeMode === "exactPatch"
          ? "Review exact consolidation diffs, then accept the proposal to apply and refresh the search index."
          : "Manual wiki merge, then bun run strata wiki search-index refresh --source all",
      dedupeKey: `wiki.entities:${group.id}`,
    });
    proposals.push(result.proposal);
    if (result.created) {
      created += 1;
    } else {
      reused += 1;
    }
  }

  if (overSpecificPages.length > 0) {
    const result = await writeOrReuseLearningProposal(context.repoRoot, {
      kind: "wiki",
      sessionId: context.sessionId,
      title: "Review over-specific wiki project pages",
      reason:
        "Maintenance found project pages whose titles look source-derived rather than canonical.",
      evidence: overSpecificPages.slice(0, 30).map((page) => `${page.path}: ${page.title}`),
      proposedChange: [
        "Review the over-specific project pages and either merge them into stable project pages or convert the useful context into source-backed notes.",
        "",
        "Pages to review:",
        "",
        ...overSpecificPages.map((page) => `- ${page.path} (${page.title})`),
        "",
        "After review, refresh retrieval with:",
        "",
        "```bash",
        "bun run strata wiki search-index refresh --source all",
        "```",
      ].join("\n"),
      risk: "medium: source-derived pages may still contain useful context that should be preserved.",
      applyCommand:
        "Manual wiki review, then bun run strata wiki search-index refresh --source all",
      dedupeKey: "wiki.entities:over-specific-project-pages",
    });
    proposals.push(result.proposal);
    if (result.created) {
      created += 1;
    } else {
      reused += 1;
    }
  }

  return { proposals, created, reused };
}

function projectConsolidationOperationPlan(
  group: ProjectEntityConsolidationGroup,
  pagesByPath: Map<string, WikiPage>,
): ProjectConsolidationOperationPlanResult {
  const canonicalPath = repoWikiPath(group.canonicalPath);
  const sourcePaths = group.duplicatePaths.map(repoWikiPath);
  const exactMergePatch = projectConsolidationExactMergePatch(group, pagesByPath);
  const mergeOperation =
    exactMergePatch === null
      ? {
          type: "mergeIntoCanonical",
          targetPath: canonicalPath,
          sourcePaths,
          mode: "manualReview",
        }
      : {
          type: "mergeIntoCanonical",
          targetPath: canonicalPath,
          sourcePaths,
          mode: "exactPatch",
          patches: [exactMergePatch],
        };
  return {
    mergeMode: exactMergePatch === null ? "manualReview" : "exactPatch",
    plan: {
      kind: "wiki.consolidateEntity",
      entityType: "project",
      topic: group.topic,
      canonicalPath,
      sourcePaths,
      operations: [
        mergeOperation,
        ...sourcePaths.map((sourcePath) => ({
          type: "supersedePage",
          sourcePath,
          canonicalPath,
          replacementContent: supersededProjectPageContent(group.topic, sourcePath, canonicalPath),
          preserveEvidenceLinks: true,
        })),
        ...sourcePaths.map((sourcePath) => ({
          type: "rewriteBacklinks",
          fromPath: sourcePath,
          toPath: canonicalPath,
        })),
        {
          type: "refreshSearchIndex",
          source: "all",
        },
      ],
      evidenceLinks: [canonicalPath, ...sourcePaths],
    },
  };
}

function projectConsolidationExactMergePatch(
  group: ProjectEntityConsolidationGroup,
  pagesByPath: Map<string, WikiPage>,
): ProjectConsolidationExactMergePatch | null {
  const canonicalPage = pagesByPath.get(group.canonicalPath);
  if (
    canonicalPage === undefined ||
    canonicalPage.text.length > EXACT_PROJECT_MERGE_MAX_CANONICAL_CHARS
  ) {
    return null;
  }

  const sourcePages: WikiPage[] = [];
  for (const sourcePath of group.duplicatePaths) {
    const sourcePage = pagesByPath.get(sourcePath);
    if (sourcePage === undefined || sourcePage.text.length > EXACT_PROJECT_MERGE_MAX_SOURCE_CHARS) {
      return null;
    }
    sourcePages.push(sourcePage);
  }
  if (sourcePages.length === 0) {
    return null;
  }

  const mergeBlock = projectConsolidationMergeBlock(canonicalPage, sourcePages);
  if (mergeBlock === null) {
    return null;
  }

  const expectedOldText = canonicalPage.text.trimEnd();
  if (expectedOldText === "") {
    return null;
  }

  const replacementText = `${expectedOldText}\n\n${mergeBlock.trimEnd()}\n`;
  if (replacementText.length > EXACT_PROJECT_MERGE_MAX_REPLACEMENT_CHARS) {
    return null;
  }

  return { expectedOldText, replacementText };
}

function projectConsolidationMergeBlock(
  canonicalPage: WikiPage,
  sourcePages: WikiPage[],
): string | null {
  const emitted = new Set(
    canonicalPage.body
      .split(/\r?\n/)
      .map(normalizedMergeLine)
      .filter((line) => line !== ""),
  );
  const sourceBlocks: string[] = [];

  for (const sourcePage of sourcePages) {
    const sourceLines = durableProjectMergeLines(sourcePage, emitted);
    if (sourceLines.length === 0) {
      continue;
    }
    sourceBlocks.push(
      [
        `### ${pageTitle(sourcePage)}`,
        "",
        `Source page: [[${sourcePage.relativePath.replace(/\\/g, "/")}|${pageTitle(sourcePage)}]]`,
        "",
        ...sourceLines,
      ].join("\n"),
    );
  }

  if (sourceBlocks.length === 0) {
    return null;
  }

  return ["## Consolidated Sources", "", sourceBlocks.join("\n\n")].join("\n");
}

function durableProjectMergeLines(sourcePage: WikiPage, emitted: Set<string>): string[] {
  const lines: string[] = [];
  for (const section of markdownSections(sourcePage.body)) {
    if (!EXACT_PROJECT_MERGE_SECTIONS.has(pageKey(section.title))) {
      continue;
    }
    const sectionLines = durableSectionMergeLines(section, emitted);
    if (sectionLines.length === 0) {
      continue;
    }
    lines.push(`- ${section.title}:`);
    lines.push(...sectionLines.map((line) => `  ${line}`));
    if (lines.length >= EXACT_PROJECT_MERGE_MAX_LINES_PER_SOURCE) {
      return lines.slice(0, EXACT_PROJECT_MERGE_MAX_LINES_PER_SOURCE);
    }
  }
  return lines;
}

function durableSectionMergeLines(section: MarkdownSection, emitted: Set<string>): string[] {
  const lines: string[] = [];
  for (const line of section.lines) {
    const trimmed = line.trim();
    if (!isDurableProjectMergeLine(trimmed)) {
      continue;
    }
    const normalized = normalizedMergeLine(trimmed);
    if (normalized === "" || emitted.has(normalized)) {
      continue;
    }
    emitted.add(normalized);
    lines.push(trimmed);
  }
  return lines;
}

function isDurableProjectMergeLine(line: string): boolean {
  if (!line.startsWith("- ")) {
    return false;
  }
  if (line.length < 8) {
    return false;
  }
  if (/\b(no|none|tbd|todo)\b/i.test(line) || /created automatically/i.test(line)) {
    return false;
  }
  return true;
}

function normalizedMergeLine(line: string): string {
  return line
    .trim()
    .replace(/^- \[[ xX]\]\s+/, "- ")
    .replace(/^- /, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function markdownSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { title: "Notes", lines: [] };
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      sections.push(current);
      current = { title: heading[1] ?? "", lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);
  return sections.filter((section) => section.lines.some((line) => line.trim() !== ""));
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
    `title: ${JSON.stringify(title)}`,
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

function repoWikiPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.startsWith("wiki/") ? normalized : `wiki/${normalized}`;
}

function titleFromWikiPath(value: string): string {
  return path
    .basename(value, ".md")
    .split(/[-_]+/g)
    .filter((part) => part !== "")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function uniquePages(pages: WikiPage[]): WikiPage[] {
  const seen = new Set<string>();
  const unique: WikiPage[] = [];
  for (const page of pages) {
    if (seen.has(page.relativePath)) {
      continue;
    }
    seen.add(page.relativePath);
    unique.push(page);
  }
  return unique.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function chooseCanonicalProjectPage(topic: string, pages: WikiPage[]): WikiPage {
  const [first] = [...pages].sort((left, right) => {
    const leftScore = canonicalProjectPageScore(topic, left);
    const rightScore = canonicalProjectPageScore(topic, right);
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    return left.relativePath.localeCompare(right.relativePath);
  });
  if (first === undefined) {
    throw new Error(`Cannot choose canonical page for empty topic: ${topic}`);
  }
  return first;
}

function canonicalProjectPageScore(topic: string, page: WikiPage): number {
  const title = pageTitle(page);
  const titleKey = pageKey(title);
  const topicKey = pageKey(topic);
  const slug = path.basename(page.basename, ".md");
  let score = slug.length;
  if (titleKey === topicKey || pageKey(slug) === topicKey) {
    score -= 1000;
  }
  if (!looksOverSpecificProjectPage(page, title)) {
    score -= 500;
  }
  if (page.relativePath.endsWith(`${path.sep}index.md`)) {
    score -= 50;
  }
  return score;
}

function projectEntityPageSummary(page: WikiPage): ProjectEntityPageSummary {
  const title = pageTitle(page);
  return {
    path: page.relativePath,
    title,
    overSpecific: looksOverSpecificProjectPage(page, title),
  };
}

async function runActionsReviewJob(context: MaintenanceJobContext): Promise<MaintenanceJobOutput> {
  const findings: MaintenanceFinding[] = [];
  const today = todayUtc();
  const todos = await listTodos(context.repoRoot, true);
  for (const todo of todos) {
    if (todo.status === "done" || todo.status === "cancelled") {
      continue;
    }
    const due = parseIsoDate(todo.due ?? undefined);
    if (due !== null && due < today) {
      findings.push(
        finding("warning", "Overdue runtime todo", `${todo.id} was due ${todo.due}: ${todo.title}`),
      );
    }
    const updatedAt = parseIsoDate(todo.updatedAt);
    if (updatedAt !== null && dateDiffDays(today, updatedAt) > 30) {
      findings.push(
        finding(
          "info",
          "Stale runtime todo",
          `${todo.id} has not changed since ${todo.updatedAt.slice(0, 10)}: ${todo.title}`,
        ),
      );
    }
  }

  for (const page of (await readWikiPages(context.repoRoot)).filter((page) =>
    page.relativePath.startsWith(`actions${path.sep}`),
  )) {
    for (const action of actionDueDates(page.text)) {
      if (action.due < today) {
        findings.push(
          finding(
            "warning",
            "Overdue wiki action",
            `Due ${action.due.toISOString().slice(0, 10)}: ${action.line}`,
            { path: page.relativePath, line: action.lineNumber },
          ),
        );
      }
    }
  }

  return outputFromFindings("actions.review", findings, {
    runtimeTodos: todos.length,
    activeRuntimeTodos: todos.filter(
      (todo) => todo.status !== "done" && todo.status !== "cancelled",
    ).length,
  });
}

async function runMemoryReviewJob(context: MaintenanceJobContext): Promise<MaintenanceJobOutput> {
  const documents = await readMemoryDocuments(context.repoRoot, "all", Number.POSITIVE_INFINITY);
  const findings: MaintenanceFinding[] = [];
  for (const document of documents) {
    if (!document.exists) {
      findings.push(
        finding("info", "Missing memory document", `${document.path} does not exist yet.`, {
          path: document.path,
        }),
      );
      continue;
    }
    if (document.chars > 12_000) {
      findings.push(
        finding(
          "warning",
          "Large memory document",
          `${document.path} is ${document.chars} characters; review for compaction.`,
          { path: document.path },
        ),
      );
    }
    for (const duplicate of duplicateBullets(document.content)) {
      findings.push(
        finding("warning", "Duplicate memory entry", duplicate, {
          path: document.path,
        }),
      );
    }
  }

  return outputFromFindings("memory.review", findings, {
    documents: documents.length,
    existingDocuments: documents.filter((document) => document.exists).length,
    chars: documents.reduce((sum, document) => sum + document.chars, 0),
  });
}

async function runSkillsInventoryJob(
  context: MaintenanceJobContext,
): Promise<MaintenanceJobOutput> {
  const skills = await listSkills(context.repoRoot);
  const findings: MaintenanceFinding[] = [];
  if (skills.length === 0) {
    findings.push(
      finding(
        "info",
        "No skills installed",
        "No local Strata skills were found under .strata/skills.",
      ),
    );
  }
  for (const skill of skills) {
    if (skill.description.trim() === "") {
      findings.push(
        finding("warning", "Skill missing description", `${skill.name} has no description.`, {
          path: skill.path,
        }),
      );
    }
    if (skill.source !== "strata") {
      continue;
    }
    if (skill.triggers.length === 0) {
      findings.push(
        finding("info", "Skill missing triggers", `${skill.name} has no trigger phrases.`, {
          path: skill.path,
        }),
      );
    }
    if (skill.status !== "active") {
      findings.push(
        finding("info", "Inactive skill", `${skill.name} status is ${skill.status}.`, {
          path: skill.path,
        }),
      );
    }
  }

  return outputFromFindings("skills.inventory", findings, {
    skills: skills.length,
    strataSkills: skills.filter((skill) => skill.source === "strata").length,
    agentSkills: skills.filter((skill) => skill.source === "agents").length,
    activeSkills: skills.filter((skill) => skill.status === "active").length,
  });
}

async function runIndexRefreshJob(context: MaintenanceJobContext): Promise<MaintenanceJobOutput> {
  const pages = (await readWikiPages(context.repoRoot)).filter(isIndexCandidate);
  const indexPath = path.join(context.repoRoot, "wiki", "index.md");
  let indexText = "";
  try {
    indexText = await readFile(indexPath, "utf8");
  } catch (error: unknown) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  const missing = pages.filter((page) => !indexMentionsPage(indexText, page));
  const findings = missing.map((page) =>
    finding("info", "Wiki page missing from index", `${page.relativePath} is not referenced.`, {
      path: page.relativePath,
    }),
  );
  const proposals: LearningProposalRecord[] = [];
  if (missing.length > 0) {
    proposals.push(
      await writeLearningProposal(context.repoRoot, {
        kind: "wiki",
        sessionId: context.sessionId,
        title: "Refresh wiki index",
        reason: "Maintenance found wiki pages that are not referenced from wiki/index.md.",
        evidence: missing.slice(0, 20).map((page) => page.relativePath),
        proposedChange: [
          "Review wiki/index.md and add appropriate links or category entries for:",
          "",
          ...missing.map((page) => `- ${page.relativePath}`),
        ].join("\n"),
        risk: "low",
        applyCommand: "Manual edit to wiki/index.md after reviewing page relevance.",
      }),
    );
  }

  return {
    status: findings.length === 0 ? "ok" : "needs_attention",
    summary:
      findings.length === 0
        ? "index.refresh completed with no missing index references."
        : `index.refresh found ${findings.length} page(s) not referenced from wiki/index.md.`,
    findings,
    proposals,
    metrics: {
      candidatePages: pages.length,
      missingPages: missing.length,
    },
  };
}

function outputFromFindings(
  job: string,
  findings: MaintenanceFinding[],
  metrics: JsonObject,
): MaintenanceJobOutput {
  return {
    status: findings.some(
      (finding) => finding.severity === "error" || finding.severity === "warning",
    )
      ? "needs_attention"
      : "ok",
    summary:
      findings.length === 0
        ? `${job} completed with no findings.`
        : `${job} produced ${findings.length} finding(s).`,
    findings,
    proposals: [],
    metrics,
  };
}

async function writeMaintenanceReport(
  repoRoot: string,
  sessionId: string,
  metadata: MaintenanceJobMetadata,
  output: MaintenanceJobOutput,
): Promise<string> {
  const reportDir = path.join(getStrataPaths(repoRoot).reportsDir, "maintenance");
  const file = path.join(reportDir, `${sessionId}-${metadata.name.replace(/\./g, "-")}.json`);
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify(
      {
        sessionId,
        job: metadata,
        ...output,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return path.relative(repoRoot, file);
}

async function readWikiPages(repoRoot: string): Promise<WikiPage[]> {
  const root = path.join(repoRoot, "wiki");
  const files = await markdownFiles(root);
  const pages = await Promise.all(
    files.map(async (absolutePath) => {
      const text = await readFile(absolutePath, "utf8");
      const { metadata, body } = splitFrontmatter(text);
      return {
        absolutePath,
        relativePath: path.relative(root, absolutePath),
        basename: path.basename(absolutePath),
        text,
        metadata,
        body,
      };
    }),
  );
  return pages.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function markdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!new Set([".git", "dist", "meta", "node_modules", "raw"]).has(entry.name)) {
        files.push(...(await markdownFiles(fullPath)));
      }
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function buildInboundIndex(pages: WikiPage[]): Map<string, Set<string>> {
  const inbound = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const link of wikilinks(page.text)) {
      const key = pageKey(path.basename(link, ".md"));
      const incoming = inbound.get(key) ?? new Set<string>();
      incoming.add(page.relativePath);
      inbound.set(key, incoming);
    }
  }
  return inbound;
}

function wikilinks(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)/g)].map((match) => match[1] ?? "");
}

function actionDueDates(text: string): { lineNumber: number; due: Date; line: string }[] {
  const found: { lineNumber: number; due: Date; line: string }[] = [];
  const patterns = [
    /- \[ \].*?\bdue:\s*(\d{4}-\d{2}-\d{2})/i,
    /- \[ \].*?@due\((\d{4}-\d{2}-\d{2})\)/i,
  ];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      const match = pattern.exec(line);
      const due = parseIsoDate(match?.[1]);
      if (due !== null) {
        found.push({ lineNumber: index + 1, due, line: line.trim() });
      }
    }
  });
  return found;
}

function splitFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  if (!text.startsWith("---\n")) {
    return { metadata: {}, body: text };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return { metadata: {}, body: text };
  }
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\n/, "");
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes(":") || line.startsWith(" ")) {
      continue;
    }
    const [keyPart, ...valueParts] = line.split(":");
    const key = keyPart?.trim();
    if (key !== undefined && key !== "") {
      metadata[key] = valueParts.join(":").trim().replace(/^"|"$/g, "");
    }
  }
  return { metadata, body };
}

function duplicateBullets(content: string): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const normalized = line.trim().replace(/\s+/g, " ");
    if (!normalized.startsWith("- ")) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      duplicates.add(normalized);
    } else {
      seen.add(key);
    }
  }
  return [...duplicates].sort();
}

function isEntityPage(page: WikiPage): boolean {
  const topLevelDir = page.relativePath.split(path.sep)[0];
  return (
    topLevelDir !== undefined &&
    ["people", "projects", "teams", "meetings", "decisions", "threads"].includes(topLevelDir) &&
    !skipFrontmatterCheck(page)
  );
}

function isIndexCandidate(page: WikiPage): boolean {
  if (page.relativePath === "index.md" || page.relativePath === "log.md") {
    return false;
  }
  if (
    page.relativePath.startsWith(`raw${path.sep}`) ||
    page.relativePath.startsWith(`meta${path.sep}`)
  ) {
    return false;
  }
  if (isSupersededPage(page)) {
    return false;
  }
  return true;
}

function isSupersededPage(page: WikiPage): boolean {
  return page.metadata.status?.toLowerCase() === "superseded";
}

function skipFrontmatterCheck(page: WikiPage): boolean {
  return new Set([
    "AGENTS.md",
    "CLAUDE.md",
    "index.md",
    "log.md",
    "me.md",
    "priorities.md",
    "mine.md",
    "theirs.md",
  ]).has(page.basename);
}

function indexMentionsPage(indexText: string, page: WikiPage): boolean {
  const normalized = page.relativePath.replaceAll(path.sep, "/");
  const slug = pageKey(page.basename);
  return (
    indexText.includes(normalized) ||
    indexText.includes(page.basename) ||
    wikilinks(indexText).some((link) => pageKey(path.basename(link, ".md")) === slug)
  );
}

function pageTitle(page: WikiPage): string {
  if (page.metadata.title !== undefined && page.metadata.title.trim() !== "") {
    return page.metadata.title.trim();
  }
  const heading = /^#\s+(.+)$/m.exec(page.body)?.[1]?.trim();
  if (heading !== undefined && heading !== "") {
    return heading;
  }
  return path.basename(page.basename, ".md").replace(/-/g, " ");
}

function looksOverSpecificProjectPage(page: WikiPage, title: string): boolean {
  const slug = path.basename(page.basename, ".md");
  const titleWords = title.split(/\s+/).filter(Boolean).length;
  return (
    slug.length > 72 ||
    title.length > 90 ||
    titleWords > 10 ||
    /https?:|www\.|archives\/|thread[_-]?ts|p\d{8,}/i.test(title) ||
    /\bU[A-Z0-9]{8,}\b/.test(title)
  );
}

function canonicalEntityTopics(text: string): string[] {
  const topics: string[] = [];
  for (const rule of CANONICAL_ENTITY_TOPIC_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      topics.push(rule.label);
    }
  }
  return topics;
}

const CANONICAL_ENTITY_TOPIC_PATTERNS: { label: string; patterns: RegExp[] }[] = [
  { label: "Roo Code", patterns: [/\broo\s*code\b/i, /\broocodeinc\b/i] },
  { label: "Roomote", patterns: [/\broomote\b/i, /\bnewmote\b/i] },
  { label: "Slackiness", patterns: [/\bslackiness\b/i] },
  { label: "Slack", patterns: [/\bslack\b/i] },
  { label: "Granola", patterns: [/\bgranola\b/i] },
  { label: "Notion", patterns: [/\bnotion\b/i] },
  { label: "Codex", patterns: [/\bcodex\b/i] },
  { label: "MCP", patterns: [/\bmcp\b/i] },
  { label: "Self Serve", patterns: [/\bself[- ]?serve\b/i] },
  { label: "Pricing", patterns: [/\bpricing\b/i] },
  { label: "Sentry", patterns: [/\bsentry\b/i] },
  { label: "Modal", patterns: [/\bmodal\b/i] },
  { label: "Vercel", patterns: [/\bvercel\b/i] },
  { label: "Sandbox", patterns: [/\bsandbox(?:es)?\b/i] },
  { label: "Feature Flags", patterns: [/\bfeature flags?\b/i] },
  { label: "Security", patterns: [/\bsecurity\b/i] },
  { label: "Billing", patterns: [/\bbilling\b/i] },
  { label: "Quota", patterns: [/\bquota\b/i] },
  { label: "Tokens", patterns: [/\btokens?\b/i] },
];

function pageKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseIsoDate(value: string | undefined): Date | null {
  if (value === undefined || value === "" || value === "null" || value === "None") {
    return null;
  }
  const normalized = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayUtc(): Date {
  return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function dateDiffDays(later: Date, earlier: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((later.getTime() - earlier.getTime()) / msPerDay);
}

function finding(
  severity: MaintenanceFindingSeverity,
  title: string,
  detail: string,
  location: { path?: string; line?: number; data?: JsonObject } = {},
): MaintenanceFinding {
  return {
    severity,
    title,
    detail,
    path: location.path ?? null,
    line: location.line ?? null,
    data: location.data ?? null,
  };
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
