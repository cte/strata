import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { readTextFileOrUndefined, writeTextFile } from "@strata/core";
import { frontmatter, slugify } from "./common.js";

export interface CompactWikiIndexOptions {
  repoRoot: string;
  dryRun?: boolean;
  now?: Date;
  maxDecisions?: number;
  maxThreads?: number;
}

export interface CompactWikiIndexResult {
  dryRun: boolean;
  writtenPaths: string[];
  counts: {
    people: number;
    projects: number;
    meetings: number;
    decisions: number;
    threads: number;
    omittedDecisions: number;
    omittedThreads: number;
    slackRawThreads: number;
    slackChannels: number;
  };
}

export interface ArchiveGeneratedSlackThreadsOptions {
  repoRoot: string;
  dryRun?: boolean;
  now?: Date;
  rewriteLinks?: boolean;
}

export interface ArchiveGeneratedSlackThreadsResult {
  dryRun: boolean;
  archiveDir: string;
  manifestPath: string | null;
  scanned: number;
  archived: number;
  kept: number;
  missingRawSources: number;
  rewrittenFiles: number;
  rewrittenLinks: number;
}

interface PageEntry {
  path: string;
  title: string;
  date: string | null;
}

interface GeneratedSlackThreadPage {
  path: string;
  archivePath: string;
  rawPath: string | null;
  title: string;
}

interface SlackChannelSummary {
  channel: string;
  count: number;
  lastDate: string;
}

const DEFAULT_MAX_DECISIONS = 250;
const DEFAULT_MAX_THREADS = 250;

export async function compactWikiIndex(
  options: CompactWikiIndexOptions,
): Promise<CompactWikiIndexResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const maxDecisions = options.maxDecisions ?? DEFAULT_MAX_DECISIONS;
  const maxThreads = options.maxThreads ?? DEFAULT_MAX_THREADS;

  const people = await listSectionPages(repoRoot, "people", { sort: "title" });
  const projects = await listSectionPages(repoRoot, "projects", { sort: "title" });
  const meetings = await listSectionPages(repoRoot, "meetings", { sort: "date-desc" });
  const decisionsAll = await listSectionPages(repoRoot, "decisions", { sort: "date-desc" });
  const threadsAll = await listSectionPages(repoRoot, "threads", {
    sort: "date-desc",
    filter: (text) => !isGeneratedSourceThread(text),
  });
  const decisions = decisionsAll.slice(0, maxDecisions);
  const threads = threadsAll.slice(0, maxThreads);
  const slack = await summarizeSlackRaw(repoRoot);

  const indexContent = formatRootIndex({
    now,
    people,
    projects,
    meetings,
    decisions,
    threads,
    omittedDecisions: Math.max(0, decisionsAll.length - decisions.length),
    omittedThreads: Math.max(0, threadsAll.length - threads.length),
    slack,
  });
  const sourcesIndex = formatSourcesIndex(now, slack);
  const slackIndex = formatSlackSourceIndex(now, slack);

  const writes = [
    { path: "wiki/index.md", content: indexContent },
    { path: "wiki/sources/index.md", content: sourcesIndex },
    { path: "wiki/sources/slack/index.md", content: slackIndex },
  ];
  const writtenPaths: string[] = [];
  if (!dryRun) {
    for (const write of writes) {
      const absolutePath = path.join(repoRoot, write.path);
      const existing = await readTextFileOrUndefined(absolutePath);
      if (existing !== write.content) {
        await writeTextFile(absolutePath, write.content);
        writtenPaths.push(write.path);
      }
    }
    if (writtenPaths.length > 0) {
      await appendWikiLog(
        repoRoot,
        now,
        "maintain",
        `Compacted root index and source indexes (${slack.rawThreads} Slack raw threads)`,
      );
      writtenPaths.push("wiki/log.md");
    }
  } else {
    writtenPaths.push(...writes.map((write) => write.path));
  }

  return {
    dryRun,
    writtenPaths,
    counts: {
      people: people.length,
      projects: projects.length,
      meetings: meetings.length,
      decisions: decisions.length,
      threads: threads.length,
      omittedDecisions: Math.max(0, decisionsAll.length - decisions.length),
      omittedThreads: Math.max(0, threadsAll.length - threads.length),
      slackRawThreads: slack.rawThreads,
      slackChannels: slack.channels.length,
    },
  };
}

