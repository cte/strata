import { ClassificationCorrectionStore, SessionStore } from "@strata/core";
import type { JsonValue } from "@strata/core/types";
import { correctionToTaxonomyOperation } from "@strata/ingest/classification-correction";
import {
  applyIngestTaxonomyOperation,
  type IngestTaxonomyOperation,
} from "@strata/ingest/ingest-taxonomy";
import { reviewQueueFromActivity } from "@strata/ingest/review-queue";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type {
  TaxonomyReviewCorrectResult,
  TaxonomyReviewCorrectRpcInput,
  TaxonomyReviewListResult,
  TaxonomyReviewListRpcInput,
} from "./trpc.js";

export async function listTaxonomyReviewForWeb(
  input: TaxonomyReviewListRpcInput,
  options: WebApiOptions = {},
): Promise<TaxonomyReviewListResult> {
  const root = repoRoot(options);
  const items = await reviewQueueFromActivity({
    repoRoot: root,
    limit: input.limit,
    ...(input.source === "all" ? {} : { source: input.source }),
  });
  return { items };
}

export async function correctTaxonomyReviewForWeb(
  input: TaxonomyReviewCorrectRpcInput,
  options: WebApiOptions = {},
): Promise<TaxonomyReviewCorrectResult> {
  const root = repoRoot(options);
  const store = await SessionStore.open(root);
  try {
    const corrections = new ClassificationCorrectionStore(store.db);
    const created = corrections.create({
      source: input.source,
      targetSessionId: input.targetSessionId,
      targetEventId: input.targetEventId,
      rawPath: input.rawPath,
      observed: observedPayload(input),
      verdict: input.verdict,
      correction: correctionPayload(input),
      dedupeKey: input.dedupeKey,
    });

    const operation = correctionToTaxonomyOperation({
      source: input.source,
      verdict: input.verdict,
      ...(input.projectLabel === undefined ? {} : { projectLabel: input.projectLabel }),
      ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
      ...(input.selfName === undefined ? {} : { selfName: input.selfName }),
      ...(input.ignorePattern === undefined ? {} : { ignorePattern: input.ignorePattern }),
    });
    if (operation === null) {
      // Feedback-only verdict (e.g. confirm) — recorded, nothing to apply.
      return { correction: created, applied: false, appliedSummary: null, changed: false };
    }

    // A reviewer correction is itself a verdict, so it edits the taxonomy
    // directly — no second approval. Only LLM-generated suggestions go through
    // the proposal gate. The correction row stays as durable feedback/eval data.
    const result = await applyIngestTaxonomyOperation(root, operation);
    return {
      correction: created,
      applied: true,
      appliedSummary: describeTaxonomyOperation(operation),
      changed: result.changed,
    };
  } finally {
    store.close();
  }
}

function describeTaxonomyOperation(operation: IngestTaxonomyOperation): string {
  switch (operation.kind) {
    case "ingest.taxonomy.addProjectAlias":
      return `Added project "${operation.label}" with alias${operation.aliases.length === 1 ? "" : "es"} ${operation.aliases.map((alias) => `"${alias}"`).join(", ")}.`;
    case "ingest.taxonomy.addSelfName":
      return `Added "${operation.name}" as one of your names.`;
    case "ingest.taxonomy.addSlackPattern":
      return `Added a Slack ${operation.field} rule for "${operation.rule.value}".`;
  }
}

function observedPayload(input: TaxonomyReviewCorrectRpcInput): JsonValue {
  return {
    projectPaths: input.projectPaths,
    reviewReason: input.reviewReason ?? null,
    title: input.title ?? null,
  };
}

function correctionPayload(input: TaxonomyReviewCorrectRpcInput): JsonValue | null {
  const payload: Record<string, JsonValue> = {};
  if (input.projectLabel !== undefined) {
    payload.projectLabel = input.projectLabel;
  }
  if (input.aliases !== undefined) {
    payload.aliases = input.aliases;
  }
  if (input.selfName !== undefined) {
    payload.selfName = input.selfName;
  }
  if (input.ignorePattern !== undefined) {
    payload.ignorePattern = input.ignorePattern;
  }
  return Object.keys(payload).length === 0 ? null : payload;
}
