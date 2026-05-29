import { createHash } from "node:crypto";
import path from "node:path";
import {
  addWikiAction,
  type JsonObject,
  listWikiActions,
  SessionStore,
  type WikiActionContextMetadata,
  type WikiActionItem,
  type WikiActionOwner,
} from "@strata/core";
import { type ResolveDailyTodoCorpusOptions, resolveDailyTodoCorpus } from "./corpus.js";
import { evidenceSpansForDocuments } from "./spans.js";
import {
  extractionCandidateStorageIdForResult,
  extractionRunIdForSession,
  findCompletedExtractionRun,
  getExtractionCandidateInStore,
  getExtractionRunInStore,
  listExtractionCandidatesInStore,
  persistDailyTodoExtractionResult,
  type StoredExtractionCandidate,
  type StoredExtractionRun,
  updateExtractionCandidatePublishedTargetInStore,
  updateExtractionCandidateVerificationInStore,
} from "./store.js";
import type {
  DailyTodoApplyResult,
  DailyTodoBackfillItem,
  DailyTodoBackfillResult,
  DailyTodoExtractionResult,
  DailyTodoPublicationSkip,
  DailyTodoPublishedAction,
  DailyTodoReviewPublicationResult,
  EvidenceSpan,
  ExtractionCandidate,
  ExtractionDefinition,
  ExtractionSourceCounts,
  TodoCandidateKind,
  TodoCandidateResult,
  TodoVerification,
  TodoVerifier,
} from "./types.js";

export const DAILY_TODO_EXTRACTION: ExtractionDefinition = {
  name: "daily.todo",
  extractorVersion: "daily.todo.det-v1",
};

export const DAILY_TODO_PUBLICATION_MIN_CONFIDENCE = 0.8;
export const DAILY_TODO_VERIFIER_CONCURRENCY = 8;

export interface RunDailyTodoExtractionDryRunOptions {
  repoRoot: string;
  day: string;
  paths?: string[];
  limit?: number;
  verifier?: TodoVerifier;
}

export interface RunDailyTodoExtractionBackfillDryRunOptions {
  repoRoot: string;
  from: string;
  to: string;
  paths?: string[];
  limit?: number;
  verifier?: TodoVerifier;
  force?: boolean;
}

export interface RunDailyTodoExtractionBackfillApplyOptions
  extends RunDailyTodoExtractionBackfillDryRunOptions {
  now?: Date;
}

export interface RunDailyTodoExtractionApplyOptions extends RunDailyTodoExtractionDryRunOptions {
  now?: Date;
}

export interface PublishStoredDailyTodoCandidateOptions {
  repoRoot: string;
  candidateId: string;
  owner?: WikiActionOwner;
  actionText?: string;
  context?: string;
  now?: Date;
}

export interface PublishDailyTodoCandidateResultsInStoreOptions {
  repoRoot: string;
  store: SessionStore;
  sessionId: string;
  extractionRunId: string;
  day: string;
  sourceDocuments: { sourceType: "slack" | "granola" | "notion" | "wiki"; path: string }[];
  spans: EvidenceSpan[];
  results: TodoCandidateResult[];
  extractorVersion?: string;
  verifierVersion: string;
  modelName?: string;
  now?: Date;
  traceSource?: string;
}

export interface PublishDailyTodoCandidateResultsInStoreResult {
  extraction: DailyTodoExtractionResult;
  candidateIds: string[];
  published: DailyTodoPublishedAction[];
  skipped: DailyTodoPublicationSkip[];
}

interface CandidateDraft {
  kind: TodoCandidateKind;
  text: string;
  reasons: string[];
}

export const fakeDailyTodoVerifier: TodoVerifier = {
  version: "fake.todo-verifier-v1",
  async verify(candidate, span) {
    return fakeVerifyTodoCandidate(candidate, span);
  },
};

export async function runDailyTodoExtractionDryRun(
  options: RunDailyTodoExtractionDryRunOptions,
): Promise<DailyTodoExtractionResult> {
  const output = await runDailyTodoExtraction({
    mode: "dry_run",
    repoRoot: options.repoRoot,
    day: options.day,
    ...(options.paths === undefined ? {} : { paths: options.paths }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.verifier === undefined ? {} : { verifier: options.verifier }),
  });
  return output.result;
}

