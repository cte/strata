import type { JsonObject } from "@strata/core";

export type ExtractionSourceKind = "raw" | "source" | "curated";
export type ExtractionSourceType = "slack" | "granola" | "notion" | "wiki";

export interface ExtractionDefinition {
  name: string;
  extractorVersion: string;
}

export interface WikiCorpusDocument {
  path: string;
  sourceKind: ExtractionSourceKind;
  sourceType: ExtractionSourceType;
  date: string;
  title: string;
  body: string;
  bodyLineStart: number;
  frontmatter: Record<string, string>;
}

export interface EvidenceSpan {
  id: string;
  sourcePath: string;
  sourceKind: ExtractionSourceKind;
  sourceType: ExtractionSourceType;
  date: string;
  lineStart: number;
  lineEnd: number;
  text: string;
  contextText?: string;
  metadata: JsonObject;
}

export type TodoCandidateKind =
  | "direct_request"
  | "self_commitment"
  | "assigned_commitment"
  | "checkbox"
  | "owner_due";

export interface ExtractionCandidate {
  id: string;
  extractionName: string;
  candidateKind: TodoCandidateKind;
  evidenceSpanId: string;
  candidateText: string;
  candidateHash: string;
  deterministicReasons: string[];
  metadata: JsonObject;
}

export interface TodoVerification {
  classification: "action" | "not_action" | "needs_review";
  confidence: number;
  owner: "mine" | "theirs" | "unknown";
  actionText: string;
  dueDate?: string;
  rationale: string;
}

export interface TodoVerifier {
  version: string;
  modelName?: string;
  verify(candidate: ExtractionCandidate, span: EvidenceSpan): Promise<TodoVerification>;
}

export type TodoCandidateStatus = "confirmed" | "needs_review" | "rejected";

export interface TodoCandidateResult {
  status: TodoCandidateStatus;
  candidate: ExtractionCandidate;
  evidence: EvidenceSpan;
  verification: TodoVerification;
  reasons: string[];
}

export interface ExtractionSourceCount {
  documents: number;
  spans: number;
  candidates: number;
  rejected: number;
}

export type ExtractionSourceCounts = Record<ExtractionSourceType, ExtractionSourceCount>;

export interface DailyTodoExtractionResult {
  sessionId: string;
  extractionRunId: string;
  dryRun: boolean;
  extractionName: "daily.todo";
  extractorVersion: string;
  verifierVersion: string;
  modelName?: string;
  day: string;
  sourcesScanned: number;
  spanCount: number;
  candidateCount: number;
  rejectedCount: number;
  countsBySource: ExtractionSourceCounts;
  results: TodoCandidateResult[];
  candidates: TodoCandidateResult[];
  rejected: TodoCandidateResult[];
}

export type DailyTodoPublicationSkipReason =
  | "duplicate"
  | "low_confidence"
  | "needs_review"
  | "rejected"
  | "unknown_owner"
  | "previously_rejected";

export interface DailyTodoPublishedAction {
  candidateId: string;
  actionId: string;
  owner: "mine" | "theirs";
  actionPath: string;
  publishedTarget: string;
  title: string;
  sourceTarget: string;
}

export interface DailyTodoPublicationSkip {
  candidateId: string;
  reason: DailyTodoPublicationSkipReason;
  title: string;
  owner: TodoVerification["owner"];
  confidence: number;
}

export type DailyTodoReviewPublicationStatus = "published" | "duplicate" | "already_published";

export interface DailyTodoReviewPublicationResult {
  status: DailyTodoReviewPublicationStatus;
  candidateId: string;
  publishedTarget: string;
  action?: DailyTodoPublishedAction;
  skipped?: DailyTodoPublicationSkip;
}

export interface DailyTodoApplyResult {
  extractionName: "daily.todo";
  day: string;
  dryRun: false;
  extractionRunId: string;
  sessionId: string;
  verifierVersion: string;
  modelName?: string;
  candidateCount: number;
  publishedCount: number;
  skippedCount: number;
  pendingReviewCount: number;
  rejectedCount: number;
  extraction: DailyTodoExtractionResult;
  published: DailyTodoPublishedAction[];
  skipped: DailyTodoPublicationSkip[];
}

export type DailyTodoBackfillItem =
  | {
      status: "processed";
      day: string;
      result: DailyTodoExtractionResult | DailyTodoApplyResult;
    }
  | {
      status: "skipped";
      day: string;
      existingRunId: string;
      reason: "completed_run_exists";
    };

export interface DailyTodoBackfillResult {
  extractionName: "daily.todo";
  from: string;
  to: string;
  dryRun: boolean;
  processed: number;
  skipped: number;
  candidateCount: number;
  rejectedCount: number;
  publishedCount: number;
  publicationSkippedCount: number;
  pendingReviewCount: number;
  items: DailyTodoBackfillItem[];
}