export async function archiveGeneratedSlackThreads(
  options: ArchiveGeneratedSlackThreadsOptions,
): Promise<ArchiveGeneratedSlackThreadsResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const dryRun = options.dryRun ?? false;
  const rewriteLinks = options.rewriteLinks ?? true;
  const now = options.now ?? new Date();
  const archiveDir = path.join(
    ".strata",
    "archive",
    "generated-slack-threads",
    archiveTimestamp(now),
  );

  const { scanned, pages } = await collectGeneratedSlackThreadPages(repoRoot, archiveDir);
  const pageMap = new Map(
    pages.map((page) => [page.path.replace(/^wiki\//, "").replace(/\.md$/, ""), page]),
  );
  const rewrite = rewriteLinks
    ? await rewriteGeneratedSlackThreadLinks(repoRoot, pageMap, dryRun)
    : { rewrittenFiles: 0, rewrittenLinks: 0 };

  if (!dryRun) {
    for (const page of pages) {
      const sourcePath = path.join(repoRoot, page.path);
      const targetPath = path.join(repoRoot, page.archivePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await rename(sourcePath, targetPath);
    }
    const manifestPath = path.join(archiveDir, "manifest.json");
    await writeTextFile(
      path.join(repoRoot, manifestPath),
      `${JSON.stringify(
        {
          archivedAt: now.toISOString(),
          archived: pages.length,
          rewrittenFiles: rewrite.rewrittenFiles,
          rewrittenLinks: rewrite.rewrittenLinks,
          pages,
        },
        null,
        2,
      )}\n`,
    );
    if (pages.length > 0 || rewrite.rewrittenLinks > 0) {
      await appendWikiLog(
        repoRoot,
        now,
        "maintain",
        `Archived ${pages.length} generated Slack thread pages and rewrote ${rewrite.rewrittenLinks} links`,
      );
    }
  }

  return {
    dryRun,
    archiveDir,
    manifestPath: dryRun ? null : path.join(archiveDir, "manifest.json"),
    scanned,
    archived: pages.length,
    kept: scanned - pages.length,
    missingRawSources: pages.filter((page) => page.rawPath === null).length,
    rewrittenFiles: rewrite.rewrittenFiles,
    rewrittenLinks: rewrite.rewrittenLinks,
  };
}

async function collectGeneratedSlackThreadPages(
  repoRoot: string,
  archiveDir: string,
): Promise<{ scanned: number; pages: GeneratedSlackThreadPage[] }> {
  const threadsDir = path.join(repoRoot, "wiki", "threads");
  await mkdir(threadsDir, { recursive: true });
  const entries = await readdir(threadsDir, { withFileTypes: true });
  let scanned = 0;
  const pages: GeneratedSlackThreadPage[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) {
      continue;
    }
    scanned += 1;
    const relativePath = path.join("wiki", "threads", entry.name);
    const text = await readFile(path.join(repoRoot, relativePath), "utf8");
    if (!isGeneratedSourceThread(text)) {
      continue;
    }
    pages.push({
      path: relativePath,
      archivePath: path.join(archiveDir, relativePath),
      rawPath: extractRawSlackSourcePath(text),
      title: firstHeading(text) ?? titleFromFilename(entry.name),
    });
  }
  return { scanned, pages };
}

async function rewriteGeneratedSlackThreadLinks(
  repoRoot: string,
  pageMap: Map<string, GeneratedSlackThreadPage>,
  dryRun: boolean,
): Promise<{ rewrittenFiles: number; rewrittenLinks: number }> {
  const files = await listWikiMarkdownFiles(repoRoot);
  const generatedPaths = new Set([...pageMap.values()].map((page) => page.path));
  let rewrittenFiles = 0;
  let rewrittenLinks = 0;

  for (const filePath of files) {
    if (filePath.startsWith(path.join("wiki", "raw") + path.sep) || generatedPaths.has(filePath)) {
      continue;
    }
    const absolutePath = path.join(repoRoot, filePath);
    const text = await readFile(absolutePath, "utf8");
    let fileLinkCount = 0;
    const next = text.replace(
      /\[\[threads\/([^|\]\n]+)(?:\|([^\n]*?))?\]\]/g,
      (match, slug: string, label: string | undefined) => {
        const page = pageMap.get(`threads/${slug}`);
        if (page === undefined) {
          return match;
        }
        fileLinkCount += 1;
        if (page.rawPath === null) {
          return label ?? page.title;
        }
        const rawTarget = page.rawPath.replace(/^wiki\//, "").replace(/\.md$/, "");
        return `[[${rawTarget}|${label ?? page.title}]]`;
      },
    );
    if (fileLinkCount === 0) {
      continue;
    }
    rewrittenFiles += 1;
    rewrittenLinks += fileLinkCount;
    if (!dryRun) {
      await writeTextFile(absolutePath, next);
    }
  }
  return { rewrittenFiles, rewrittenLinks };
}

async function listSectionPages(
  repoRoot: string,
  section: string,
  options: {
    sort: "date-desc" | "title";
    filter?: (text: string, relativePath: string) => boolean;
  },
): Promise<PageEntry[]> {
  const dir = path.join(repoRoot, "wiki", section);
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  const pages: PageEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) {
      continue;
    }
    const relativePath = `wiki/${section}/${entry.name}`;
    const text = await readFile(path.join(dir, entry.name), "utf8");
    if (options.filter && !options.filter(text, relativePath)) {
      continue;
    }
    const metadata = parseSimpleFrontmatter(text);
    pages.push({
      path: relativePath,
      title: metadata.title || metadata.name || firstHeading(text) || titleFromFilename(entry.name),
      date: metadata.date || dateFromFilename(entry.name),
    });
  }
  return pages.sort((left, right) => {
    if (options.sort === "title") {
      return left.title.localeCompare(right.title) || left.path.localeCompare(right.path);
    }
    const leftDate = left.date ?? "";
    const rightDate = right.date ?? "";
    return rightDate.localeCompare(leftDate) || right.path.localeCompare(left.path);
  });
}