export async function runDailyTodoExtractionApply(
  options: RunDailyTodoExtractionApplyOptions,
): Promise<DailyTodoApplyResult> {
  const output = await runDailyTodoExtraction({
    mode: "apply",
    repoRoot: options.repoRoot,
    day: options.day,
    ...(options.paths === undefined ? {} : { paths: options.paths }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.verifier === undefined ? {} : { verifier: options.verifier }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const extraction = output.result;
  const publication = output.publication ?? { published: [], skipped: [] };
  return {
    extractionName: "daily.todo",
    day: extraction.day,
    dryRun: false,
    extractionRunId: extraction.extractionRunId,
    sessionId: extraction.sessionId,
    verifierVersion: extraction.verifierVersion,
    ...(extraction.modelName === undefined ? {} : { modelName: extraction.modelName }),
    candidateCount: extraction.candidateCount,
    publishedCount: publication.published.length,
    skippedCount: publication.skipped.length,
    pendingReviewCount: publication.skipped.filter((item) =>
      ["needs_review", "unknown_owner", "low_confidence"].includes(item.reason),
    ).length,
    rejectedCount: extraction.rejectedCount,
    extraction,
    published: publication.published,
    skipped: publication.skipped,
  };
}

export async function publishStoredDailyTodoCandidate(
  options: PublishStoredDailyTodoCandidateOptions,
): Promise<DailyTodoReviewPublicationResult> {
  const store = await SessionStore.open(options.repoRoot);
  try {
    return await publishStoredDailyTodoCandidateInStore({
      repoRoot: options.repoRoot,
      store,
      candidateId: options.candidateId,
      ...(options.owner === undefined ? {} : { owner: options.owner }),
      ...(options.actionText === undefined ? {} : { actionText: options.actionText }),
      ...(options.context === undefined ? {} : { context: options.context }),
      now: options.now ?? new Date(),
    });
  } finally {
    store.close();
  }
}

export function sourceInfoForStoredDailyTodoCandidate(candidate: StoredExtractionCandidate): {
  target: string;
  label: string;
} {
  return {
    target: sourceTargetForStoredCandidate(candidate),
    label: sourceLabelForStoredCandidate(candidate),
  };
}

export async function publishDailyTodoCandidateResultsInStore(
  options: PublishDailyTodoCandidateResultsInStoreOptions,
): Promise<PublishDailyTodoCandidateResultsInStoreResult> {
  const now = options.now ?? new Date();
  await options.store.appendEvent(options.sessionId, "extraction.daily_todo.started", {
    extractionRunId: options.extractionRunId,
    extractionName: DAILY_TODO_EXTRACTION.name,
    extractorVersion: options.extractorVersion ?? DAILY_TODO_EXTRACTION.extractorVersion,
    verifierVersion: options.verifierVersion,
    modelName: options.modelName ?? null,
    day: options.day,
    dryRun: false,
    sourceCount: options.sourceDocuments.length,
    spanCount: options.spans.length,
    paths: options.sourceDocuments.map((document) => document.path),
    traceSource: options.traceSource ?? null,
  });

  for (const result of options.results) {
    await options.store.appendEvent(options.sessionId, "extraction.daily_todo.candidate", {
      extractionRunId: options.extractionRunId,
      status: result.status,
      sourcePath: result.evidence.sourcePath,
      sourceType: result.evidence.sourceType,
      lineStart: result.evidence.lineStart,
      lineEnd: result.evidence.lineEnd,
      candidateHash: result.candidate.candidateHash,
      candidateKind: result.candidate.candidateKind,
      candidateText: result.candidate.candidateText,
      classification: result.verification.classification,
      confidence: result.verification.confidence,
      reasons: result.reasons,
      traceSource: options.traceSource ?? null,
    });
  }

  const extraction = dailyTodoResult({
    sessionId: options.sessionId,
    extractionRunId: options.extractionRunId,
    dryRun: false,
    day: options.day,
    documents: options.sourceDocuments,
    spans: options.spans,
    documentsScanned: options.sourceDocuments.length,
    spanCount: options.spans.length,
    extractorVersion: options.extractorVersion ?? DAILY_TODO_EXTRACTION.extractorVersion,
    verifierVersion: options.verifierVersion,
    ...(options.modelName === undefined ? {} : { modelName: options.modelName }),
    results: options.results,
  });

  persistDailyTodoExtractionResult(options.store, extraction);
  const publication = await publishDailyTodoCandidates({
    repoRoot: options.repoRoot,
    store: options.store,
    result: extraction,
    now,
  });

  for (const published of publication.published) {
    await options.store.appendEvent(options.sessionId, "extraction.daily_todo.published", {
      extractionRunId: extraction.extractionRunId,
      candidateId: published.candidateId,
      owner: published.owner,
      actionPath: published.actionPath,
      publishedTarget: published.publishedTarget,
      sourceTarget: published.sourceTarget,
      traceSource: options.traceSource ?? null,
    });
  }
  for (const skipped of publication.skipped) {
    await options.store.appendEvent(
      options.sessionId,
      "extraction.daily_todo.publication_skipped",
      {
        extractionRunId: extraction.extractionRunId,
        candidateId: skipped.candidateId,
        reason: skipped.reason,
        owner: skipped.owner,
        confidence: skipped.confidence,
        traceSource: options.traceSource ?? null,
      },
    );
  }

  await options.store.appendEvent(options.sessionId, "extraction.daily_todo.completed", {
    extractionRunId: extraction.extractionRunId,
    extractionName: extraction.extractionName,
    extractorVersion: extraction.extractorVersion,
    verifierVersion: extraction.verifierVersion,
    modelName: extraction.modelName ?? null,
    day: extraction.day,
    dryRun: extraction.dryRun,
    sourcesScanned: extraction.sourcesScanned,
    spanCount: extraction.spanCount,
    candidateCount: extraction.candidateCount,
    rejectedCount: extraction.rejectedCount,
    publishedCount: publication.published.length,
    publicationSkippedCount: publication.skipped.length,
    countsBySource: extraction.countsBySource as unknown as JsonObject,
    traceSource: options.traceSource ?? null,
  });

  return {
    extraction,
    candidateIds: extraction.results.map((result) =>
      extractionCandidateStorageIdForResult(extraction, result),
    ),
    published: publication.published,
    skipped: publication.skipped,
  };
}

interface DailyTodoExtractionRunOutput {
  result: DailyTodoExtractionResult;
  publication?: {
    published: DailyTodoPublishedAction[];
    skipped: DailyTodoPublicationSkip[];
  };
}

async function runDailyTodoExtraction(
  options: RunDailyTodoExtractionDryRunOptions & {
    mode: "dry_run" | "apply";
    now?: Date;
  },
): Promise<DailyTodoExtractionRunOutput> {
  const verifier = options.verifier ?? fakeDailyTodoVerifier;
  const corpusOptions: ResolveDailyTodoCorpusOptions = {
    repoRoot: options.repoRoot,
    day: options.day,
  };
  if (options.paths !== undefined) {
    corpusOptions.paths = options.paths;
  }
  if (options.limit !== undefined) {
    corpusOptions.limit = options.limit;
  }
  const documents = await resolveDailyTodoCorpus(corpusOptions);
  const spans = evidenceSpansForDocuments(documents);
  const store = await SessionStore.open(options.repoRoot);
  const session = await store.createSession({
    kind: "ingest",
    title:
      options.mode === "dry_run"
        ? `Dry-run daily.todo extraction for ${options.day}`
        : `Apply daily.todo extraction for ${options.day}`,
  });
  const extractionRunId = extractionRunIdForSession(session.id);

  try {
    await store.appendEvent(session.id, "extraction.daily_todo.started", {
      extractionRunId,
      extractionName: DAILY_TODO_EXTRACTION.name,
      extractorVersion: DAILY_TODO_EXTRACTION.extractorVersion,
      verifierVersion: verifier.version,
      modelName: verifier.modelName ?? null,
      day: options.day,
      dryRun: options.mode === "dry_run",
      sourceCount: documents.length,
      spanCount: spans.length,
      paths: options.paths ?? [],
    });

    const results = await evaluateTodoCandidates(spans, verifier);
    for (const result of results) {
      await store.appendEvent(session.id, "extraction.daily_todo.candidate", {
        status: result.status,
        sourcePath: result.evidence.sourcePath,
        sourceType: result.evidence.sourceType,
        lineStart: result.evidence.lineStart,
        lineEnd: result.evidence.lineEnd,
        candidateHash: result.candidate.candidateHash,
        candidateKind: result.candidate.candidateKind,
        candidateText: result.candidate.candidateText,
        classification: result.verification.classification,
        confidence: result.verification.confidence,
        reasons: result.reasons,
      });
    }

    const output = dailyTodoResult({
      sessionId: session.id,
      extractionRunId,
      dryRun: options.mode === "dry_run",
      day: options.day,
      documents,
      spans,
      documentsScanned: documents.length,
      spanCount: spans.length,
      verifierVersion: verifier.version,
      ...(verifier.modelName === undefined ? {} : { modelName: verifier.modelName }),
      results,
    });

    persistDailyTodoExtractionResult(store, output);

    const publication =
      options.mode === "apply"
        ? await publishDailyTodoCandidates({
            repoRoot: options.repoRoot,
            store,
            result: output,
            now: options.now ?? new Date(),
          })
        : undefined;

    for (const published of publication?.published ?? []) {
      await store.appendEvent(session.id, "extraction.daily_todo.published", {
        extractionRunId: output.extractionRunId,
        candidateId: published.candidateId,
        owner: published.owner,
        actionPath: published.actionPath,
        publishedTarget: published.publishedTarget,
        sourceTarget: published.sourceTarget,
      });
    }
    for (const skipped of publication?.skipped ?? []) {
      await store.appendEvent(session.id, "extraction.daily_todo.publication_skipped", {
        extractionRunId: output.extractionRunId,
        candidateId: skipped.candidateId,
        reason: skipped.reason,
        owner: skipped.owner,
        confidence: skipped.confidence,
      });
    }

    await store.appendEvent(session.id, "extraction.daily_todo.completed", {
      extractionRunId: output.extractionRunId,
      extractionName: output.extractionName,
      extractorVersion: output.extractorVersion,
      verifierVersion: output.verifierVersion,
      modelName: output.modelName ?? null,
      day: output.day,
      dryRun: output.dryRun,
      sourcesScanned: output.sourcesScanned,
      spanCount: output.spanCount,
      candidateCount: output.candidateCount,
      rejectedCount: output.rejectedCount,
      publishedCount: publication?.published.length ?? 0,
      publicationSkippedCount: publication?.skipped.length ?? 0,
      countsBySource: output.countsBySource as unknown as JsonObject,
    });
    await store.endSession(session.id, "completed");
    return publication === undefined ? { result: output } : { result: output, publication };
  } catch (error) {
    await store.appendEvent(session.id, "extraction.daily_todo.failed", {
      message: error instanceof Error ? error.message : String(error),
      day: options.day,
    });
    await store.endSession(session.id, "failed");
    throw error;
  } finally {
    store.close();
  }
}

export async function runDailyTodoExtractionBackfillDryRun(
  options: RunDailyTodoExtractionBackfillDryRunOptions,
): Promise<DailyTodoBackfillResult> {
  return runDailyTodoExtractionBackfill({ ...options, mode: "dry_run" });
}

export async function runDailyTodoExtractionBackfillApply(
  options: RunDailyTodoExtractionBackfillApplyOptions,
): Promise<DailyTodoBackfillResult> {
  return runDailyTodoExtractionBackfill({ ...options, mode: "apply" });
}

async function runDailyTodoExtractionBackfill(
  options: (
    | RunDailyTodoExtractionBackfillDryRunOptions
    | RunDailyTodoExtractionBackfillApplyOptions
  ) & {
    mode: "dry_run" | "apply";
  },
): Promise<DailyTodoBackfillResult> {
  assertIsoDay(options.from, "from");
  assertIsoDay(options.to, "to");
  if (options.from > options.to) {
    throw new Error(
      `Backfill from date must be on or before to date: ${options.from} > ${options.to}`,
    );
  }
  const verifier = options.verifier ?? fakeDailyTodoVerifier;
  const items: DailyTodoBackfillItem[] = [];
  for (const day of daysInRange(options.from, options.to)) {
    if (options.force !== true) {
      const lookup = {
        repoRoot: options.repoRoot,
        name: DAILY_TODO_EXTRACTION.name,
        day,
        extractorVersion: DAILY_TODO_EXTRACTION.extractorVersion,
        verifierVersion: verifier.version,
        dryRun: options.mode === "dry_run",
      };
      if (verifier.modelName !== undefined) {
        Object.assign(lookup, { modelName: verifier.modelName });
      }
      const existing = await findCompletedExtractionRun(lookup);
      if (existing !== null) {
        items.push({
          status: "skipped",
          day,
          existingRunId: existing.id,
          reason: "completed_run_exists",
        });
        continue;
      }
    }
    const runOptions: RunDailyTodoExtractionDryRunOptions = {
      repoRoot: options.repoRoot,
      day,
      verifier,
    };
    if (options.paths !== undefined) {
      runOptions.paths = options.paths;
    }
    if (options.limit !== undefined) {
      runOptions.limit = options.limit;
    }
    const result =
      options.mode === "apply"
        ? await runDailyTodoExtractionApply(dailyTodoApplyOptions(runOptions, options))
        : await runDailyTodoExtractionDryRun(runOptions);
    items.push({
      status: "processed",
      day,
      result,
    });
  }
  return {
    extractionName: "daily.todo",
    from: options.from,
    to: options.to,
    dryRun: options.mode === "dry_run",
    processed: items.filter((item) => item.status === "processed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    candidateCount: items.reduce(
      (total, item) => total + (item.status === "processed" ? item.result.candidateCount : 0),
      0,
    ),
    rejectedCount: items.reduce(
      (total, item) => total + (item.status === "processed" ? item.result.rejectedCount : 0),
      0,
    ),
    publishedCount: items.reduce(
      (total, item) =>
        total +
        (item.status === "processed" && "publishedCount" in item.result
          ? item.result.publishedCount
          : 0),
      0,
    ),
    publicationSkippedCount: items.reduce(
      (total, item) =>
        total +
        (item.status === "processed" && "skippedCount" in item.result
          ? item.result.skippedCount
          : 0),
      0,
    ),
    pendingReviewCount: items.reduce(
      (total, item) =>
        total +
        (item.status === "processed" && "pendingReviewCount" in item.result
          ? item.result.pendingReviewCount
          : 0),
      0,
    ),
    items,
  };
}

function dailyTodoApplyOptions(
  runOptions: RunDailyTodoExtractionDryRunOptions,
  backfillOptions:
    | RunDailyTodoExtractionBackfillDryRunOptions
    | RunDailyTodoExtractionBackfillApplyOptions,
): RunDailyTodoExtractionApplyOptions {
  const applyOptions: RunDailyTodoExtractionApplyOptions = { ...runOptions };
  if ("now" in backfillOptions && backfillOptions.now !== undefined) {
    applyOptions.now = backfillOptions.now;
  }
  return applyOptions;
}

export async function evaluateTodoCandidates(
  spans: EvidenceSpan[],
  verifier: TodoVerifier = fakeDailyTodoVerifier,
): Promise<TodoCandidateResult[]> {
  const seen = new Set<string>();
  const pending: { candidate: ExtractionCandidate; span: EvidenceSpan }[] = [];
  for (const span of spans) {
    for (const candidate of deterministicTodoCandidates(span)) {
      if (seen.has(candidate.candidateHash)) {
        continue;
      }
      seen.add(candidate.candidateHash);
      pending.push({ candidate, span });
    }
  }
  return mapWithConcurrency(
    pending,
    DAILY_TODO_VERIFIER_CONCURRENCY,
    async ({ candidate, span }) => {
      const verification =
        hardRejectionVerification(candidate, span) ?? (await verifier.verify(candidate, span));
      const status = statusForVerification(verification);
      return {
        status,
        candidate,
        evidence: span,
        verification,
        reasons: [...candidate.deterministicReasons, verification.rationale],
      };
    },
  );
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) {
        continue;
      }
      results[index] = await mapper(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export function deterministicTodoCandidates(span: EvidenceSpan): ExtractionCandidate[] {
  const suppressedReasons = deterministicSuppressionReasons(span);
  const draft = todoCandidateDraft(span);
  if (draft === null) {
    return [];
  }
  const candidateText = normalizeCandidateText(draft.text);
  if (candidateText === "") {
    return [];
  }
  const deterministicReasons = [...draft.reasons, ...suppressedReasons];
  const candidateHash = hashCandidate(span, draft.kind, candidateText);
  return [
    {
      id: `todo_${candidateHash}`,
      extractionName: DAILY_TODO_EXTRACTION.name,
      candidateKind: draft.kind,
      evidenceSpanId: span.id,
      candidateText,
      candidateHash,
      deterministicReasons,
      metadata: {
        sourcePath: span.sourcePath,
        sourceType: span.sourceType,
        lineStart: span.lineStart,
        lineEnd: span.lineEnd,
      },
    },
  ];
}

function todoCandidateDraft(span: EvidenceSpan): CandidateDraft | null {
  const text = span.text.trim();
  const checkbox = /^[-*]?\s*\[[ x]\]\s*(.+)$/i.exec(text);
  if (checkbox) {
    return {
      kind: "checkbox",
      text: checkbox[1]?.trim() ?? text,
      reasons: ["task_list_marker"],
    };
  }
  const ownerDue = /^(?:action item|todo|follow[- ]?up|next step)\s*:\s*(.+)$/i.exec(text);
  if (ownerDue) {
    return {
      kind: "owner_due",
      text: ownerDue[1]?.trim() ?? text,
      reasons: ["explicit_action_label"],
    };
  }
  const embeddedOwnerDue = /\b(?:action item|todo|follow[- ]?up|next step)\s*:\s*(.+)$/i.exec(text);
  if (embeddedOwnerDue) {
    return {
      kind: "owner_due",
      text: embeddedOwnerDue[1]?.trim() ?? text,
      reasons: ["embedded_action_label"],
    };
  }
  if (/\b(?:owner|assignee)\s*:\s*\S+/i.test(text) || /\bdue\s*:\s*\S+/i.test(text)) {
    return { kind: "owner_due", text, reasons: ["owner_or_due_marker"] };
  }
  const slackHumanCommitment = slackFirstPersonCommitmentWithSpeaker(span);
  if (slackHumanCommitment !== null) {
    return {
      kind: "assigned_commitment",
      text: slackHumanCommitment,
      reasons: ["slack_human_first_person_commitment"],
    };
  }
  if (isFirstPersonCommitment(text)) {
    return { kind: "self_commitment", text, reasons: ["first_person_commitment"] };
  }
  if (isAssignedCommitment(text)) {
    return { kind: "assigned_commitment", text, reasons: ["assigned_commitment"] };
  }
  if (isDirectRequest(text)) {
    return { kind: "direct_request", text, reasons: ["direct_request"] };
  }
  return null;
}

async function publishDailyTodoCandidates(options: {
  repoRoot: string;
  store: SessionStore;
  result: DailyTodoExtractionResult;
  now: Date;
}): Promise<{
  published: DailyTodoPublishedAction[];
  skipped: DailyTodoPublicationSkip[];
}> {
  const stored = new Map(
    listExtractionCandidatesInStore(options.store, {
      name: options.result.extractionName,
      day: options.result.day,
    }).map((candidate) => [candidate.id, candidate]),
  );
  const existingActions = await listWikiActions(options.repoRoot, {
    owner: "all",
    status: "all",
  });
  const existingKeys = new Map<string, WikiActionItem>();
  for (const action of existingActions) {
    if (action.source === undefined) {
      continue;
    }
    existingKeys.set(actionDedupeKey(action.owner, action.title, action.source.target), action);
  }

  const published: DailyTodoPublishedAction[] = [];
  const skipped: DailyTodoPublicationSkip[] = [];

  for (const item of options.result.results) {
    const candidateId = extractionCandidateStorageIdForResult(options.result, item);
    const storedCandidate = stored.get(candidateId);
    const skipReason = publicationSkipReason(item, storedCandidate?.status);
    if (skipReason !== null) {
      skipped.push(publicationSkip(candidateId, item, skipReason));
      continue;
    }

    const owner = item.verification.owner;
    if (owner !== "mine" && owner !== "theirs") {
      skipped.push(publicationSkip(candidateId, item, "unknown_owner"));
      continue;
    }

    const sourceTarget = sourceTargetForEvidence(item.evidence);
    const sourceLabel = sourceLabelForEvidence(item.evidence);
    const dedupeKey = actionDedupeKey(owner, item.verification.actionText, sourceTarget);
    const duplicate = existingKeys.get(dedupeKey);
    if (duplicate !== undefined) {
      const publishedTarget = `${duplicate.path}:${duplicate.line}`;
      updateExtractionCandidatePublishedTargetInStore(options.store, {
        id: candidateId,
        publishedTarget,
      });
      skipped.push(publicationSkip(candidateId, item, "duplicate"));
      continue;
    }

    const action = await addWikiAction(options.repoRoot, {
      owner,
      title: item.verification.actionText,
      source: {
        target: sourceTarget,
        label: sourceLabel,
      },
      metadata: publicationMetadata(options.result, item, candidateId),
      now: options.now,
    });
    const publishedTarget = `${action.path}:${action.line}`;
    updateExtractionCandidatePublishedTargetInStore(options.store, {
      id: candidateId,
      publishedTarget,
    });
    existingKeys.set(dedupeKey, action);
    published.push({
      candidateId,
      actionId: action.id,
      owner,
      actionPath: action.path,
      publishedTarget,
      title: action.title,
      sourceTarget,
    });
  }

  return { published, skipped };
}

async function publishStoredDailyTodoCandidateInStore(options: {
  repoRoot: string;
  store: SessionStore;
  candidateId: string;
  owner?: WikiActionOwner;
  actionText?: string;
  context?: string;
  now: Date;
}): Promise<DailyTodoReviewPublicationResult> {
  const candidate = getExtractionCandidateInStore(options.store, options.candidateId);
  if (candidate === null) {
    throw new Error(`Unknown extraction candidate: ${options.candidateId}`);
  }
  if (candidate.name !== DAILY_TODO_EXTRACTION.name) {
    throw new Error(`Candidate ${options.candidateId} is not a daily.todo candidate.`);
  }
  if (candidate.publishedTarget !== null) {
    return {
      status: "already_published",
      candidateId: candidate.id,
      publishedTarget: candidate.publishedTarget,
    };
  }
  if (candidate.status === "rejected") {
    throw new Error(`Candidate ${options.candidateId} has already been rejected.`);
  }

  const run = getExtractionRunInStore(options.store, candidate.runId);
  if (run === null) {
    throw new Error(`Candidate ${options.candidateId} references a missing extraction run.`);
  }

  const owner = options.owner ?? candidate.verification.owner;
  if (owner !== "mine" && owner !== "theirs") {
    throw new Error("Accepting a daily TODO candidate requires owner = mine or theirs.");
  }
  const actionText = (options.actionText ?? candidate.verification.actionText).trim();
  if (actionText.length === 0) {
    throw new Error("Accepting a daily TODO candidate requires non-empty action text.");
  }

  const effectiveVerification = reviewedVerification(candidate.verification, {
    owner,
    actionText,
  });
  const sourceTarget = sourceTargetForStoredCandidate(candidate);
  const sourceLabel = sourceLabelForStoredCandidate(candidate);
  const existingActions = await listWikiActions(options.repoRoot, {
    owner: "all",
    status: "all",
  });
  const duplicate = existingActions.find(
    (action) =>
      action.source !== undefined &&
      actionDedupeKey(owner, action.title, action.source.target) ===
        actionDedupeKey(owner, actionText, sourceTarget),
  );

  const reviewMetadata = acceptedReviewMetadata(candidate.metadata, options.now);
  const confirmCandidate = (publishedTarget: string): void => {
    updateExtractionCandidateVerificationInStore(options.store, {
      id: candidate.id,
      status: "confirmed",
      verification: effectiveVerification,
      metadata: reviewMetadata,
    });
    updateExtractionCandidatePublishedTargetInStore(options.store, {
      id: candidate.id,
      publishedTarget,
    });
  };

  if (duplicate !== undefined) {
    const publishedTarget = `${duplicate.path}:${duplicate.line}`;
    confirmCandidate(publishedTarget);
    return {
      status: "duplicate",
      candidateId: candidate.id,
      publishedTarget,
      skipped: {
        candidateId: candidate.id,
        reason: "duplicate",
        title: actionText,
        owner,
        confidence: effectiveVerification.confidence,
      },
    };
  }

  const action = await addWikiAction(options.repoRoot, {
    owner,
    title: actionText,
    source: {
      target: sourceTarget,
      label: sourceLabel,
    },
    metadata: publicationMetadataForStoredCandidate(run, candidate, effectiveVerification),
    ...(options.context === undefined || options.context.trim().length === 0
      ? {}
      : { context: options.context.trim() }),
    now: options.now,
  });
  const publishedTarget = `${action.path}:${action.line}`;
  confirmCandidate(publishedTarget);
  return {
    status: "published",
    candidateId: candidate.id,
    publishedTarget,
    action: {
      candidateId: candidate.id,
      actionId: action.id,
      owner,
      actionPath: action.path,
      publishedTarget,
      title: action.title,
      sourceTarget,
    },
  };
}

function publicationSkipReason(
  item: TodoCandidateResult,
  storedStatus: TodoCandidateResult["status"] | undefined,
): DailyTodoPublicationSkip["reason"] | null {
  if (storedStatus === "rejected" && item.status !== "rejected") {
    return "previously_rejected";
  }
  if (item.status === "rejected") {
    return "rejected";
  }
  if (item.status === "needs_review") {
    return "needs_review";
  }
  if (item.verification.confidence < DAILY_TODO_PUBLICATION_MIN_CONFIDENCE) {
    return "low_confidence";
  }
  return null;
}

function publicationSkip(
  candidateId: string,
  item: TodoCandidateResult,
  reason: DailyTodoPublicationSkip["reason"],
): DailyTodoPublicationSkip {
  return {
    candidateId,
    reason,
    title: item.verification.actionText,
    owner: item.verification.owner,
    confidence: item.verification.confidence,
  };
}

function publicationMetadata(
  result: DailyTodoExtractionResult,
  item: TodoCandidateResult,
  candidateId: string,
): WikiActionContextMetadata {
  const metadata: WikiActionContextMetadata = {
    extractionName: result.extractionName,
    extractionRunId: result.extractionRunId,
    extractionCandidateId: candidateId,
    extractorVersion: result.extractorVersion,
    verifierVersion: result.verifierVersion,
    confidence: item.verification.confidence,
    sourcePath: item.evidence.sourcePath,
    lineStart: item.evidence.lineStart,
    lineEnd: item.evidence.lineEnd,
  };
  if (result.modelName !== undefined) {
    metadata.modelName = result.modelName;
  }
  return metadata;
}

function publicationMetadataForStoredCandidate(
  run: StoredExtractionRun,
  candidate: StoredExtractionCandidate,
  verification: TodoVerification,
): WikiActionContextMetadata {
  const metadata: WikiActionContextMetadata = {
    extractionName: candidate.name,
    extractionRunId: run.id,
    extractionCandidateId: candidate.id,
    extractorVersion: run.extractorVersion,
    verifierVersion: run.verifierVersion,
    confidence: verification.confidence,
    sourcePath: candidate.sourcePath,
    lineStart: candidate.lineStart,
    lineEnd: candidate.lineEnd,
    reviewed: true,
  };
  if (run.modelName !== null) {
    metadata.modelName = run.modelName;
  }
  return metadata;
}

function reviewedVerification(
  verification: TodoVerification,
  options: { owner: WikiActionOwner; actionText: string },
): TodoVerification {
  return {
    ...verification,
    classification: "action",
    owner: options.owner,
    actionText: options.actionText,
    confidence: Math.max(verification.confidence, DAILY_TODO_PUBLICATION_MIN_CONFIDENCE),
    rationale:
      verification.rationale.trim().length > 0
        ? `${verification.rationale} Reviewed and accepted in /actions.`
        : "Reviewed and accepted in /actions.",
  };
}

function acceptedReviewMetadata(metadata: JsonObject, now: Date): JsonObject {
  return {
    ...metadata,
    review: {
      status: "accepted",
      reviewedAt: now.toISOString(),
    },
  };
}

function actionDedupeKey(owner: WikiActionOwner, title: string, sourceTarget: string): string {
  return [owner, normalizeDedupeText(title), normalizeDedupeText(sourceTarget)].join("\n");
}

function normalizeDedupeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sourceTargetForEvidence(evidence: EvidenceSpan): string {
  const metadataTarget =
    typeof evidence.metadata.sourceTarget === "string" ? evidence.metadata.sourceTarget.trim() : "";
  const sourcePath = metadataTarget === "" ? evidence.sourcePath : metadataTarget;
  const withoutWikiPrefix = sourcePath.startsWith(`wiki${path.sep}`)
    ? sourcePath.slice(`wiki${path.sep}`.length)
    : sourcePath;
  return withoutWikiPrefix.replace(/\.md$/i, "").split(path.sep).join("/");
}

function sourceLabelForEvidence(evidence: EvidenceSpan): string {
  const label =
    typeof evidence.metadata.sourceLabel === "string" ? evidence.metadata.sourceLabel.trim() : "";
  if (label !== "") {
    return truncateLabel(label);
  }
  const title = typeof evidence.metadata.title === "string" ? evidence.metadata.title.trim() : "";
  if (title !== "") {
    return truncateLabel(title);
  }
  return truncateLabel(path.basename(sourceTargetForEvidence(evidence)).replace(/-/g, " "));
}

function sourceTargetForStoredCandidate(candidate: StoredExtractionCandidate): string {
  const metadata = evidenceMetadataForStoredCandidate(candidate);
  const metadataTarget =
    typeof metadata.sourceTarget === "string" ? metadata.sourceTarget.trim() : "";
  const sourcePath = metadataTarget === "" ? candidate.sourcePath : metadataTarget;
  const withoutWikiPrefix = sourcePath.startsWith(`wiki${path.sep}`)
    ? sourcePath.slice(`wiki${path.sep}`.length)
    : sourcePath;
  return withoutWikiPrefix.replace(/\.md$/i, "").split(path.sep).join("/");
}

function sourceLabelForStoredCandidate(candidate: StoredExtractionCandidate): string {
  const metadata = evidenceMetadataForStoredCandidate(candidate);
  const label = typeof metadata.sourceLabel === "string" ? metadata.sourceLabel.trim() : "";
  if (label !== "") {
    return truncateLabel(label);
  }
  const title = typeof metadata.title === "string" ? metadata.title.trim() : "";
  if (title !== "") {
    return truncateLabel(title);
  }
  return truncateLabel(path.basename(sourceTargetForStoredCandidate(candidate)).replace(/-/g, " "));
}

function evidenceMetadataForStoredCandidate(candidate: StoredExtractionCandidate): JsonObject {
  const value = candidate.metadata.evidenceMetadata;
  if (isJsonObject(value)) {
    return value;
  }
  return {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function truncateLabel(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 80 ? normalized.slice(0, 77).trimEnd() + "..." : normalized;
}

function fakeVerifyTodoCandidate(
  candidate: ExtractionCandidate,
  span: EvidenceSpan,
): TodoVerification {
  const hardRejection = hardRejectionVerification(candidate, span);
  if (hardRejection !== null) {
    return hardRejection;
  }
  const needsReviewReason = needsReviewReasonForCandidate(candidate);
  if (needsReviewReason !== null) {
    return {
      classification: "needs_review",
      confidence: 0.55,
      owner: "unknown",
      actionText: candidate.candidateText,
      rationale: needsReviewReason,
    };
  }
  return {
    classification: "action",
    confidence: confidenceForCandidate(candidate),
    owner: ownerForCandidate(candidate, span),
    actionText: candidate.candidateText,
    rationale: `fake verifier accepted ${candidate.candidateKind}`,
  };
}

function hardRejectionVerification(
  candidate: ExtractionCandidate,
  span: EvidenceSpan,
): TodoVerification | null {
  const negativeReason = verifierNegativeReason(candidate, span);
  if (negativeReason === null) {
    return null;
  }
  return {
    classification: "not_action",
    confidence: 0.97,
    owner: "unknown",
    actionText: candidate.candidateText,
    rationale: negativeReason,
  };
}

function deterministicSuppressionReasons(span: EvidenceSpan): string[] {
  const reasons: string[] = [];
  if (span.sourceType === "slack" && span.metadata.speakerKind === "bot_or_app") {
    reasons.push("slack_bot_or_app_speaker");
  }
  const text = normalizedLower(span.text);
  if (isServiceTicketNotification(text)) {
    reasons.push("service_ticket_notification");
  }
  if (/\bsearch:\s*\d+\b/.test(text)) {
    reasons.push("tool_search_count_output");
  }
  if (
    /^(?:scanned the last|i checked|i found|i scanned|this stayed read-only|what i checked|the strongest signal is|it is not waiting|assuming you mean)\b/.test(
      text,
    )
  ) {
    reasons.push("agent_or_status_report");
  }
  if (/^(?:update|status|progress):\s+/.test(text)) {
    reasons.push("agent_or_status_report");
  }
  if (/\bno code (?:change|fix) to ship\b/.test(text)) {
    reasons.push("no_code_change_outcome");
  }
  if (/^getting started on your task\b/.test(text)) {
    reasons.push("agent_progress_update");
  }
  return reasons;
}

function verifierNegativeReason(candidate: ExtractionCandidate, span: EvidenceSpan): string | null {
  const reasons = new Set(candidate.deterministicReasons);
  for (const reason of [
    "slack_bot_or_app_speaker",
    "service_ticket_notification",
    "tool_search_count_output",
    "agent_or_status_report",
    "no_code_change_outcome",
    "agent_progress_update",
  ]) {
    if (reasons.has(reason)) {
      return reason;
    }
  }
  const text = normalizedLower(candidate.candidateText);
  if (candidate.candidateKind === "self_commitment" && span.metadata.speakerKind === "user_id") {
    return "unattributed_slack_first_person_commitment";
  }
  if (candidate.candidateKind === "direct_request" && isEllipticalDirectRequest(text)) {
    return "elliptical_direct_request";
  }
  if (candidate.candidateKind === "direct_request" && isPreferenceQuestion(text)) {
    return "preference_question";
  }
  if (/^(?:we|i)\s+(?:should|might|could)\b/.test(text)) {
    return "unassigned_possibility_language";
  }
  if (text.length > 900) {
    return "candidate_too_long_for_action";
  }
  return null;
}

function needsReviewReasonForCandidate(candidate: ExtractionCandidate): string | null {
  const text = normalizedLower(candidate.candidateText);
  if (candidate.candidateKind === "direct_request" && /^can we\b/.test(text)) {
    return "direct_request_has_unclear_owner";
  }
  return null;
}

function statusForVerification(
  verification: TodoVerification,
): "confirmed" | "needs_review" | "rejected" {
  if (verification.classification === "not_action") {
    return "rejected";
  }
  if (verification.classification === "needs_review") {
    return "needs_review";
  }
  return "confirmed";
}

function ownerForCandidate(
  candidate: ExtractionCandidate,
  span: EvidenceSpan,
): "mine" | "theirs" | "unknown" {
  if (candidate.candidateKind === "self_commitment") {
    return "mine";
  }
  if (candidate.candidateKind === "assigned_commitment") {
    return "theirs";
  }
  if (candidate.candidateKind === "checkbox" || candidate.candidateKind === "owner_due") {
    return "unknown";
  }
  if (span.sourceType === "slack") {
    return "unknown";
  }
  return "unknown";
}

function confidenceForCandidate(candidate: ExtractionCandidate): number {
  if (candidate.candidateKind === "checkbox" || candidate.candidateKind === "owner_due") {
    return 0.9;
  }
  if (candidate.candidateKind === "assigned_commitment") {
    return 0.84;
  }
  return 0.78;
}

function isFirstPersonCommitment(text: string): boolean {
  return /^(?:i will|i'll|i am going to|i'm going to|i need to|i must)\b/i.test(text.trim());
}

function isAssignedCommitment(text: string): boolean {
  const trimmed = text.trim();
  if (
    /^(?:they|he|she)\s+(?:will|must|needs? to|owns?|is responsible for|is going to)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  const match =
    /^([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})\s+(?:will|must|needs? to|owns?|is responsible for|is going to)\b/.exec(
      trimmed,
    );
  if (match === null) {
    return false;
  }
  const firstWord = match[1]?.split(/\s+/)[0] ?? "";
  return !["A", "An", "I", "It", "That", "The", "This", "We", "You"].includes(firstWord);
}

function isDirectRequest(text: string): boolean {
  const trimmed = text.trim();
  return (
    /^(?:<@U[A-Z0-9]+>\s*)?(?:can you|could you|would you|please|make sure to|need you to|we need you to)\b/i.test(
      trimmed,
    ) ||
    /^(?:<@U[A-Z0-9]+>\s*)?(?:create|add|fix|update|remove|migrate|investigate|triage|review|follow up|send|draft|prepare|ship|deploy)\b/i.test(
      trimmed,
    )
  );
}

function slackFirstPersonCommitmentWithSpeaker(span: EvidenceSpan): string | null {
  if (span.sourceType !== "slack" || span.metadata.speakerKind !== "person") {
    return null;
  }
  const speaker = typeof span.metadata.speaker === "string" ? span.metadata.speaker.trim() : "";
  if (speaker === "") {
    return null;
  }
  const text = span.text.trim();
  const will = /^(?:I will|I'll)\s+(.+)$/i.exec(text);
  if (will) {
    return `${speaker} will ${will[1]?.trim() ?? ""}`;
  }
  const need = /^I need to\s+(.+)$/i.exec(text);
  if (need) {
    return `${speaker} needs to ${need[1]?.trim() ?? ""}`;
  }
  const going = /^(?:I am|I'm)\s+going to\s+(.+)$/i.exec(text);
  if (going) {
    return `${speaker} will ${going[1]?.trim() ?? ""}`;
  }
  return null;
}

function isServiceTicketNotification(text: string): boolean {
  return /\bnew support ticket:/.test(text) && /\b(?:requester|assignee|status):\s*\S+/.test(text);
}

function isEllipticalDirectRequest(text: string): boolean {
  const withoutMentions = text.replace(/^(?:(?:<@[a-z0-9]+>|@[a-z0-9]+)\s*)+/i, "").trim();
  return /^(?:please\s+)?do(?:\s+(?:it|this|that))?(?:[.!?]*|,\s+(?:i|we)\b.*)$/.test(
    withoutMentions,
  );
}

function isPreferenceQuestion(text: string): boolean {
  return /^(?:(?:<@[a-z0-9]+>|@[a-z0-9]+)\s*)?would you be (?:comfortable|ok|okay|open|willing)\b/.test(
    text,
  );
}

function dailyTodoResult(input: {
  sessionId: string;
  extractionRunId: string;
  dryRun: boolean;
  day: string;
  documents: { sourceType: "slack" | "granola" | "notion" | "wiki"; path: string }[];
  spans: EvidenceSpan[];
  documentsScanned: number;
  spanCount: number;
  extractorVersion?: string;
  verifierVersion: string;
  modelName?: string;
  results: TodoCandidateResult[];
}): DailyTodoExtractionResult {
  const candidates = input.results.filter((result) => result.status !== "rejected");
  const rejected = input.results.filter((result) => result.status === "rejected");
  const result: DailyTodoExtractionResult = {
    sessionId: input.sessionId,
    extractionRunId: input.extractionRunId,
    dryRun: input.dryRun,
    extractionName: "daily.todo",
    extractorVersion: input.extractorVersion ?? DAILY_TODO_EXTRACTION.extractorVersion,
    verifierVersion: input.verifierVersion,
    day: input.day,
    sourcesScanned: input.documentsScanned,
    spanCount: input.spanCount,
    candidateCount: candidates.length,
    rejectedCount: rejected.length,
    countsBySource: countsBySource(input.documents, input.spans, input.results),
    results: input.results,
    candidates,
    rejected,
  };
  if (input.modelName !== undefined) {
    result.modelName = input.modelName;
  }
  return result;
}

function countsBySource(
  documents: { sourceType: "slack" | "granola" | "notion" | "wiki"; path: string }[],
  spans: EvidenceSpan[],
  results: TodoCandidateResult[],
): ExtractionSourceCounts {
  const counts: ExtractionSourceCounts = {
    slack: emptySourceCount(),
    granola: emptySourceCount(),
    notion: emptySourceCount(),
    wiki: emptySourceCount(),
  };
  for (const document of documents) {
    counts[document.sourceType].documents += 1;
  }
  for (const span of spans) {
    counts[span.sourceType].spans += 1;
  }
  for (const result of results) {
    const sourceType = result.evidence.sourceType;
    const sourceCount = counts[sourceType];
    if (result.status === "rejected") {
      sourceCount.rejected += 1;
    } else {
      sourceCount.candidates += 1;
    }
  }
  return counts;
}

function emptySourceCount() {
  return { documents: 0, spans: 0, candidates: 0, rejected: 0 };
}

function normalizeCandidateText(value: string): string {
  return value
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedLower(value: string): string {
  return normalizeSlackMarkup(value).toLowerCase();
}

function normalizeSlackMarkup(value: string): string {
  return value
    .replace(/<@([A-Z0-9]+)>/g, "<@$1>")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2 $1")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function hashCandidate(span: EvidenceSpan, kind: TodoCandidateKind, text: string): string {
  return hash(`${DAILY_TODO_EXTRACTION.name}:${kind}:${spanIdentityForCandidate(span)}:${text}`);
}

function spanIdentityForCandidate(span: EvidenceSpan): string {
  if (span.sourceType === "slack") {
    const channel = stringMetadata(span, "channel");
    const messageTs = stringMetadata(span, "messageTs");
    if (channel !== "" && messageTs !== "") {
      const threadTs = stringMetadata(span, "threadTs");
      return `slack:${channel}:${threadTs}:${messageTs}`;
    }
  }
  const canonicalSourcePath = stringMetadata(span, "canonicalSourcePath");
  if (canonicalSourcePath !== "") {
    return `source:${canonicalSourcePath}:${stringMetadata(span, "section")}`;
  }
  return `${span.sourcePath}:${span.lineStart}:${span.lineEnd}`;
}

function stringMetadata(span: EvidenceSpan, key: string): string {
  const value = span.metadata[key];
  return typeof value === "string" ? value.trim() : "";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function assertIsoDay(day: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Backfill ${label} date must be YYYY-MM-DD: ${day}`);
  }
}

function daysInRange(from: string, to: string): string[] {
  const days: string[] = [];
  const current = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (current.getTime() <= end.getTime()) {
    days.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return days;
}
