import { createHash } from "node:crypto";
import { type JsonObject, SessionStore, safeJsonStringify } from "@strata/core";
import type {
  DailyTodoExtractionResult,
  ExtractionSourceKind,
  ExtractionSourceType,
  TodoCandidateKind,
  TodoCandidateResult,
  TodoCandidateStatus,
  TodoVerification,
} from "./types.js";

export interface CompletedExtractionRunLookup {
  id: string;
  name: string;
  day: string | null;
  status: string;
  extractorVersion: string;
  verifierVersion: string;
  modelName: string | null;
  sessionId: string | null;
  candidateCount: number;
  rejectedCount: number;
  endedAt: string | null;
}

export interface StoredExtractionRun {
  id: string;
  name: string;
  scope: JsonObject;
  day: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  extractorVersion: string;
  verifierVersion: string;
  modelName: string | null;
  sessionId: string | null;
  dryRun: boolean;
  candidateCount: number;
  rejectedCount: number;
  createdAt: string;
  updatedAt: string;
}

interface StoredExtractionRunRow {
  id: string;
  name: string;
  scopeJson: string;
  day: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  extractorVersion: string;
  verifierVersion: string;
  modelName: string | null;
  sessionId: string | null;
  dryRun: number;
  candidateCount: number;
  rejectedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FindCompletedExtractionRunOptions {
  repoRoot: string;
  name: string;
  day: string;
  extractorVersion: string;
  verifierVersion: string;
  modelName?: string;
  dryRun?: boolean;
}

export interface ListExtractionRunsOptions {
  repoRoot: string;
  name?: string;
  day?: string;
  status?: string;
  dryRun?: boolean;
  limit?: number;
}

export interface ListExtractionCandidatesOptions {
  repoRoot: string;
  name?: string;
  day?: string;
  status?: TodoCandidateStatus;
  sourceType?: ExtractionSourceType;
  published?: boolean;
  limit?: number;
}

export interface StoredExtractionCandidate {
  id: string;
  runId: string;
  name: string;
  day: string;
  sourcePath: string;
  sourceKind: ExtractionSourceKind;
  sourceType: ExtractionSourceType;
  lineStart: number;
  lineEnd: number;
  evidenceSpanId: string;
  evidenceText: string;
  candidateHash: string;
  candidateKind: TodoCandidateKind;
  candidateText: string;
  status: TodoCandidateStatus;
  verification: TodoVerification;
  deterministicReasons: string[];
  metadata: JsonObject;
  publishedTarget: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredExtractionCandidateRow {
  id: string;
  runId: string;
  name: string;
  day: string;
  sourcePath: string;
  sourceKind: ExtractionSourceKind;
  sourceType: ExtractionSourceType;
  lineStart: number;
  lineEnd: number;
  evidenceSpanId: string;
  evidenceText: string;
  candidateHash: string;
  candidateKind: TodoCandidateKind;
  candidateText: string;
  status: TodoCandidateStatus;
  verificationJson: string;
  deterministicReasonsJson: string;
  metadataJson: string;
  publishedTarget: string | null;
  createdAt: string;
  updatedAt: string;
}

export function extractionRunIdForSession(sessionId: string): string {
  return `extract_${sessionId}`;
}

export function persistDailyTodoExtractionResult(
  store: SessionStore,
  result: DailyTodoExtractionResult,
): void {
  const now = new Date().toISOString();
  const sessionRow = store.db
    .query<{ startedAt: string }, [string]>(
      "select started_at as startedAt from sessions where id = ?",
    )
    .get(result.sessionId);
  const startedAt = sessionRow?.startedAt ?? now;
  const endedAt = now;

  const transaction = store.db.transaction(() => {
    store.db
      .query(
        `insert into extraction_runs (
          id, name, scope_json, day, status, started_at, ended_at, extractor_version,
          verifier_version, model, session_id, dry_run, candidate_count, rejected_count,
          created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          scope_json = excluded.scope_json,
          day = excluded.day,
          status = excluded.status,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          extractor_version = excluded.extractor_version,
          verifier_version = excluded.verifier_version,
          model = excluded.model,
          session_id = excluded.session_id,
          dry_run = excluded.dry_run,
          candidate_count = excluded.candidate_count,
          rejected_count = excluded.rejected_count,
          updated_at = excluded.updated_at`,
      )
      .run(
        result.extractionRunId,
        result.extractionName,
        safeJsonStringify({ day: result.day }),
        result.day,
        "completed",
        startedAt,
        endedAt,
        result.extractorVersion,
        result.verifierVersion,
        result.modelName ?? null,
        result.sessionId,
        result.dryRun ? 1 : 0,
        result.candidateCount,
        result.rejectedCount,
        now,
        now,
      );

    for (const item of result.results) {
      const id = extractionCandidateStorageIdForResult(result, item);
      const metadata: JsonObject = {
        ...item.candidate.metadata,
        evidenceMetadata: item.evidence.metadata,
      };
      store.db
        .query(
          `insert into extraction_candidates (
            id, run_id, name, day, source_path, source_kind, source_type, line_start,
            line_end, evidence_span_id, evidence_text, candidate_hash, candidate_kind,
            candidate_text, status, verification_json, deterministic_reasons_json,
            metadata_json, published_target, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            run_id = excluded.run_id,
            name = excluded.name,
            day = excluded.day,
            source_path = excluded.source_path,
            source_kind = excluded.source_kind,
            source_type = excluded.source_type,
            line_start = excluded.line_start,
            line_end = excluded.line_end,
            evidence_span_id = excluded.evidence_span_id,
            evidence_text = excluded.evidence_text,
            candidate_hash = excluded.candidate_hash,
            candidate_kind = excluded.candidate_kind,
            candidate_text = excluded.candidate_text,
            status = case
              when extraction_candidates.status = 'rejected' and excluded.status != 'rejected'
              then extraction_candidates.status
              else excluded.status
            end,
            verification_json = case
              when extraction_candidates.status = 'rejected' and excluded.status != 'rejected'
              then extraction_candidates.verification_json
              else excluded.verification_json
            end,
            deterministic_reasons_json = case
              when extraction_candidates.status = 'rejected' and excluded.status != 'rejected'
              then extraction_candidates.deterministic_reasons_json
              else excluded.deterministic_reasons_json
            end,
            metadata_json = case
              when extraction_candidates.status = 'rejected' and excluded.status != 'rejected'
              then extraction_candidates.metadata_json
              else excluded.metadata_json
            end,
            published_target = coalesce(extraction_candidates.published_target, excluded.published_target),
            updated_at = excluded.updated_at`,
        )
        .run(
          id,
          result.extractionRunId,
          result.extractionName,
          result.day,
          item.evidence.sourcePath,
          item.evidence.sourceKind,
          item.evidence.sourceType,
          item.evidence.lineStart,
          item.evidence.lineEnd,
          item.candidate.evidenceSpanId,
          item.evidence.text,
          item.candidate.candidateHash,
          item.candidate.candidateKind,
          item.candidate.candidateText,
          item.status,
          safeJsonStringify(item.verification),
          safeJsonStringify(item.candidate.deterministicReasons),
          safeJsonStringify(metadata),
          null,
          now,
          now,
        );
    }
  });

  transaction();
}

export function updateExtractionCandidatePublishedTargetInStore(
  store: SessionStore,
  options: { id: string; publishedTarget: string },
): void {
  const now = new Date().toISOString();
  store.db
    .query(
      `update extraction_candidates
      set published_target = ?, updated_at = ?
      where id = ?`,
    )
    .run(options.publishedTarget, now, options.id);
}

export function updateExtractionCandidateVerificationInStore(
  store: SessionStore,
  options: {
    id: string;
    status: TodoCandidateStatus;
    verification: TodoVerification;
    metadata?: JsonObject;
    deterministicReasons?: string[];
  },
): StoredExtractionCandidate | null {
  const existing = getExtractionCandidateInStore(store, options.id);
  if (existing === null) {
    return null;
  }
  const now = new Date().toISOString();
  const metadata = options.metadata === undefined ? existing.metadata : options.metadata;
  const deterministicReasons =
    options.deterministicReasons === undefined
      ? existing.deterministicReasons
      : options.deterministicReasons;
  store.db
    .query(
      `update extraction_candidates
      set status = ?,
        verification_json = ?,
        deterministic_reasons_json = ?,
        metadata_json = ?,
        updated_at = ?
      where id = ?`,
    )
    .run(
      options.status,
      safeJsonStringify(options.verification),
      safeJsonStringify(deterministicReasons),
      safeJsonStringify(metadata),
      now,
      options.id,
    );
  return getExtractionCandidateInStore(store, options.id);
}

export function rejectExtractionCandidateInStore(
  store: SessionStore,
  options: { id: string; reason?: string; now?: Date },
): StoredExtractionCandidate | null {
  const existing = getExtractionCandidateInStore(store, options.id);
  if (existing === null) {
    return null;
  }
  if (existing.publishedTarget !== null) {
    throw new Error(`Cannot reject a published extraction candidate: ${options.id}`);
  }
  const reviewedAt = (options.now ?? new Date()).toISOString();
  const reason = options.reason?.trim() ?? "";
  const verification: TodoVerification = {
    ...existing.verification,
    classification: "not_action",
    owner: "unknown",
    rationale:
      reason.length > 0
        ? reason
        : existing.verification.rationale || "Rejected during action review.",
  };
  return updateExtractionCandidateVerificationInStore(store, {
    id: options.id,
    status: "rejected",
    verification,
    deterministicReasons: uniqueStrings([
      ...existing.deterministicReasons,
      reason.length > 0 ? `review_rejected: ${reason}` : "review_rejected",
    ]),
    metadata: {
      ...existing.metadata,
      review: {
        status: "rejected",
        reviewedAt,
        ...(reason.length === 0 ? {} : { reason }),
      },
    },
  });
}

export async function findCompletedExtractionRun(
  options: FindCompletedExtractionRunOptions,
): Promise<CompletedExtractionRunLookup | null> {
  const store = await SessionStore.open(options.repoRoot);
  try {
    return findCompletedExtractionRunInStore(store, options);
  } finally {
    store.close();
  }
}

export function findCompletedExtractionRunInStore(
  store: SessionStore,
  options: Omit<FindCompletedExtractionRunOptions, "repoRoot">,
): CompletedExtractionRunLookup | null {
  const modelClause = options.modelName === undefined ? "model is null" : "model = ?";
  const dryRunClause = options.dryRun === undefined ? "1 = 1" : "dry_run = ?";
  const bindings = [
    options.name,
    options.day,
    options.extractorVersion,
    options.verifierVersion,
    ...(options.modelName === undefined ? [] : [options.modelName]),
    ...(options.dryRun === undefined ? [] : [options.dryRun ? 1 : 0]),
  ] as [string, string, string, string, ...(string | number)[]];
  const row = store.db
    .query<CompletedExtractionRunLookup, typeof bindings>(
      `select
        id,
        name,
        day,
        status,
        extractor_version as extractorVersion,
        verifier_version as verifierVersion,
        model as modelName,
        session_id as sessionId,
        candidate_count as candidateCount,
        rejected_count as rejectedCount,
        ended_at as endedAt
      from extraction_runs
      where name = ?
        and day = ?
        and extractor_version = ?
        and verifier_version = ?
        and ${modelClause}
        and ${dryRunClause}
        and status = 'completed'
      order by ended_at desc, created_at desc
      limit 1`,
    )
    .get(...bindings);
  return row ?? null;
}

export async function listExtractionRuns(
  options: ListExtractionRunsOptions,
): Promise<StoredExtractionRun[]> {
  const store = await SessionStore.open(options.repoRoot);
  try {
    return listExtractionRunsInStore(store, options);
  } finally {
    store.close();
  }
}

export function listExtractionRunsInStore(
  store: SessionStore,
  options: Omit<ListExtractionRunsOptions, "repoRoot"> = {},
): StoredExtractionRun[] {
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (options.name !== undefined) {
    where.push("name = ?");
    bindings.push(options.name);
  }
  if (options.day !== undefined) {
    where.push("day = ?");
    bindings.push(options.day);
  }
  if (options.status !== undefined) {
    where.push("status = ?");
    bindings.push(options.status);
  }
  if (options.dryRun !== undefined) {
    where.push("dry_run = ?");
    bindings.push(options.dryRun ? 1 : 0);
  }
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const rows = store.db
    .query<StoredExtractionRunRow, Array<string | number>>(
      `select
        id,
        name,
        scope_json as scopeJson,
        day,
        status,
        started_at as startedAt,
        ended_at as endedAt,
        extractor_version as extractorVersion,
        verifier_version as verifierVersion,
        model as modelName,
        session_id as sessionId,
        dry_run as dryRun,
        candidate_count as candidateCount,
        rejected_count as rejectedCount,
        created_at as createdAt,
        updated_at as updatedAt
      from extraction_runs
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by coalesce(ended_at, started_at) desc, created_at desc
      limit ?`,
    )
    .all(...bindings, limit);
  return rows.map(rowToStoredExtractionRun);
}

export function getExtractionRunInStore(
  store: SessionStore,
  id: string,
): StoredExtractionRun | null {
  const row = store.db
    .query<StoredExtractionRunRow, [string]>(
      `select
        id,
        name,
        scope_json as scopeJson,
        day,
        status,
        started_at as startedAt,
        ended_at as endedAt,
        extractor_version as extractorVersion,
        verifier_version as verifierVersion,
        model as modelName,
        session_id as sessionId,
        dry_run as dryRun,
        candidate_count as candidateCount,
        rejected_count as rejectedCount,
        created_at as createdAt,
        updated_at as updatedAt
      from extraction_runs
      where id = ?
      limit 1`,
    )
    .get(id);
  return row === null || row === undefined ? null : rowToStoredExtractionRun(row);
}

export async function listExtractionCandidates(
  options: ListExtractionCandidatesOptions,
): Promise<StoredExtractionCandidate[]> {
  const store = await SessionStore.open(options.repoRoot);
  try {
    return listExtractionCandidatesInStore(store, options);
  } finally {
    store.close();
  }
}

export function listExtractionCandidatesInStore(
  store: SessionStore,
  options: Omit<ListExtractionCandidatesOptions, "repoRoot">,
): StoredExtractionCandidate[] {
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (options.name !== undefined) {
    where.push("name = ?");
    bindings.push(options.name);
  }
  if (options.day !== undefined) {
    where.push("day = ?");
    bindings.push(options.day);
  }
  if (options.status !== undefined) {
    where.push("status = ?");
    bindings.push(options.status);
  }
  if (options.sourceType !== undefined) {
    where.push("source_type = ?");
    bindings.push(options.sourceType);
  }
  if (options.published !== undefined) {
    where.push(options.published ? "published_target is not null" : "published_target is null");
  }
  const limit = Math.max(1, Math.min(options.limit ?? 500, 1000));
  const rows = store.db
    .query<StoredExtractionCandidateRow, Array<string | number>>(
      `select
        id,
        run_id as runId,
        name,
        day,
        source_path as sourcePath,
        source_kind as sourceKind,
        source_type as sourceType,
        line_start as lineStart,
        line_end as lineEnd,
        evidence_span_id as evidenceSpanId,
        evidence_text as evidenceText,
        candidate_hash as candidateHash,
        candidate_kind as candidateKind,
        candidate_text as candidateText,
        status,
        verification_json as verificationJson,
        deterministic_reasons_json as deterministicReasonsJson,
        metadata_json as metadataJson,
        published_target as publishedTarget,
        created_at as createdAt,
        updated_at as updatedAt
      from extraction_candidates
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by day desc, source_path asc, line_start asc, id asc
      limit ?`,
    )
    .all(...bindings, limit);
  return rows.map(rowToStoredExtractionCandidate);
}

export function getExtractionCandidateInStore(
  store: SessionStore,
  id: string,
): StoredExtractionCandidate | null {
  const row = store.db
    .query<StoredExtractionCandidateRow, [string]>(
      `select
        id,
        run_id as runId,
        name,
        day,
        source_path as sourcePath,
        source_kind as sourceKind,
        source_type as sourceType,
        line_start as lineStart,
        line_end as lineEnd,
        evidence_span_id as evidenceSpanId,
        evidence_text as evidenceText,
        candidate_hash as candidateHash,
        candidate_kind as candidateKind,
        candidate_text as candidateText,
        status,
        verification_json as verificationJson,
        deterministic_reasons_json as deterministicReasonsJson,
        metadata_json as metadataJson,
        published_target as publishedTarget,
        created_at as createdAt,
        updated_at as updatedAt
      from extraction_candidates
      where id = ?
      limit 1`,
    )
    .get(id);
  return row === null || row === undefined ? null : rowToStoredExtractionCandidate(row);
}

export function extractionCandidateStorageIdForResult(
  result: DailyTodoExtractionResult,
  item: TodoCandidateResult,
): string {
  return extractionCandidateStorageId(result, item.candidate.candidateHash, {
    sourcePath: item.evidence.sourcePath,
    lineStart: item.evidence.lineStart,
    lineEnd: item.evidence.lineEnd,
  });
}

function extractionCandidateStorageId(
  result: DailyTodoExtractionResult,
  candidateHash: string,
  source: { sourcePath: string; lineStart: number; lineEnd: number },
): string {
  const hash = createHash("sha256")
    .update(
      [
        result.extractionName,
        result.day,
        source.sourcePath,
        source.lineStart,
        source.lineEnd,
        candidateHash,
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);
  return `extracted_${hash}`;
}

function rowToStoredExtractionRun(row: StoredExtractionRunRow): StoredExtractionRun {
  return {
    id: row.id,
    name: row.name,
    scope: parseJson<JsonObject>(row.scopeJson),
    day: row.day,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    extractorVersion: row.extractorVersion,
    verifierVersion: row.verifierVersion,
    modelName: row.modelName,
    sessionId: row.sessionId,
    dryRun: row.dryRun === 1,
    candidateCount: row.candidateCount,
    rejectedCount: row.rejectedCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToStoredExtractionCandidate(
  row: StoredExtractionCandidateRow,
): StoredExtractionCandidate {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    day: row.day,
    sourcePath: row.sourcePath,
    sourceKind: row.sourceKind,
    sourceType: row.sourceType,
    lineStart: row.lineStart,
    lineEnd: row.lineEnd,
    evidenceSpanId: row.evidenceSpanId,
    evidenceText: row.evidenceText,
    candidateHash: row.candidateHash,
    candidateKind: row.candidateKind,
    candidateText: row.candidateText,
    status: row.status,
    verification: parseJson<TodoVerification>(row.verificationJson),
    deterministicReasons: parseJson<string[]>(row.deterministicReasonsJson),
    metadata: parseJson<JsonObject>(row.metadataJson),
    publishedTarget: row.publishedTarget,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
