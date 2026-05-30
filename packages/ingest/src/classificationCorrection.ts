import type { IngestSlackPatternField, IngestTaxonomyOperation } from "./ingestTaxonomy.js";

/**
 * A typed reviewer verdict on one raw-to-wiki classification outcome — the
 * feedback unit of the taxonomy-suggestion loop (see
 * docs/taxonomy-suggestion-plan.md and CONTEXT.md "Classification correction").
 *
 * This module is the deterministic spine: it maps a verdict to the taxonomy
 * operation that would fix it, with no model in the loop. Storage and the
 * review queue are built on top of this.
 */
export type ClassificationVerdict =
  | "confirm"
  | "wrong_project"
  | "unrecognized_project"
  | "noise"
  | "is_me"
  | "not_me";

export interface ClassificationCorrectionInput {
  /** Source the corrected item came from (e.g. "slack" | "granola" | "notion"). */
  source: string;
  verdict: ClassificationVerdict;
  /** Canonical project name for wrong_project / unrecognized_project verdicts. */
  projectLabel?: string;
  /** Aliases that should map to `projectLabel` (the mentions that failed to match). */
  aliases?: string[];
  /** Name to add for an is_me verdict. */
  selfName?: string;
  /** Literal phrase to start ignoring for a noise verdict (Slack only for now). */
  ignorePattern?: string;
}

/**
 * The deterministic taxonomy fix a correction implies, or `null` when the
 * verdict records feedback but yields no add-style taxonomy operation (e.g.
 * `confirm`, `not_me`, or a verdict missing the data it needs). `null` does not
 * mean "no-op" for the loop — the correction is still durable feedback; it just
 * stages no schema Proposal.
 */
export function correctionToTaxonomyOperation(
  input: ClassificationCorrectionInput,
): IngestTaxonomyOperation | null {
  switch (input.verdict) {
    case "wrong_project":
    case "unrecognized_project": {
      const label = input.projectLabel?.trim();
      const aliases = uniqueNonEmpty(input.aliases ?? []);
      if (label === undefined || label === "" || aliases.length === 0) {
        return null;
      }
      return { kind: "ingest.taxonomy.addProjectAlias", label, aliases };
    }
    case "is_me": {
      const name = input.selfName?.trim();
      if (name === undefined || name === "") {
        return null;
      }
      return { kind: "ingest.taxonomy.addSelfName", name };
    }
    case "noise": {
      // Only Slack noise maps to a taxonomy op today: an ignored-log pattern.
      // Non-Slack noise is recorded as feedback but has no add-style fix yet.
      const value = input.ignorePattern?.trim();
      if (!isSlackSource(input.source) || value === undefined || value === "") {
        return null;
      }
      const field: IngestSlackPatternField = "ignoredLogPatterns";
      return {
        kind: "ingest.taxonomy.addSlackPattern",
        field,
        rule: { value, match: "literal" },
      };
    }
    default:
      // confirm | not_me — durable feedback, no add-style taxonomy operation.
      return null;
  }
}

function isSlackSource(source: string): boolean {
  return source.trim().toLowerCase() === "slack";
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized === "" || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    result.push(normalized);
  }
  return result;
}
