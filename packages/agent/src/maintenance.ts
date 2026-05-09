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
  return true;
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
  location: { path?: string; line?: number } = {},
): MaintenanceFinding {
  return {
    severity,
    title,
    detail,
    path: location.path ?? null,
    line: location.line ?? null,
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
