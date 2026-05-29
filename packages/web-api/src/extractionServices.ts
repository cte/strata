import { SessionStore } from "@strata/core/session-store";
import {
  DAILY_TODO_EXTRACTION,
  getExtractionCandidateInStore,
  listExtractionCandidates,
  listExtractionRuns,
  publishStoredDailyTodoCandidate,
  rejectExtractionCandidateInStore,
  type StoredExtractionCandidate,
  type StoredExtractionRun,
  sourceInfoForStoredDailyTodoCandidate,
} from "@strata/ingest/extraction";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type {
  DailyTodoCandidateAcceptRpcInput,
  DailyTodoCandidateListRpcInput,
  DailyTodoCandidateRejectRpcInput,
  DailyTodoCandidateResult,
  DailyTodoCandidateSummary,
  DailyTodoRunSummary,
  DailyTodoRunsListResult,
  DailyTodoRunsListRpcInput,
} from "./trpc.js";

export async function listDailyTodoExtractionRunsForWeb(
  input: DailyTodoRunsListRpcInput,
  options: WebApiOptions,
): Promise<DailyTodoRunsListResult> {
  const runs = await listExtractionRuns({
    repoRoot: repoRoot(options),
    name: DAILY_TODO_EXTRACTION.name,
    ...(input.day === undefined ? {} : { day: input.day }),
    limit: input.limit,
  });
  return {
    runs: runs.map(runToSummary),
  };
}

export async function listDailyTodoCandidatesForWeb(
  input: DailyTodoCandidateListRpcInput,
  options: WebApiOptions,
): Promise<{ candidates: DailyTodoCandidateSummary[] }> {
  const rows = await listExtractionCandidates({
    repoRoot: repoRoot(options),
    name: DAILY_TODO_EXTRACTION.name,
    ...(input.day === undefined ? {} : { day: input.day }),
    ...(input.status === "all" ? {} : { status: input.status }),
    ...(input.source === "all" ? {} : { sourceType: input.source }),
    ...(input.publication === "all" ? {} : { published: input.publication === "published" }),
    limit: input.limit,
  });
  const candidates = rows
    .filter((candidate) =>
      input.publication === "pending" ? candidate.status !== "rejected" : true,
    )
    .map(candidateToSummary);
  return { candidates };
}

export async function acceptDailyTodoCandidateForWeb(
  input: DailyTodoCandidateAcceptRpcInput,
  options: WebApiOptions,
): Promise<DailyTodoCandidateResult> {
  const publication = await publishStoredDailyTodoCandidate({
    repoRoot: repoRoot(options),
    candidateId: input.id,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...(input.actionText === undefined ? {} : { actionText: input.actionText }),
    ...(input.context === undefined ? {} : { context: input.context }),
  });
  const candidate = await getCandidateAfterMutation(input.id, options);
  return {
    candidate,
    publication,
  };
}

export async function rejectDailyTodoCandidateForWeb(
  input: DailyTodoCandidateRejectRpcInput,
  options: WebApiOptions,
): Promise<DailyTodoCandidateResult> {
  const store = await SessionStore.open(repoRoot(options));
  try {
    const rejected = rejectExtractionCandidateInStore(store, {
      id: input.id,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });
    if (rejected === null) {
      throw new Error(`Unknown extraction candidate: ${input.id}`);
    }
    return {
      candidate: candidateToSummary(rejected),
    };
  } finally {
    store.close();
  }
}

async function getCandidateAfterMutation(
  id: string,
  options: WebApiOptions,
): Promise<DailyTodoCandidateSummary> {
  const store = await SessionStore.open(repoRoot(options));
  try {
    const candidate = getExtractionCandidateInStore(store, id);
    if (candidate === null) {
      throw new Error(`Unknown extraction candidate: ${id}`);
    }
    return candidateToSummary(candidate);
  } finally {
    store.close();
  }
}

function runToSummary(run: StoredExtractionRun): DailyTodoRunSummary {
  return {
    id: run.id,
    name: run.name,
    day: run.day,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    extractorVersion: run.extractorVersion,
    verifierVersion: run.verifierVersion,
    modelName: run.modelName,
    sessionId: run.sessionId,
    dryRun: run.dryRun,
    candidateCount: run.candidateCount,
    rejectedCount: run.rejectedCount,
  };
}

function candidateToSummary(candidate: StoredExtractionCandidate): DailyTodoCandidateSummary {
  const source = sourceInfoForStoredDailyTodoCandidate(candidate);
  return {
    id: candidate.id,
    runId: candidate.runId,
    day: candidate.day,
    sourcePath: candidate.sourcePath,
    sourceKind: candidate.sourceKind,
    sourceType: candidate.sourceType,
    sourceTarget: source.target,
    sourceLabel: source.label,
    lineStart: candidate.lineStart,
    lineEnd: candidate.lineEnd,
    evidenceText: candidate.evidenceText,
    candidateKind: candidate.candidateKind,
    candidateText: candidate.candidateText,
    status: candidate.status,
    owner: candidate.verification.owner,
    actionText: candidate.verification.actionText,
    confidence: candidate.verification.confidence,
    rationale: candidate.verification.rationale,
    deterministicReasons: candidate.deterministicReasons,
    publishedTarget: candidate.publishedTarget,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  };
}
