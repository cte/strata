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
  chunks: number;
  links: number;
}

export interface SearchWikiIndexOptions {
  repoRoot: string;
  query: string;
  root?: string;
  includeRaw?: boolean;
  limit?: number;
}

export interface RetrieveWikiContextOptions {
  repoRoot: string;
  query: string;
  root?: string;
  includeRaw?: boolean;
  limit?: number;
  tokenBudget?: number;
  includeRelated?: boolean;
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

export interface WikiRetrievalMatch extends JsonObject {
  path: string;
  title: string;
  heading: string;
  startLine: number;
  endLine: number;
  kind: string;
  source: string | null;
  relation: string;
  score: number;
  estimatedTokens: number;
  text: string;
}

export interface WikiRetrievalResult extends JsonObject {
  indexed: boolean;
  strategy: "hybrid";
  query: string;
  matches: WikiRetrievalMatch[];
  count: number;
  tokenBudget: number;
  estimatedTokens: number;
  diagnostics: JsonObject;
}

export interface WikiSearchIndexStatus extends JsonObject {
  indexed: boolean;
  schema: "missing" | "outdated" | "current";
  lastIndexedAt: string | null;
  documents: {
    total: number;
    curated: number;
    sources: number;
    raw: number;
  };
  chunks: number;
  links: number;
  byKind: Array<{ name: string; count: number }>;
  bySource: Array<{ name: string; count: number }>;
}

interface WikiSearchDocument {
  path: string;
  title: string;
  body: string;
  bodyStartLine: number;
  kind: string;
  source: string | null;
  mtimeMs: number;
  size: number;
}

interface WikiSearchChunk {
  id: string;
  path: string;
  chunkIndex: number;
  title: string;
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
  kind: string;
  source: string | null;
}

interface WikiSearchLink {
  fromPath: string;
  toPath: string;
  label: string;
  kind: string;
}

interface SearchRow {
  path: string;
  title: string;
  kind: string;
  source: string | null;
  score: number;
}

interface ChunkRow {
  id: string;
  path: string;
  chunkIndex: number;
  title: string;
  heading: string;
  body: string;
  startLine: number;
  endLine: number;
  kind: string;
  source: string | null;
  score: number;
}

interface RankedChunk {
  row: ChunkRow;
  relation: string;
  score: number;
  keywordRank: number | null;
  lexicalRank: number | null;
  titleRank: number | null;
}

const WIKI_DIR = "wiki";
const RAW_PREFIX = "raw/";
const SOURCE_PREFIX = "sources/";
const SEARCH_FETCH_LIMIT = 1000;
const RETRIEVAL_FETCH_LIMIT = 2000;
const RETRIEVAL_SCAN_LIMIT = 8000;
const CHUNK_TARGET_CHARS = 1800;
const CHUNK_MAX_LINES = 45;
const DEFAULT_RETRIEVAL_LIMIT = 12;
const DEFAULT_TOKEN_BUDGET = 4000;
const RRF_K = 60;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "because",
  "been",
  "before",
  "being",
  "between",
  "but",
  "can",
  "could",
  "did",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "its",
  "more",
  "not",
  "our",
  "out",
  "over",
  "should",
  "than",
  "that",
  "the",
  "their",
  "then",
  "there",
  "they",
  "this",
  "through",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "with",
  "would",
  "you",
]);

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
    const titleIndex = buildTitleIndex(docs);
    const chunks = docs.flatMap((doc) => chunkWikiSearchDocument(doc));
    const links = docs.flatMap((doc) => extractWikiSearchLinks(doc, titleIndex));

    const insertDoc = store.db.prepare(`
      insert into wiki_search_docs
        (path, kind, source, title, mtime_ms, size, indexed_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = store.db.prepare(`
      insert into wiki_search_docs_fts (path, title, body)
      values (?, ?, ?)
    `);
    const insertChunk = store.db.prepare(`
      insert into wiki_search_chunks
        (id, path, chunk_index, title, heading, start_line, end_line, kind, source, body, indexed_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChunkFts = store.db.prepare(`
      insert into wiki_search_chunks_fts (id, path, title, heading, body)
      values (?, ?, ?, ?, ?)
    `);
    const insertLink = store.db.prepare(`
      insert into wiki_search_links (from_path, to_path, label, kind)
      values (?, ?, ?, ?)
    `);
    const indexedAt = (options.now ?? new Date()).toISOString();

    store.db.run("begin");
    try {
      store.db.run("delete from wiki_search_links");
      store.db.run("delete from wiki_search_chunks_fts");
      store.db.run("delete from wiki_search_chunks");
      store.db.run("delete from wiki_search_docs_fts");
      store.db.run("delete from wiki_search_docs");
      for (const doc of docs) {
        insertDoc.run(doc.path, doc.kind, doc.source, doc.title, doc.mtimeMs, doc.size, indexedAt);
        insertFts.run(doc.path, doc.title, doc.body);
      }
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.path,
          chunk.chunkIndex,
          chunk.title,
          chunk.heading,
          chunk.startLine,
          chunk.endLine,
          chunk.kind,
          chunk.source,
          chunk.body,
          indexedAt,
        );
        insertChunkFts.run(chunk.id, chunk.path, chunk.title, chunk.heading, chunk.body);
      }
      for (const link of links) {
        insertLink.run(link.fromPath, link.toPath, link.label, link.kind);
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
      chunks: chunks.length,
      links: links.length,
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

export async function getWikiSearchIndexStatus(options: {
  repoRoot: string;
}): Promise<WikiSearchIndexStatus> {
  const repoRoot = path.resolve(options.repoRoot);
  const stateDbPath = path.join(repoRoot, ".strata", "state.sqlite");
  if (!existsSync(stateDbPath)) {
    return emptyWikiSearchIndexStatus("missing");
  }

  const store = await SessionStore.open(repoRoot);
  try {
    const docsColumns = tableColumns(store.db, "wiki_search_docs");
    const chunkColumns = tableColumns(store.db, "wiki_search_chunks");
    const linkColumns = tableColumns(store.db, "wiki_search_links");
    if (docsColumns.size === 0) {
      return emptyWikiSearchIndexStatus("missing");
    }
    if (
      !hasColumns(docsColumns, ["path", "kind", "source", "title", "indexed_at"]) ||
      !hasColumns(chunkColumns, [
        "id",
        "path",
        "chunk_index",
        "title",
        "heading",
        "start_line",
        "end_line",
        "kind",
        "source",
        "body",
        "indexed_at",
      ]) ||
      !hasColumns(linkColumns, ["from_path", "to_path", "label", "kind"])
    ) {
      return emptyWikiSearchIndexStatus("outdated");
    }

    const totalDocuments = countRows(store, "wiki_search_docs");
    const chunks = countRows(store, "wiki_search_chunks");
    const links = countRows(store, "wiki_search_links");
    const byKind = countGroupedRows(store, "wiki_search_docs", "kind");
    const bySource = countGroupedRows(store, "wiki_search_docs", "source");
    const lastIndexedAt =
      store.db
        .query<{ indexedAt: string | null }, []>(
          "select max(indexed_at) as indexedAt from wiki_search_docs",
        )
        .get()?.indexedAt ?? null;

    return {
      indexed: totalDocuments > 0 && chunks > 0,
      schema: "current",
      lastIndexedAt,
      documents: {
        total: totalDocuments,
        curated: byKind.find((row) => row.name === "curated")?.count ?? 0,
        sources: byKind.find((row) => row.name === "source")?.count ?? 0,
        raw: byKind.find((row) => row.name === "raw")?.count ?? 0,
      },
      chunks,
      links,
      byKind,
      bySource,
    };
  } finally {
    store.close();
  }
}

export async function retrieveWikiContext(
  options: RetrieveWikiContextOptions,
): Promise<WikiRetrievalResult | null> {
  const repoRoot = path.resolve(options.repoRoot);
  const stateDbPath = path.join(repoRoot, ".strata", "state.sqlite");
  if (!existsSync(stateDbPath)) {
    return null;
  }

  const query = options.query.trim();
  const tokenBudget = normalizeTokenBudget(options.tokenBudget);
  if (query === "") {
    return {
      indexed: true,
      strategy: "hybrid",
      query,
      matches: [],
      count: 0,
      tokenBudget,
      estimatedTokens: 0,
      diagnostics: { reason: "empty_query" },
    };
  }

  const store = await SessionStore.open(repoRoot);
  try {
    ensureWikiSearchIndexSchema(store.db);
    store.db.run("PRAGMA busy_timeout = 5000");
    const chunkCount = store.db
      .query<{ count: number }, []>("select count(*) as count from wiki_search_chunks")
      .get()?.count;
    if (!chunkCount) {
      return null;
    }

    const root = normalizeSearchRoot(options.root ?? ".");
    const includeRaw = options.includeRaw ?? false;
    const includeRelated = options.includeRelated ?? true;
    const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_RETRIEVAL_LIMIT, 50));
    const terms = queryTerms(query);
    const queryVector = termVector(query);

    const keywordRows = keywordChunkRows(store, query, includeRaw, RETRIEVAL_FETCH_LIMIT).filter(
      (row) => matchesRoot(row.path, root),
    );
    const scannedRows = scanChunkRows(store, includeRaw, RETRIEVAL_SCAN_LIMIT).filter((row) =>
      matchesRoot(row.path, root),
    );
    const rowsById = new Map<string, ChunkRow>();
    for (const row of [...keywordRows, ...scannedRows]) {
      rowsById.set(row.id, row);
    }

    const lexicalRows = [...rowsById.values()]
      .map((row) => ({
        row,
        score: cosineSimilarity(queryVector, termVector(chunkSearchText(row))),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, RETRIEVAL_FETCH_LIMIT);

    const titleRows = [...rowsById.values()]
      .map((row) => ({ row, score: titleScore(row, terms) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, RETRIEVAL_FETCH_LIMIT);

    const keywordRanks = rankMap(keywordRows.map((row) => row.id));
    const lexicalRanks = rankMap(lexicalRows.map((candidate) => candidate.row.id));
    const titleRanks = rankMap(titleRows.map((candidate) => candidate.row.id));
    const ranked = [...rowsById.values()]
      .map((row) =>
        rankChunk(row, {
          terms,
          queryVector,
          keywordRank: keywordRanks.get(row.id) ?? null,
          lexicalRank: lexicalRanks.get(row.id) ?? null,
          titleRank: titleRanks.get(row.id) ?? null,
          relation: "direct",
        }),
      )
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        return scoreDelta === 0 ? compareChunkRows(left.row, right.row) : scoreDelta;
      });

    const related = includeRelated
      ? relatedChunkCandidates(store, ranked.slice(0, Math.max(limit, 10)), {
          includeRaw,
          root,
          terms,
          queryVector,
        })
      : [];
    const combined = dedupeRankedChunks([...ranked, ...related])
      .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        return scoreDelta === 0 ? compareChunkRows(left.row, right.row) : scoreDelta;
      })
      .slice(0, Math.max(limit * 4, limit));
    const packed = packRetrievalMatches(combined, limit, tokenBudget);

    return {
      indexed: true,
      strategy: "hybrid",
      query,
      matches: packed.matches,
      count: packed.matches.length,
      tokenBudget,
      estimatedTokens: packed.estimatedTokens,
      diagnostics: {
        chunksIndexed: chunkCount,
        keywordCandidates: keywordRows.length,
        lexicalCandidates: lexicalRows.length,
        relatedCandidates: related.length,
      },
    };
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

function keywordChunkRows(
  store: SessionStore,
  query: string,
  includeRaw: boolean,
  fetchLimit: number,
): ChunkRow[] {
  const fts = ftsOrQuery(query);
  if (fts === null) {
    return [];
  }
  const statement = store.db.query<ChunkRow, [string, number, number]>(`
    select
      chunks.id as id,
      chunks.path as path,
      chunks.chunk_index as chunkIndex,
      chunks.title as title,
      chunks.heading as heading,
      chunks.body as body,
      chunks.start_line as startLine,
      chunks.end_line as endLine,
      chunks.kind as kind,
      chunks.source as source,
      bm25(wiki_search_chunks_fts) as score
    from wiki_search_chunks_fts
    join wiki_search_chunks chunks on chunks.id = wiki_search_chunks_fts.id
    where wiki_search_chunks_fts match ?
      and (? = 1 or chunks.kind != 'raw')
    order by
      case chunks.kind
        when 'curated' then 0
        when 'source' then 35
        else 90
      end asc,
      score asc
    limit ?
  `);
  return statement.all(fts, includeRaw ? 1 : 0, fetchLimit);
}

function scanChunkRows(store: SessionStore, includeRaw: boolean, fetchLimit: number): ChunkRow[] {
  const statement = store.db.query<ChunkRow, [number, number]>(`
    select
      id,
      path,
      chunk_index as chunkIndex,
      title,
      heading,
      body,
      start_line as startLine,
      end_line as endLine,
      kind,
      source,
      0 as score
    from wiki_search_chunks
    where (? = 1 or kind != 'raw')
    order by
      case kind
        when 'curated' then 0
        when 'source' then 35
        else 90
      end asc,
      path asc,
      chunk_index asc
    limit ?
  `);
  return statement.all(includeRaw ? 1 : 0, fetchLimit);
}

function relatedChunkCandidates(
  store: SessionStore,
  seeds: RankedChunk[],
  options: {
    includeRaw: boolean;
    root: string;
    terms: string[];
    queryVector: Map<string, number>;
  },
): RankedChunk[] {
  if (seeds.length === 0) {
    return [];
  }
  const paths = [...new Set(seeds.map((seed) => seed.row.path))].slice(0, 25);
  const linkedPaths = new Set<string>();
  const forward = store.db.query<{ toPath: string }, [string]>(
    "select distinct to_path as toPath from wiki_search_links where from_path = ? limit 50",
  );
  const backward = store.db.query<{ fromPath: string }, [string]>(
    "select distinct from_path as fromPath from wiki_search_links where to_path = ? limit 50",
  );
  for (const seedPath of paths) {
    for (const row of forward.all(seedPath)) {
      linkedPaths.add(row.toPath);
    }
    for (const row of backward.all(seedPath)) {
      linkedPaths.add(row.fromPath);
    }
  }

  const chunkForPath = store.db.query<ChunkRow, [string, number]>(`
    select
      id,
      path,
      chunk_index as chunkIndex,
      title,
      heading,
      body,
      start_line as startLine,
      end_line as endLine,
      kind,
      source,
      0 as score
    from wiki_search_chunks
    where path = ?
      and (? = 1 or kind != 'raw')
    order by
      case
        when lower(heading) = lower(title) then 1
        else 0
      end asc,
      chunk_index asc
    limit 2
  `);

  const candidates: RankedChunk[] = [];
  for (const linkedPath of linkedPaths) {
    if (!matchesRoot(linkedPath, options.root)) {
      continue;
    }
    for (const row of chunkForPath.all(linkedPath, options.includeRaw ? 1 : 0)) {
      const relation = paths.includes(linkedPath) ? "backlink" : "linked";
      const ranked = rankChunk(row, {
        terms: options.terms,
        queryVector: options.queryVector,
        keywordRank: null,
        lexicalRank: null,
        titleRank: null,
        relation,
      });
      candidates.push({ ...ranked, score: ranked.score * 0.72 + kindBoost(row) });
    }
  }
  return candidates;
}

function rankChunk(
  row: ChunkRow,
  options: {
    terms: string[];
    queryVector: Map<string, number>;
    keywordRank: number | null;
    lexicalRank: number | null;
    titleRank: number | null;
    relation: string;
  },
): RankedChunk {
  const searchText = chunkSearchText(row);
  const lexical = cosineSimilarity(options.queryVector, termVector(searchText));
  const coverage = termCoverage(options.terms, searchText);
  const rrfScore =
    rrf(options.keywordRank) + rrf(options.lexicalRank) + rrf(options.titleRank) * 1.25;
  const score =
    rrfScore * 100 +
    lexical * 12 +
    coverage * 5 +
    titleScore(row, options.terms) * 2 +
    kindBoost(row) -
    lowQualityChunkPenalty(row);
  return {
    row,
    relation: options.relation,
    score,
    keywordRank: options.keywordRank,
    lexicalRank: options.lexicalRank,
    titleRank: options.titleRank,
  };
}

function rankMap(ids: string[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const [index, id] of ids.entries()) {
    if (!ranks.has(id)) {
      ranks.set(id, index + 1);
    }
  }
  return ranks;
}

function rrf(rank: number | null): number {
  return rank === null ? 0 : 1 / (RRF_K + rank);
}

function dedupeRankedChunks(chunks: RankedChunk[]): RankedChunk[] {
  const byId = new Map<string, RankedChunk>();
  for (const chunk of chunks) {
    const existing = byId.get(chunk.row.id);
    if (existing === undefined || chunk.score > existing.score) {
      byId.set(chunk.row.id, chunk);
    }
  }
  return [...byId.values()];
}

function packRetrievalMatches(
  chunks: RankedChunk[],
  limit: number,
  tokenBudget: number,
): { matches: WikiRetrievalMatch[]; estimatedTokens: number } {
  const matches: WikiRetrievalMatch[] = [];
  let usedTokens = 0;
  for (const chunk of chunks) {
    if (matches.length >= limit || usedTokens >= tokenBudget) {
      break;
    }
    const remaining = tokenBudget - usedTokens;
    if (remaining < 80 && matches.length > 0) {
      break;
    }
    const packed = truncateToTokenBudget(chunk.row.body.trim(), remaining);
    if (packed.text.trim() === "") {
      continue;
    }
    matches.push({
      path: chunk.row.path,
      title: chunk.row.title,
      heading: chunk.row.heading,
      startLine: chunk.row.startLine,
      endLine: chunk.row.endLine,
      kind: chunk.row.kind,
      source: chunk.row.source,
      relation: chunk.relation,
      score: Number(chunk.score.toFixed(6)),
      estimatedTokens: packed.estimatedTokens,
      text: packed.text,
    });
    usedTokens += packed.estimatedTokens;
  }
  return { matches, estimatedTokens: usedTokens };
}

function truncateToTokenBudget(
  text: string,
  tokenBudget: number,
): { text: string; estimatedTokens: number } {
  const maxChars = Math.max(0, tokenBudget * 4);
  if (text.length <= maxChars) {
    return { text, estimatedTokens: estimateTokens(text) };
  }
  const truncated = text
    .slice(0, Math.max(0, maxChars - 20))
    .replace(/\s+\S*$/, "")
    .trimEnd();
  const suffix = truncated.length < text.length ? "\n[truncated]" : "";
  const packed = `${truncated}${suffix}`;
  return { text: packed, estimatedTokens: estimateTokens(packed) };
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeTokenBudget(value: number | undefined): number {
  return Math.max(500, Math.min(value ?? DEFAULT_TOKEN_BUDGET, 20_000));
}

function compareChunkRows(left: ChunkRow, right: ChunkRow): number {
  const kindDelta = wikiSearchRank(left, []) - wikiSearchRank(right, []);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  const pathDelta = left.path.localeCompare(right.path);
  return pathDelta === 0 ? left.chunkIndex - right.chunkIndex : pathDelta;
}

function chunkSearchText(row: Pick<ChunkRow, "path" | "title" | "heading" | "body">): string {
  return `${row.title}\n${row.heading}\n${row.path}\n${row.body}`;
}

function titleScore(row: Pick<ChunkRow, "path" | "title" | "heading">, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }
  const haystack = `${row.title}\n${row.heading}\n${row.path}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }
  return score / terms.length;
}

function termCoverage(terms: string[], text: string): number {
  if (terms.length === 0) {
    return 0;
  }
  const lower = text.toLowerCase();
  const matched = terms.filter((term) => lower.includes(term)).length;
  return matched / terms.length;
}

function kindBoost(row: Pick<ChunkRow, "kind" | "path">): number {
  if (row.kind === "raw") {
    return -2.5;
  }
  if (row.kind === "source") {
    return -0.9;
  }
  if (row.path.startsWith("projects/")) {
    return 2.5;
  }
  if (row.path.startsWith("decisions/")) {
    return 1.2;
  }
  if (row.path.startsWith("threads/") || row.path.startsWith("meetings/")) {
    return 0.7;
  }
  if (["priorities.md", "me.md", "index.md"].includes(row.path)) {
    return 0.5;
  }
  return 0;
}

function lowQualityChunkPenalty(row: Pick<ChunkRow, "heading" | "body">): number {
  const heading = row.heading.toLowerCase();
  let penalty = 0;
  if (
    heading === "source" ||
    heading === "sources" ||
    heading.includes("open threads") ||
    heading.includes("source meetings") ||
    heading.includes("timeline") ||
    heading.includes("consolidated sources")
  ) {
    penalty += 6;
  }
  if (/raw transcript:/i.test(row.body) || /notes\.granola\.ai/i.test(row.body)) {
    penalty += 4;
  }
  const wikilinks = row.body.match(/\[\[[^\]]+\]\]/g)?.length ?? 0;
  const markdownLinks = row.body.match(/\[[^\]]+\]\([^)]+\)/g)?.length ?? 0;
  if (wikilinks > 12) {
    penalty += 2;
  }
  if (markdownLinks > 12) {
    penalty += 1.5;
  }
  return penalty;
}

function termVector(text: string): Map<string, number> {
  const vector = new Map<string, number>();
  for (const term of tokenizeTerms(text)) {
    vector.set(term, (vector.get(term) ?? 0) + 1);
  }
  return vector;
}

function cosineSimilarity(left: Map<string, number>, right: Map<string, number>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (const value of left.values()) {
    leftMagnitude += value * value;
  }
  for (const value of right.values()) {
    rightMagnitude += value * value;
  }
  for (const [term, leftValue] of left) {
    dot += leftValue * (right.get(term) ?? 0);
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function ensureWikiSearchIndexSchema(db: SessionStore["db"]): void {
  resetWikiSearchIndexTablesIfOutdated(db);
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
  db.run(`
    create table if not exists wiki_search_chunks (
      id text primary key not null,
      path text not null,
      chunk_index integer not null,
      title text not null,
      heading text not null,
      start_line integer not null,
      end_line integer not null,
      kind text not null,
      source text,
      body text not null,
      indexed_at text not null
    )
  `);
  db.run(`
    create virtual table if not exists wiki_search_chunks_fts
    using fts5(id unindexed, path unindexed, title, heading, body, tokenize = 'unicode61')
  `);
  db.run(`
    create table if not exists wiki_search_links (
      from_path text not null,
      to_path text not null,
      label text not null,
      kind text not null
    )
  `);
  db.run("create index if not exists wiki_search_docs_kind_idx on wiki_search_docs(kind)");
  db.run("create index if not exists wiki_search_docs_source_idx on wiki_search_docs(source)");
  db.run("create index if not exists wiki_search_chunks_path_idx on wiki_search_chunks(path)");
  db.run("create index if not exists wiki_search_chunks_kind_idx on wiki_search_chunks(kind)");
  db.run("create index if not exists wiki_search_links_from_idx on wiki_search_links(from_path)");
  db.run("create index if not exists wiki_search_links_to_idx on wiki_search_links(to_path)");
}

function resetWikiSearchIndexTablesIfOutdated(db: SessionStore["db"]): void {
  const chunkColumns = tableColumns(db, "wiki_search_chunks");
  if (
    chunkColumns.size > 0 &&
    !hasColumns(chunkColumns, [
      "id",
      "path",
      "chunk_index",
      "title",
      "heading",
      "start_line",
      "end_line",
      "kind",
      "source",
      "body",
      "indexed_at",
    ])
  ) {
    db.run("drop table if exists wiki_search_chunks_fts");
    db.run("drop table if exists wiki_search_chunks");
    db.run("drop table if exists wiki_search_links");
    return;
  }

  const linkColumns = tableColumns(db, "wiki_search_links");
  if (linkColumns.size > 0 && !hasColumns(linkColumns, ["from_path", "to_path", "label", "kind"])) {
    db.run("drop table if exists wiki_search_links");
  }
}

function emptyWikiSearchIndexStatus(
  schema: WikiSearchIndexStatus["schema"],
): WikiSearchIndexStatus {
  return {
    indexed: false,
    schema,
    lastIndexedAt: null,
    documents: {
      total: 0,
      curated: 0,
      sources: 0,
      raw: 0,
    },
    chunks: 0,
    links: 0,
    byKind: [],
    bySource: [],
  };
}

function countRows(store: SessionStore, tableName: string): number {
  assertKnownWikiSearchIndexTable(tableName);
  return (
    store.db.query<{ count: number }, []>(`select count(*) as count from ${tableName}`).get()
      ?.count ?? 0
  );
}

function countGroupedRows(
  store: SessionStore,
  tableName: string,
  columnName: string,
): Array<{ name: string; count: number }> {
  assertKnownWikiSearchIndexTable(tableName);
  assertKnownWikiSearchIndexColumn(columnName);
  return store.db
    .query<{ name: string | null; count: number }, []>(
      `select ${columnName} as name, count(*) as count from ${tableName} group by ${columnName} order by count desc, name asc`,
    )
    .all()
    .map((row) => ({ name: row.name ?? "unknown", count: row.count }));
}

function tableColumns(db: SessionStore["db"], tableName: string): Set<string> {
  assertKnownWikiSearchIndexTable(tableName);
  const rows = db.query<{ name: string }, []>(`pragma table_info(${tableName})`).all();
  return new Set(rows.map((row) => row.name));
}

function hasColumns(columns: Set<string>, required: string[]): boolean {
  return required.every((column) => columns.has(column));
}

function assertKnownWikiSearchIndexTable(tableName: string): void {
  if (!["wiki_search_docs", "wiki_search_chunks", "wiki_search_links"].includes(tableName)) {
    throw new Error(`Invalid wiki search index table name: ${tableName}`);
  }
}

function assertKnownWikiSearchIndexColumn(columnName: string): void {
  if (!["kind", "source"].includes(columnName)) {
    throw new Error(`Invalid wiki search index column name: ${columnName}`);
  }
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
    const stripped = stripFrontmatterWithOffset(text);
    docs.push({
      path: relativePath,
      title: metadata.title || firstHeading(text) || titleFromPath(relativePath),
      body: stripped.body,
      bodyStartLine: stripped.startLine,
      kind: documentKind(relativePath, text),
      source: documentSource(relativePath, metadata),
      mtimeMs: file.mtimeMs,
      size: file.size,
    });
  }
  return docs;
}

function chunkWikiSearchDocument(doc: WikiSearchDocument): WikiSearchChunk[] {
  const chunks: WikiSearchChunk[] = [];
  const lines = doc.body.split(/\r?\n/);
  let heading = doc.title;
  let buffer: Array<{ line: number; text: string }> = [];

  function flush(): void {
    const trimmed = trimChunkLines(buffer);
    buffer = [];
    if (trimmed.length === 0) {
      return;
    }
    const body = trimmed
      .map((line) => line.text)
      .join("\n")
      .trim();
    if (!hasSubstantiveText(body)) {
      return;
    }
    chunks.push({
      id: `${doc.path}#${chunks.length}`,
      path: doc.path,
      chunkIndex: chunks.length,
      title: doc.title,
      heading,
      body,
      startLine: trimmed[0]?.line ?? doc.bodyStartLine,
      endLine: trimmed.at(-1)?.line ?? doc.bodyStartLine,
      kind: doc.kind,
      source: doc.source,
    });
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = doc.bodyStartLine + index;
    const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (headingMatch?.[2]) {
      flush();
      heading = headingMatch[2].trim();
      buffer.push({ line: lineNumber, text: line });
      continue;
    }

    buffer.push({ line: lineNumber, text: line });
    const charCount = buffer.reduce((total, item) => total + item.text.length + 1, 0);
    if (charCount >= CHUNK_TARGET_CHARS || buffer.length >= CHUNK_MAX_LINES) {
      flush();
    }
  }
  flush();

  if (chunks.length > 0) {
    return chunks;
  }

  const fallbackBody = doc.body.trim();
  if (!hasSubstantiveText(fallbackBody)) {
    return [];
  }
  return [
    {
      id: `${doc.path}#0`,
      path: doc.path,
      chunkIndex: 0,
      title: doc.title,
      heading: doc.title,
      body: fallbackBody,
      startLine: doc.bodyStartLine,
      endLine: doc.bodyStartLine + Math.max(0, lines.length - 1),
      kind: doc.kind,
      source: doc.source,
    },
  ];
}