async function summarizeSlackRaw(repoRoot: string): Promise<{
  rawThreads: number;
  channels: SlackChannelSummary[];
}> {
  const rawDir = path.join(repoRoot, "wiki", "raw", "slack");
  await mkdir(rawDir, { recursive: true });
  const entries = await readdir(rawDir, { withFileTypes: true });
  const byChannel = new Map<string, SlackChannelSummary>();
  let rawThreads = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.startsWith(".")) {
      continue;
    }
    rawThreads += 1;
    const text = await readFile(path.join(rawDir, entry.name), "utf8");
    const metadata = parseSimpleFrontmatter(text);
    const channel = metadata.channel || "unknown";
    const date = metadata.date || dateFromFilename(entry.name) || "unknown";
    const current = byChannel.get(channel) ?? { channel, count: 0, lastDate: date };
    current.count += 1;
    if (date > current.lastDate) {
      current.lastDate = date;
    }
    byChannel.set(channel, current);
  }
  const channels = [...byChannel.values()].sort(
    (left, right) => right.count - left.count || left.channel.localeCompare(right.channel),
  );
  return { rawThreads, channels };
}

function formatRootIndex(input: {
  now: Date;
  people: PageEntry[];
  projects: PageEntry[];
  meetings: PageEntry[];
  decisions: PageEntry[];
  threads: PageEntry[];
  omittedDecisions: number;
  omittedThreads: number;
  slack: { rawThreads: number; channels: SlackChannelSummary[] };
}): string {
  return [
    frontmatter({
      type: "index",
      last_updated: input.now.toISOString().slice(0, 10),
    }).trimEnd(),
    "",
    "# Strata Index",
    "",
    "## Core",
    "",
    "- [[priorities|Priorities]]",
    "- [[me|Me]]",
    "- [[actions/mine|Actions I Own]]",
    "- [[actions/theirs|Actions Others Own]]",
    "- [[sources/index|Source Indexes]]",
    "",
    "## People",
    "",
    formatEntries(input.people),
    "",
    "## Projects",
    "",
    formatEntries(input.projects),
    "",
    "## Meetings",
    "",
    formatEntries(input.meetings),
    "",
    "## Decisions",
    "",
    formatEntries(input.decisions),
    formatOmittedLine(input.omittedDecisions, "older decisions"),
    "",
    "## Threads",
    "",
    formatEntries(input.threads),
    formatOmittedLine(input.omittedThreads, "older curated threads"),
    "",
    "## Source Coverage",
    "",
    `- Slack raw threads: ${input.slack.rawThreads}`,
    `- Slack channels: ${input.slack.channels.length}`,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function formatSourcesIndex(
  now: Date,
  slack: { rawThreads: number; channels: SlackChannelSummary[] },
): string {
  return [
    frontmatter({
      type: "source_index",
      last_updated: now.toISOString().slice(0, 10),
    }).trimEnd(),
    "",
    "# Source Indexes",
    "",
    "## Raw Sources",
    "",
    "- [[sources/slack/index|Slack]]",
    "- [[raw/granola|Granola raw snapshots]]",
    "- [[raw/notion|Notion raw snapshots]]",
    "",
    "## Coverage",
    "",
    `- Slack raw threads: ${slack.rawThreads}`,
    `- Slack channels: ${slack.channels.length}`,
    "",
  ].join("\n");
}

function formatSlackSourceIndex(
  now: Date,
  slack: { rawThreads: number; channels: SlackChannelSummary[] },
): string {
  return [
    frontmatter({
      type: "slack_source_index",
      source: "slack",
      last_updated: now.toISOString().slice(0, 10),
    }).trimEnd(),
    "",
    "# Slack Source Index",
    "",
    "## Coverage",
    "",
    `- Raw threads: ${slack.rawThreads}`,
    `- Channels: ${slack.channels.length}`,
    "",
    "## Channels",
    "",
    slack.channels.length === 0
      ? "- No Slack raw snapshots indexed yet."
      : slack.channels
          .map((channel) => {
            return `- \`${channel.channel}\`: ${channel.count} raw threads, last ${channel.lastDate}`;
          })
          .join("\n"),
    "",
  ].join("\n");
}

function formatEntries(entries: PageEntry[]): string {
  if (entries.length === 0) {
    return "- None indexed.";
  }
  return entries.map((entry) => `- ${wikiLink(entry.path, entry.title)}`).join("\n");
}

function formatOmittedLine(count: number, label: string): string | null {
  return count > 0 ? `- ${count} ${label} omitted from the root index; use wiki search.` : null;
}

function isGeneratedSourceThread(text: string): boolean {
  return (
    text.includes("Automatically opened from source indexing.") ||
    /^\s*source:\s*raw\/slack\//m.test(text) ||
    text.includes("Raw source: [raw/slack/") ||
    text.includes("(../raw/slack/")
  );
}

function extractRawSlackSourcePath(text: string): string | null {
  const frontmatterSource = /^\s*source:\s*"?([^"\n#]+)"?\s*$/m.exec(text)?.[1];
  const rawSourceLine = /Raw source:\s*\[(raw\/slack\/[^\]\s]+\.md)\]/.exec(text)?.[1];
  const rawLink = /\(\.\.\/(raw\/slack\/[^)\s]+\.md)\)/.exec(text)?.[1];
  return normalizeRawSlackSourcePath(frontmatterSource ?? rawSourceLine ?? rawLink ?? "");
}

