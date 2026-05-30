import { ClassificationCorrectionStore, getStrataPaths, SessionStore } from "@strata/core";
import {
  type IngestActivityItemStatus,
  type IngestActivitySource,
  listRawToWikiIndexItems,
  type RawToWikiIndexRecord,
} from "./activity.js";
import type { ClassificationReason } from "./raw-to-wiki/types.js";

/**
 * The deterministic review-queue derivation for the taxonomy-suggestion loop
 * (docs/taxonomy-suggestion-plan.md, Slice 1). It surfaces raw-to-wiki
 * classification outcomes the taxonomy did *not* explain — items the reviewer
 * can confirm or correct — source-weighted (Granola/Notion above Slack) and
 * suppressed by items already corrected. No model in the loop.
 */
export interface ReviewQueueItem {
  /** Stable per raw source item; matches a Classification correction's dedupe key. */
  dedupeKey: string;
  source: IngestActivitySource;
  sessionId: string;
  eventId: number;
  rawPath: string;
  title: string | null;
  primaryPath: string | null;
  projectPaths: string[];
  reasons: ClassificationReason[];
  /** Why this outcome is worth reviewing. */
  reviewReason: "no_project" | "generic_project";
  score: number;
}

export interface ReviewQueueOptions {
  /** Max queue items returned. */
  limit?: number;
  source?: IngestActivitySource | "all";
}

const INDEXED_STATUSES: ReadonlySet<IngestActivityItemStatus> = new Set([
  "written",
  "indexed",
  "completed",
]);

/**
 * Pure selection over raw-to-wiki index records read from the event log. Keeps
 * every scoring/filtering rule testable without a database.
 */
export function selectReviewQueue(
  records: RawToWikiIndexRecord[],
  correctedKeys: ReadonlySet<string>,
  options: ReviewQueueOptions = {},
): ReviewQueueItem[] {
  const limit = clamp(options.limit ?? 50, 1, 200);
  const sourceFilter = options.source ?? "all";
  const byKey = new Map<string, ReviewQueueItem>();

  for (const record of records) {
    const queueItem = toReviewQueueItem(record, correctedKeys, sourceFilter);
    if (queueItem === null) {
      continue;
    }
    // Keep the most recent classification of the same raw item.
    const existing = byKey.get(queueItem.dedupeKey);
    if (existing === undefined || queueItem.eventId > existing.eventId) {
      byKey.set(queueItem.dedupeKey, queueItem);
    }
  }

  return [...byKey.values()]
    .sort((left, right) => right.score - left.score || right.eventId - left.eventId)
    .slice(0, limit);
}

function toReviewQueueItem(
  record: RawToWikiIndexRecord,
  correctedKeys: ReadonlySet<string>,
  sourceFilter: IngestActivitySource | "all",
): ReviewQueueItem | null {
  const { item, sessionId } = record;
  if (item.rawPath === null || !INDEXED_STATUSES.has(item.status)) {
    return null;
  }
  const dedupeKey = item.rawPath;
  if (correctedKeys.has(dedupeKey)) {
    return null;
  }
  // Taxonomy already explains the project attribution → not review-worthy.
  const explainedByTaxonomy = item.classificationReasons.some(
    (reason) => reason.kind === "project_alias" && reason.source === "taxonomy",
  );
  if (explainedByTaxonomy) {
    return null;
  }
  const source = item.source ?? "unknown";
  if (sourceFilter !== "all" && source !== sourceFilter) {
    return null;
  }
  const reviewReason = item.projectPaths.length === 0 ? "no_project" : "generic_project";
  return {
    dedupeKey,
    source,
    sessionId,
    eventId: item.eventId,
    rawPath: item.rawPath,
    title: item.title,
    primaryPath: item.primaryPath,
    projectPaths: item.projectPaths,
    reasons: item.classificationReasons,
    reviewReason,
    score: scoreItem(source, reviewReason),
  };
}

// Source-weighting: clean structured sources (Granola/Notion) rank above Slack
// for vocabulary discovery; a missing project ranks above a generic-guessed one.
function scoreItem(
  source: IngestActivitySource,
  reviewReason: ReviewQueueItem["reviewReason"],
): number {
  const sourceWeight = source === "granola" || source === "notion" ? 3 : 1;
  const reasonWeight = reviewReason === "no_project" ? 1 : 0;
  return sourceWeight + reasonWeight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export interface ReviewQueueStoreOptions extends ReviewQueueOptions {
  /** How many recent raw-to-wiki index events to scan for candidates. */
  scanLimit?: number;
}

export function reviewQueueFromStore(
  store: SessionStore,
  correctionStore: ClassificationCorrectionStore,
  options: ReviewQueueStoreOptions = {},
): ReviewQueueItem[] {
  const records = listRawToWikiIndexItems(store, { limit: options.scanLimit ?? 2000 });
  return selectReviewQueue(records, correctionStore.correctedDedupeKeys(), options);
}

export async function reviewQueueFromActivity(
  options: ReviewQueueStoreOptions & { repoRoot?: string } = {},
): Promise<ReviewQueueItem[]> {
  const store = await SessionStore.open(getStrataPaths(options.repoRoot).repoRoot);
  try {
    const correctionStore = new ClassificationCorrectionStore(store.db);
    return reviewQueueFromStore(store, correctionStore, options);
  } finally {
    store.close();
  }
}