function trimChunkLines(
  lines: Array<{ line: number; text: string }>,
): Array<{ line: number; text: string }> {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start]?.text.trim() ?? "") === "") {
    start += 1;
  }
  while (end > start && (lines[end - 1]?.text.trim() ?? "") === "") {
    end -= 1;
  }
  return lines.slice(start, end);
}

function hasSubstantiveText(body: string): boolean {
  const withoutHeadings = body
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .join("\n")
    .replace(/\[\[[^\]]+\]\]/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .trim();
  return /[a-zA-Z0-9]/.test(withoutHeadings) && withoutHeadings.length >= 12;
}

function buildTitleIndex(docs: WikiSearchDocument[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const doc of docs) {
    for (const key of linkLookupKeys(doc.path)) {
      setFirst(index, key, doc.path);
    }
    for (const key of linkLookupKeys(doc.path.replace(/\.md$/i, ""))) {
      setFirst(index, key, doc.path);
    }
    for (const key of linkLookupKeys(path.basename(doc.path, ".md"))) {
      setFirst(index, key, doc.path);
    }
    for (const key of linkLookupKeys(doc.title)) {
      setFirst(index, key, doc.path);
    }
  }
  return index;
}

function setFirst(map: Map<string, string>, key: string, value: string): void {
  if (key !== "" && !map.has(key)) {
    map.set(key, value);
  }
}

