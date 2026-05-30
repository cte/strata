import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "./types.js";

/**
 * Durable store for Classification corrections — typed reviewer verdicts on
 * raw-to-wiki classification outcomes (see docs/taxonomy-suggestion-plan.md).
 * Core stays subject-matter-agnostic: `observed` and `correction` are opaque
 * JSON; the ingest/web layers interpret their shapes.
 */
export type ClassificationCorrectionStatus = "open" | "applied" | "dismissed";

export interface ClassificationCorrection {
  id: string;
  createdAt: string;
  source: string;
  targetSessionId: string;
  targetEventId: number;
  rawPath: string;
  observed: JsonValue;
  verdict: string;
  correction: JsonValue | null;
  derivedProposalPath: string | null;
  status: ClassificationCorrectionStatus;
  dedupeKey: string;
}

export interface CreateClassificationCorrectionInput {
  source: string;
  targetSessionId: string;
  targetEventId: number;
  rawPath: string;
  observed: JsonValue;
  verdict: string;
  correction?: JsonValue | null;
  derivedProposalPath?: string | null;
  status?: ClassificationCorrectionStatus;
  dedupeKey: string;
  id?: string;
  now?: Date;
}

interface CorrectionRow {
  id: string;
  created_at: string;
  source: string;
  target_session_id: string;
  target_event_id: number;
  raw_path: string;
  observed_json: string;
  verdict: string;
  correction_json: string | null;
  derived_proposal_path: string | null;
  status: string;
  dedupe_key: string;
}

const SELECT = `select id, created_at, source, target_session_id, target_event_id, raw_path,
  observed_json, verdict, correction_json, derived_proposal_path, status, dedupe_key
  from classification_corrections`;

export class ClassificationCorrectionStore {
  constructor(private readonly db: Database) {}

  create(input: CreateClassificationCorrectionInput): ClassificationCorrection {
    const id = input.id ?? `classification_correction_${randomUUID()}`;
    const createdAt = (input.now ?? new Date()).toISOString();
    const status = input.status ?? "open";
    const correction = input.correction ?? null;
    const derivedProposalPath = input.derivedProposalPath ?? null;
    this.db
      .query(
        `insert into classification_corrections (
          id, created_at, source, target_session_id, target_event_id, raw_path,
          observed_json, verdict, correction_json, derived_proposal_path, status, dedupe_key
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        createdAt,
        input.source,
        input.targetSessionId,
        input.targetEventId,
        input.rawPath,
        JSON.stringify(input.observed),
        input.verdict,
        correction === null ? null : JSON.stringify(correction),
        derivedProposalPath,
        status,
        input.dedupeKey,
      );
    return {
      id,
      createdAt,
      source: input.source,
      targetSessionId: input.targetSessionId,
      targetEventId: input.targetEventId,
      rawPath: input.rawPath,
      observed: input.observed,
      verdict: input.verdict,
      correction,
      derivedProposalPath,
      status,
      dedupeKey: input.dedupeKey,
    };
  }

  getByDedupeKey(dedupeKey: string): ClassificationCorrection | undefined {
    const row = this.db
      .query<CorrectionRow, [string]>(
        `${SELECT} where dedupe_key = ? order by created_at desc limit 1`,
      )
      .get(dedupeKey);
    return row === null ? undefined : rowToCorrection(row);
  }

  list(
    options: { status?: ClassificationCorrectionStatus; limit?: number } = {},
  ): ClassificationCorrection[] {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 2000));
    const rows =
      options.status === undefined
        ? this.db
            .query<CorrectionRow, [number]>(`${SELECT} order by created_at desc limit ?`)
            .all(limit)
        : this.db
            .query<CorrectionRow, [string, number]>(
              `${SELECT} where status = ? order by created_at desc limit ?`,
            )
            .all(options.status, limit);
    return rows.map(rowToCorrection);
  }

  /** Dedupe keys with any recorded correction — used to suppress reviewed items from the queue. */
  correctedDedupeKeys(): Set<string> {
    const rows = this.db
      .query<{ dedupe_key: string }, []>(
        `select distinct dedupe_key from classification_corrections`,
      )
      .all();
    return new Set(rows.map((row) => row.dedupe_key));
  }

  setStatus(id: string, status: ClassificationCorrectionStatus): void {
    this.db.query(`update classification_corrections set status = ? where id = ?`).run(status, id);
  }

  setDerivedProposalPath(id: string, derivedProposalPath: string): void {
    this.db
      .query(`update classification_corrections set derived_proposal_path = ? where id = ?`)
      .run(derivedProposalPath, id);
  }
}

function rowToCorrection(row: CorrectionRow): ClassificationCorrection {
  return {
    id: row.id,
    createdAt: row.created_at,
    source: row.source,
    targetSessionId: row.target_session_id,
    targetEventId: row.target_event_id,
    rawPath: row.raw_path,
    observed: JSON.parse(row.observed_json) as JsonValue,
    verdict: row.verdict,
    correction:
      row.correction_json === null ? null : (JSON.parse(row.correction_json) as JsonValue),
    derivedProposalPath: row.derived_proposal_path,
    status: row.status as ClassificationCorrectionStatus,
    dedupeKey: row.dedupe_key,
  };
}