function normalizeRawSlackSourcePath(value: string): string | null {
  const normalized = value.trim().replace(/^"|"$/g, "");
  const wikiRelative = normalized.startsWith("wiki/")
    ? normalized.slice("wiki/".length)
    : normalized;
  if (!wikiRelative.startsWith("raw/slack/") || !wikiRelative.endsWith(".md")) {
    return null;
  }
  if (wikiRelative.includes("..")) {
    return null;
  }
  return `wiki/${wikiRelative}`;
}

async function listWikiMarkdownFiles(repoRoot: string): Promise<string[]> {
  const wikiRoot = path.join(repoRoot, "wiki");
  await mkdir(wikiRoot, { recursive: true });
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".gitkeep") {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(repoRoot, absolutePath);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(relativePath);
      }
    }
  }
  await walk(wikiRoot);
  return files.sort();
}

function archiveTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[:-]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

async function appendWikiLog(
  repoRoot: string,
  now: Date,
  op: string,
  title: string,
): Promise<void> {
  const logPath = path.join(repoRoot, "wiki", "log.md");
  const existing = await readTextFileOrUndefined(logPath);
  const base = existing ?? "# Strata - Activity Log\n";
  const timestamp = now.toISOString().slice(0, 16).replace("T", " ");
  const entry = `\n\n## [${timestamp}] ${op} | ${title}\n`;
  await writeTextFile(logPath, `${base.trimEnd()}${entry}`);
}

function parseSimpleFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---\n")) {
    return {};
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return {};
  }
  const metadata: Record<string, string> = {};
  for (const rawLine of text.slice(4, end).split(/\r?\n/)) {
    if (rawLine.startsWith(" ") || !rawLine.includes(":")) {
      continue;
    }
    const [keyPart, ...valueParts] = rawLine.split(":");
    const key = keyPart?.trim();
    if (key) {
      metadata[key] = valueParts.join(":").trim().replace(/^"|"$/g, "");
    }
  }
  return metadata;
}

function firstHeading(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function titleFromFilename(filename: string): string {
  return slugify(path.basename(filename, ".md"), "untitled").replace(/-/g, " ");
}

function dateFromFilename(filename: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(filename);
  return match?.[1] ?? null;
}

function wikiLink(repoRelativePath: string, label: string): string {
  const wikiRelativePath = repoRelativePath.replace(/^wiki\//, "").replace(/\.md$/, "");
  return `[[${wikiRelativePath}|${label}]]`;
}
