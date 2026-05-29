import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { SessionStore } from "./sessionStore.js";
import type { JsonObject } from "./types.js";

export type WikiSearchIndexSource = "all" | "granola" | "notion" | "slack";

export interface RefreshWikiSearchIndexOptions {
  repoRoot: string;
  source?: WikiSearchIndexSource;
  includeRaw?: boolean;
  now?: Date;
}

export interface RefreshWikiSearchIndexResult {
  indexed: number;
  curated: number;
  raw: number;
  sources: number;
}

export interface SearchWikiIndexOptions {
  repoRoot: string;
  query: string;
  root?: string;
  includeRaw?: boolean;
  limit?: number;
}

export interface WikiSearchIndexMatch extends JsonObject {
  path: string;
  line: number;
  preview: string;
  title: string;
  kind: string;
  source: string | null;
  score: number;
}

interface WikiSearchDocument {
  path: string;
  title: string;
  body: string;
  kind: string;
  source: string | null;
  mtimeMs: number;
  size: number;
}

interface SearchRow {
  path: string;
  title: string;
  kind: string;
  source: string | null;
  score: number;
}

const WIKI_DIR = "wiki";
const RAW_PREFIX = "raw/";
const SOURCE_PREFIX = "sources/";
const SEARCH_FETCH_LIMIT = 1000;

