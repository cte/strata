import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractionSourceKind, ExtractionSourceType, WikiCorpusDocument } from "./types.js";

export interface ResolveDailyTodoCorpusOptions {
  repoRoot: string;
  day: string;
  paths?: string[];
  limit?: number;
}

interface ParsedFrontmatter {
  scalars: Record<string, string>;
}

const DEFAULT_CORPUS_DIRS = [
  path.join("wiki", "raw", "slack"),
  path.join("wiki", "raw", "granola"),
  path.join("wiki", "raw", "notion"),
  path.join("wiki", "sources", "slack"),
  path.join("wiki", "sources", "granola"),
  path.join("wiki", "sources", "notion"),
  path.join("wiki", "meetings"),
];

export async function resolveDailyTodoCorpus(
  options: ResolveDailyTodoCorpusOptions,
): Promise<WikiCorpusDocument[]> {
  assertIsoDay(options.day);
  const repoRoot = path.resolve(options.repoRoot);
  const candidatePaths =
    options.paths === undefined
      ? await listDefaultCorpusPaths(repoRoot)
      : options.paths.map((item) => normalizeRepoPath(repoRoot, item));
  const documents: WikiCorpusDocument[] = [];
  for (const relativePath of candidatePaths.sort()) {
    if (shouldSkipPath(relativePath)) {
      continue;
    }
    const absolutePath = path.join(repoRoot, relativePath);
    const text = await readFile(absolutePath, "utf8");
    const parsed = parseFrontmatter(text);
    const date = documentDate(relativePath, parsed);
    if (date !== options.day) {
      continue;
    }
    const kind = sourceKindForPath(relativePath);
    const sourceType = sourceTypeForPathAndFrontmatter(relativePath, parsed);
    const extractedBody = extractBody(text);
    documents.push({
      path: relativePath,
      sourceKind: kind,
      sourceType,
      date,
      title: parsed.scalars.title || firstHeading(text) || path.basename(relativePath, ".md"),
      body: extractedBody.body,
      bodyLineStart: extractedBody.lineStart,
      frontmatter: parsed.scalars,
    });
    if (documents.length >= (options.limit ?? Number.POSITIVE_INFINITY)) {
      break;
    }
  }
  return documents;
}

async function listDefaultCorpusPaths(repoRoot: string): Promise<string[]> {
  const paths: string[] = [];
  for (const dir of DEFAULT_CORPUS_DIRS) {
    paths.push(...(await listMarkdownFiles(path.join(repoRoot, dir), dir)));
  }
  return paths;
}

async function listMarkdownFiles(absoluteDir: string, relativeDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listMarkdownFiles(path.join(absoluteDir, entry.name), relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      paths.push(relativePath);
    }
  }
  return paths;
}

function normalizeRepoPath(repoRoot: string, inputPath: string): string {
  const absolute = path.resolve(repoRoot, inputPath);
  const relative = path.relative(repoRoot, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Extraction corpus path must be inside the repo: ${inputPath}`);
  }
  if (!relative.endsWith(".md")) {
    throw new Error(`Extraction corpus path must be a Markdown file: ${inputPath}`);
  }
  return relative;
}

function shouldSkipPath(relativePath: string): boolean {
  if (relativePath === path.join("wiki", "log.md")) {
    return true;
  }
  return (
    relativePath.startsWith(path.join("wiki", "actions") + path.sep) ||
    relativePath.endsWith(path.join("sources", "slack", "index.md")) ||
    relativePath.endsWith(path.join("sources", "index.md"))
  );
}

function sourceKindForPath(relativePath: string): ExtractionSourceKind {
  if (relativePath.startsWith(path.join("wiki", "raw") + path.sep)) {
    return "raw";
  }
  if (relativePath.startsWith(path.join("wiki", "sources") + path.sep)) {
    return "source";
  }
  return "curated";
}

function sourceTypeForPathAndFrontmatter(
  relativePath: string,
  parsed: ParsedFrontmatter,
): ExtractionSourceType {
  const source = (parsed.scalars.source_type || parsed.scalars.source || "").toLowerCase();
  const type = (parsed.scalars.type || "").toLowerCase();
  if (source.includes("slack") || type.includes("slack") || pathHasPart(relativePath, "slack")) {
    return "slack";
  }
  if (
    source.includes("granola") ||
    type.includes("granola") ||
    pathHasPart(relativePath, "granola")
  ) {
    return "granola";
  }
  if (source.includes("notion") || type.includes("notion") || pathHasPart(relativePath, "notion")) {
    return "notion";
  }
  return "wiki";
}

function documentDate(relativePath: string, parsed: ParsedFrontmatter): string | null {
  return (
    normalizeDate(parsed.scalars.date) ??
    normalizeDate(parsed.scalars.last_updated) ??
    normalizeDate(parsed.scalars.indexed_at) ??
    normalizeDate(parsed.scalars.pulled_at) ??
    dateFromSourcePath(parsed.scalars.source) ??
    dateFromPath(relativePath)
  );
}

function parseFrontmatter(text: string): ParsedFrontmatter {
  if (!text.startsWith("---\n")) {
    return { scalars: {} };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return { scalars: {} };
  }
  const scalars: Record<string, string> = {};
  for (const rawLine of text.slice(4, end).split(/\r?\n/)) {
    if (rawLine.startsWith(" ") || rawLine.trim().startsWith("-")) {
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(rawLine.trimEnd());
    if (!match) {
      continue;
    }
    const key = match[1] ?? "";
    const value = unquoteYaml(match[2] ?? "");
    if (value !== "" && value !== "[]") {
      scalars[key] = value;
    }
  }
  return { scalars };
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+)$/m.exec(body);
  return match?.[1]?.trim() || null;
}

function extractBody(text: string): { body: string; lineStart: number } {
  const lines = text.split(/\r?\n/);
  let lineStart = 1;
  let bodyLines = lines;
  if (lines[0] === "---") {
    const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
    if (endIndex !== -1) {
      bodyLines = lines.slice(endIndex + 1);
      lineStart = endIndex + 2;
    }
  }
  while ((bodyLines[0] ?? "").trim() === "") {
    bodyLines = bodyLines.slice(1);
    lineStart += 1;
  }
  if (/^#\s+/.test(bodyLines[0] ?? "") && (bodyLines[1] ?? "").trim() === "") {
    bodyLines = bodyLines.slice(2);
    lineStart += 2;
  }
  while ((bodyLines[0] ?? "").trim() === "") {
    bodyLines = bodyLines.slice(1);
    lineStart += 1;
  }
  return { body: bodyLines.join("\n").trimEnd(), lineStart };
}

function unquoteYaml(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "null" || trimmed === "~") {
    return "";
  }
  return trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function dateFromSourcePath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return dateFromPath(value);
}

function dateFromPath(value: string): string | null {
  const match = /(?:^|[/-])(\d{4}-\d{2}-\d{2})(?:[-/]|$)/.exec(value);
  return match?.[1] ?? null;
}

function pathHasPart(relativePath: string, part: string): boolean {
  return relativePath.split(path.sep).includes(part);
}

function assertIsoDay(day: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Extraction day must be YYYY-MM-DD: ${day}`);
  }
}