function extractWikiSearchLinks(
  doc: WikiSearchDocument,
  titleIndex: Map<string, string>,
): WikiSearchLink[] {
  const links: WikiSearchLink[] = [];
  const seen = new Set<string>();
  const wikilinkPattern = /\[\[([^\]\n]+)\]\]/g;
  for (const match of doc.body.matchAll(wikilinkPattern)) {
    const raw = match[1]?.trim();
    if (!raw) {
      continue;
    }
    const [targetPart, labelPart] = raw.split("|");
    const target = targetPart?.trim();
    if (!target) {
      continue;
    }
    const resolved = resolveLinkTarget(doc.path, target, titleIndex, false);
    if (resolved === null || resolved === doc.path) {
      continue;
    }
    const label = (labelPart ?? target).trim();
    const key = `${doc.path}\0${resolved}\0wiki`;
    if (!seen.has(key)) {
      links.push({ fromPath: doc.path, toPath: resolved, label, kind: "wiki" });
      seen.add(key);
    }
  }

  const markdownPattern = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  for (const match of doc.body.matchAll(markdownPattern)) {
    const label = match[1]?.trim();
    const target = match[2]?.trim();
    if (!label || !target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) {
      continue;
    }
    const resolved = resolveLinkTarget(doc.path, target, titleIndex, true);
    if (resolved === null || resolved === doc.path) {
      continue;
    }
    const key = `${doc.path}\0${resolved}\0markdown`;
    if (!seen.has(key)) {
      links.push({ fromPath: doc.path, toPath: resolved, label, kind: "markdown" });
      seen.add(key);
    }
  }
  return links;
}