export async function refreshWikiSearchIndex(
  options: RefreshWikiSearchIndexOptions,
): Promise<RefreshWikiSearchIndexResult> {
  const repoRoot = path.resolve(options.repoRoot);
  const source = options.source ?? "all";
  const includeRaw = options.includeRaw ?? true;
  const wikiRoot = path.join(repoRoot, WIKI_DIR);
  await mkdir(wikiRoot, { recursive: true });

  const store = await SessionStore.open(repoRoot);
  try {
    ensureWikiSearchIndexSchema(store.db);
    store.db.run("PRAGMA busy_timeout = 10000");

    const docs = await collectWikiSearchDocuments({
      wikiRoot,
      includeRaw,
      source,
    });

    const insertDoc = store.db.prepare(`
      insert into wiki_search_docs
        (path, kind, source, title, mtime_ms, size, indexed_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = store.db.prepare(`
      insert into wiki_search_docs_fts (path, title, body)
      values (?, ?, ?)
    `);
    const indexedAt = (options.now ?? new Date()).toISOString();

    store.db.run("begin");
    try {
      store.db.run("delete from wiki_search_docs_fts");
      store.db.run("delete from wiki_search_docs");
      for (const doc of docs) {
        insertDoc.run(doc.path, doc.kind, doc.source, doc.title, doc.mtimeMs, doc.size, indexedAt);
        insertFts.run(doc.path, doc.title, doc.body);
      }
      store.db.run("commit");
    } catch (cause) {
      store.db.run("rollback");
      throw cause;
    }

    return {
      indexed: docs.length,
      curated: docs.filter((doc) => doc.kind === "curated").length,
      raw: docs.filter((doc) => doc.kind === "raw").length,
      sources: docs.filter((doc) => doc.kind === "source").length,
    };
  } finally {
    store.close();
  }
}

export async function searchWikiSearchIndex(
  options: SearchWikiIndexOptions,
): Promise<WikiSearchIndexMatch[] | null> {
  const repoRoot = path.resolve(options.repoRoot);
  const stateDbPath = path.join(repoRoot, ".strata", "state.sqlite");
  if (!existsSync(stateDbPath)) {
    return null;
  }

  const query = options.query.trim();
  if (query === "") {
    return [];
  }

  const fts = ftsQuery(query);
  if (fts === null) {
    return null;
  }

  const store = await SessionStore.open(repoRoot);
  try {
    ensureWikiSearchIndexSchema(store.db);
    store.db.run("PRAGMA busy_timeout = 5000");
    const count = store.db
      .query<{ count: number }, []>("select count(*) as count from wiki_search_docs")
      .get()?.count;
    if (!count) {
      return null;
    }

    const root = normalizeSearchRoot(options.root ?? ".");
    const includeRaw = options.includeRaw ?? false;
    const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));
    const rows = searchRows(store, fts, includeRaw, Math.max(SEARCH_FETCH_LIMIT, limit * 20));
    const terms = queryTerms(query);
    const filtered = rows
      .filter((row) => matchesRoot(row.path, root))
      .sort((left, right) => {
        const rankDelta = wikiSearchRank(left, terms) - wikiSearchRank(right, terms);
        return rankDelta === 0 ? left.score - right.score : rankDelta;
      })
      .slice(0, limit);

    const wikiRoot = path.join(repoRoot, WIKI_DIR);
    const matches: WikiSearchIndexMatch[] = [];
    for (const row of filtered) {
      const preview = await previewForMatch(path.join(wikiRoot, row.path), terms);
      matches.push({
        path: row.path,
        line: preview.line,
        preview: preview.preview,
        title: row.title,
        kind: row.kind,
        source: row.source,
        score: row.score,
      });
    }
    return matches;
  } finally {
    store.close();
  }
}

function searchRows(
  store: SessionStore,
  fts: string,
  includeRaw: boolean,
  fetchLimit: number,
): SearchRow[] {
  const statement = store.db.query<SearchRow, [string, number, number]>(`
    select
      docs.path as path,
      docs.title as title,
      docs.kind as kind,
      docs.source as source,
      bm25(wiki_search_docs_fts) as score
    from wiki_search_docs_fts
    join wiki_search_docs docs on docs.path = wiki_search_docs_fts.path
    where wiki_search_docs_fts match ?
      and (? = 1 or docs.kind != 'raw')
    order by
      case docs.kind
        when 'curated' then 0
        when 'source' then 35
        else 90
      end asc,
      score asc
    limit ?
  `);
  return statement.all(fts, includeRaw ? 1 : 0, fetchLimit);
}

function ensureWikiSearchIndexSchema(db: SessionStore["db"]): void {
  db.run(`
    create table if not exists wiki_search_docs (
      path text primary key not null,
      kind text not null,
      source text,
      title text not null,
      mtime_ms real not null,
      size integer not null,
      indexed_at text not null
    )
  `);
  db.run(`
    create virtual table if not exists wiki_search_docs_fts
    using fts5(path unindexed, title, body, tokenize = 'unicode61')
  `);
  db.run("create index if not exists wiki_search_docs_kind_idx on wiki_search_docs(kind)");
  db.run("create index if not exists wiki_search_docs_source_idx on wiki_search_docs(source)");
}

async function collectWikiSearchDocuments(options: {
  wikiRoot: string;
  includeRaw: boolean;
  source: WikiSearchIndexSource;
}): Promise<WikiSearchDocument[]> {
  const files = await listMarkdownFiles(options.wikiRoot);
  const docs: WikiSearchDocument[] = [];
  for (const relativePath of files) {
    if (!shouldIndexPath(relativePath, options)) {
      continue;
    }
    const absolutePath = path.join(options.wikiRoot, relativePath);
    const file = await stat(absolutePath);
    const text = await readFile(absolutePath, "utf8");
    const metadata = parseSimpleFrontmatter(text);
    if (isSupersededPage(metadata)) {
      continue;
    }
    docs.push({
      path: relativePath,
      title: metadata.title || firstHeading(text) || titleFromPath(relativePath),
      body: stripFrontmatter(text),
      kind: documentKind(relativePath, text),
      source: documentSource(relativePath, metadata),
      mtimeMs: file.mtimeMs,
      size: file.size,
    });
  }
  return docs;
}

async function listMarkdownFiles(wikiRoot: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".gitkeep") {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(wikiRoot, absolutePath));
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile() && relativePath.endsWith(".md")) {
        files.push(relativePath);
      }
    }
  }
  await walk(wikiRoot);
  return files;
}

function shouldIndexPath(
  relativePath: string,
  options: { includeRaw: boolean; source: WikiSearchIndexSource },
): boolean {
  if (!relativePath.endsWith(".md")) {
    return false;
  }
  if (relativePath.startsWith(RAW_PREFIX)) {
    if (!options.includeRaw) {
      return false;
    }
    return options.source === "all" || relativePath.startsWith(`raw/${options.source}/`);
  }
  if (relativePath.startsWith(SOURCE_PREFIX) && options.source !== "all") {
    return relativePath.startsWith(`sources/${options.source}/`);
  }
  return true;
}

function documentKind(relativePath: string, text: string): string {
  if (relativePath.startsWith(RAW_PREFIX)) {
    return "raw";
  }
  if (relativePath.startsWith(SOURCE_PREFIX)) {
    return "source";
  }
  if (relativePath.startsWith("threads/") && isGeneratedSourceThread(text)) {
    return "source";
  }
  return "curated";
}

function documentSource(relativePath: string, metadata: Record<string, string>): string | null {
  if (relativePath.startsWith("raw/granola/") || relativePath.startsWith("sources/granola/")) {
    return "granola";
  }
  if (relativePath.startsWith("raw/notion/") || relativePath.startsWith("sources/notion/")) {
    return "notion";
  }
  if (relativePath.startsWith("raw/slack/") || relativePath.startsWith("sources/slack/")) {
    return "slack";
  }
  if (metadata.source?.startsWith("raw/granola/")) {
    return "granola";
  }
  if (metadata.source?.startsWith("raw/notion/")) {
    return "notion";
  }
  if (metadata.source?.startsWith("raw/slack/")) {
    return "slack";
  }
  return metadata.source || null;
}

function isSupersededPage(metadata: Record<string, string>): boolean {
  return metadata.status?.toLowerCase() === "superseded";
}

function isGeneratedSourceThread(text: string): boolean {
  return (
    text.includes("Automatically opened from source indexing.") ||
    /^\s*source:\s*raw\/slack\//m.test(text) ||
    text.includes("Raw source: [raw/slack/") ||
    text.includes("(../raw/slack/")
  );
}

function wikiSearchRank(row: Pick<SearchRow, "kind" | "path" | "title">, terms: string[]): number {
  if (row.kind === "raw") {
    return 90;
  }
  if (row.kind === "source") {
    return 35;
  }
  const topLevel = row.path.split("/")[0] ?? "";
  if (topLevel === "projects") {
    return titleOrPathContainsAllTerms(row, terms) ? 0 : 2;
  }
  if (topLevel === "threads") {
    return 8;
  }
  if (topLevel === "decisions") {
    return 10;
  }
  if (topLevel === "meetings") {
    return 12;
  }
  if (topLevel === "people" || topLevel === "teams" || topLevel === "actions") {
    return 16;
  }
  if (["priorities.md", "me.md", "index.md"].includes(row.path)) {
    return 10;
  }
  if (row.path === "log.md") {
    return 40;
  }
  return 20;
}

function titleOrPathContainsAllTerms(
  row: Pick<SearchRow, "path" | "title">,
  terms: string[],
): boolean {
  if (terms.length === 0) {
    return false;
  }
  const haystack = `${row.title}\n${row.path}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function normalizeSearchRoot(root: string): string {
  const normalized = toPosix(root.replace(/^wiki\/?/, "").replace(/^\/+/, "")).replace(/\/+$/, "");
  return normalized === "" ? "." : normalized;
}

function matchesRoot(relativePath: string, root: string): boolean {
  if (root === ".") {
    return true;
  }
  if (root.endsWith(".md")) {
    return relativePath === root;
  }
  return relativePath === root || relativePath.startsWith(`${root}/`);
}

function ftsQuery(query: string): string | null {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" AND ");
}

function queryTerms(query: string): string[] {
  return [...query.toLowerCase().matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)]
    .map((match) => match[0]?.replace(/^-+|-+$/g, "") ?? "")
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

async function previewForMatch(
  absolutePath: string,
  terms: string[],
): Promise<{ line: number; preview: string }> {
  const text = await readFile(absolutePath, "utf8");
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const lower = line.toLowerCase();
    if (normalizedTerms.some((term) => lower.includes(term))) {
      return { line: index + 1, preview: line.trim().slice(0, 240) };
    }
  }
  return {
    line: 1,
    preview: (lines.find((line) => line.trim() !== "") ?? "").trim().slice(0, 240),
  };
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

function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) {
    return text;
  }
  const end = text.indexOf("\n---", 4);
  return end === -1 ? text : text.slice(end + 4).replace(/^\n/, "");
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

function titleFromPath(relativePath: string): string {
  return path.basename(relativePath, ".md").replace(/-/g, " ");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
