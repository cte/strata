import { ClassificationCorrectionStore, getStrataPaths, SessionStore } from "@strata/core";
import type { IngestActivitySource } from "./activity.js";
import { loadIngestTaxonomy, type ResolvedIngestTaxonomy } from "./ingestTaxonomy.js";
import { type ReviewQueueItem, reviewQueueFromStore } from "./reviewQueue.js";

/**
 * The evidence bundle handed to the taxonomy-suggestion Routine
 * (docs/taxonomy-suggestion-plan.md, Slice 2). It is the *deterministic floor*
 * the user asked for: source-weighted, Slack-noise-bounded candidates the LLM
 * then reads, judges, and proposes vocabulary from. The LLM owns selection and
 * judgment; this builder only decides which outcomes are worth its attention
 * and caps Slack so the model is not flooded with low-signal chatter.
 */
export interface TaxonomyEvidenceCandidate {
  rawPath: string;
  primaryPath: string | null;
  source: IngestActivitySource;
  title: string | null;
  reviewReason: ReviewQueueItem["reviewReason"];
  /** Projects the generic classifier already guessed (empty for `no_project`). */
  projectPaths: string[];
  score: number;
}

export interface TaxonomyEvidenceBundle {
  /** A compact view of the current taxonomy so the model avoids re-proposing known vocabulary. */
  taxonomy: {
    projects: number;
    aliases: number;
    selfNames: number;
    slackPatterns: number;
    projectLabels: string[];
  };
  counts: {
    candidates: number;
    /** Granola/Notion candidates included (clean structured vocabulary). */
    structured: number;
    /** Slack candidates included after the noise cap. */
    slack: number;
    /** Slack candidates dropped by the cap — surfaced, never silently truncated. */
    droppedSlack: number;
  };
  candidates: TaxonomyEvidenceCandidate[];
}

export interface TaxonomyEvidenceOptions {
  /** Max Granola/Notion candidates. */
  structuredCap?: number;
  /** Max Slack candidates — the deterministic Slack-noise floor. */
  slackCap?: number;
}

const STRUCTURED_SOURCES: ReadonlySet<IngestActivitySource> = new Set<IngestActivitySource>([
  "granola",
  "notion",
]);

/**
 * Pure bundle assembly over an already score-sorted review queue. Structured
 * sources are kept generously; Slack is hard-capped (and the drop count
 * reported) because raw Slack is the noise that sank the prior TODO system.
 */
export function buildTaxonomyEvidence(
  queue: ReviewQueueItem[],
  taxonomy: ResolvedIngestTaxonomy,
  options: TaxonomyEvidenceOptions = {},
): TaxonomyEvidenceBundle {
  const structuredCap = Math.max(0, options.structuredCap ?? 40);
  const slackCap = Math.max(0, options.slackCap ?? 8);

  const structured: TaxonomyEvidenceCandidate[] = [];
  const slack: TaxonomyEvidenceCandidate[] = [];
  for (const item of queue) {
    const candidate = toCandidate(item);
    (STRUCTURED_SOURCES.has(item.source) ? structured : slack).push(candidate);
  }
  const structuredKept = structured.slice(0, structuredCap);
  const slackKept = slack.slice(0, slackCap);
  const candidates = [...structuredKept, ...slackKept].sort(
    (left, right) => right.score - left.score,
  );

  return {
    taxonomy: summarizeTaxonomy(taxonomy),
    counts: {
      candidates: candidates.length,
      structured: structuredKept.length,
      slack: slackKept.length,
      droppedSlack: slack.length - slackKept.length,
    },
    candidates,
  };
}

export interface TaxonomyEvidenceStoreOptions extends TaxonomyEvidenceOptions {
  repoRoot?: string;
  /** How many review-queue candidates to consider before capping. */
  scanLimit?: number;
}

export async function buildTaxonomyEvidenceFromStore(
  options: TaxonomyEvidenceStoreOptions = {},
): Promise<TaxonomyEvidenceBundle> {
  const root = getStrataPaths(options.repoRoot).repoRoot;
  const store = await SessionStore.open(root);
  try {
    const correctionStore = new ClassificationCorrectionStore(store.db);
    const queue = reviewQueueFromStore(store, correctionStore, {
      limit: options.scanLimit ?? 200,
    });
    const taxonomy = await loadIngestTaxonomy(root);
    return buildTaxonomyEvidence(queue, taxonomy, options);
  } finally {
    store.close();
  }
}

function toCandidate(item: ReviewQueueItem): TaxonomyEvidenceCandidate {
  return {
    rawPath: item.rawPath,
    primaryPath: item.primaryPath,
    source: item.source,
    title: item.title,
    reviewReason: item.reviewReason,
    projectPaths: item.projectPaths,
    score: item.score,
  };
}

function summarizeTaxonomy(taxonomy: ResolvedIngestTaxonomy): TaxonomyEvidenceBundle["taxonomy"] {
  const slackPatterns =
    taxonomy.slack.materialPatterns.length +
    taxonomy.slack.ignoredLogPatterns.length +
    taxonomy.slack.transientCheckPatterns.length +
    taxonomy.slack.routineCoordinationPatterns.length +
    taxonomy.slack.statusOnlyPatterns.length;
  return {
    projects: taxonomy.projects.length,
    // Each resolved project includes its label as the first alias; subtract it.
    aliases: taxonomy.projects.reduce(
      (total, project) => total + Math.max(0, project.aliases.length - 1),
      0,
    ),
    selfNames: taxonomy.selfNames.length,
    slackPatterns,
    projectLabels: taxonomy.projects.map((project) => project.label),
  };
}