function resolveLinkTarget(
  fromPath: string,
  target: string,
  titleIndex: Map<string, string>,
  resolveRelative: boolean,
): string | null {
  const withoutAnchor = target.split("#")[0]?.trim();
  if (!withoutAnchor) {
    return null;
  }
  let normalized = withoutAnchor.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.startsWith("wiki/")) {
    normalized = normalized.slice("wiki/".length);
  }
  if (resolveRelative && !isKnownWikiPrefix(normalized) && !normalized.startsWith("raw/")) {
    normalized = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), normalized));
  }
  if (normalized.startsWith("../")) {
    normalized = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), normalized));
  }
  for (const key of linkLookupKeys(normalized)) {
    const resolved = titleIndex.get(key);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  for (const key of linkLookupKeys(normalized.replace(/\.md$/i, ""))) {
    const resolved = titleIndex.get(key);
    if (resolved !== undefined) {
      return resolved;
    }
  }
  return null;
}

function isKnownWikiPrefix(value: string): boolean {
  const prefix = value.split("/")[0] ?? "";
  return [
    "actions",
    "decisions",
    "meetings",
    "people",
    "priorities.md",
    "projects",
    "sources",
    "teams",
    "threads",
  ].includes(prefix);
}

function linkLookupKeys(value: string): string[] {
  const cleaned = value
    .trim()
    .replace(/^wiki\//, "")
    .replace(/^\.\//, "")
    .replace(/\.md$/i, "")
    .replace(/\/+$/, "");
  const lower = cleaned.toLowerCase();
  const slugged = lower.replace(/\s+/g, "-");
  const spaced = lower.replace(/[-_]+/g, " ");
  return [...new Set([lower, slugged, spaced].filter((key) => key !== ""))];
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

function ftsOrQuery(query: string): string | null {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

function queryTerms(query: string): string[] {
  return tokenizeTerms(query).slice(0, 12);
}

function tokenizeTerms(text: string): string[] {
  return [...text.toLowerCase().matchAll(/[a-z0-9][a-z0-9_-]{1,}/g)]
    .map((match) => match[0]?.replace(/^-+|-+$/g, "") ?? "")
    .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
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

function stripFrontmatterWithOffset(text: string): { body: string; startLine: number } {
  if (!text.startsWith("---\n")) {
    return { body: text, startLine: 1 };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return { body: text, startLine: 1 };
  }
  let bodyOffset = end + "\n---".length;
  if (text.startsWith("\r\n", bodyOffset)) {
    bodyOffset += 2;
  } else if (text.startsWith("\n", bodyOffset)) {
    bodyOffset += 1;
  }
  const startLine = text.slice(0, bodyOffset).split(/\r?\n/).length;
  return { body: text.slice(bodyOffset), startLine };
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
