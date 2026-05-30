import type { JsonObject, JsonValue } from "@strata/core";
import type {
  IngestPatternRule,
  IngestSlackPatternField,
  IngestTaxonomyOperation,
  StageIngestTaxonomyProposalInput,
} from "./ingestTaxonomy.js";

/**
 * The taxonomy-suggestion Routine's contract (docs/taxonomy-suggestion-plan.md,
 * Slice 2). The output schema is intentionally loose — the runtime validator
 * has no `oneOf`, and client-side schemas are UX only. `parseSuggestionOperation`
 * is the authoritative, deterministic gate that decides whether a model-proposed
 * operation is well-formed enough to stage as a `schema` Proposal.
 */
export interface TaxonomySuggestion {
  operation: IngestTaxonomyOperation;
  rationale: string;
  confidence: number;
  sourceRefs: string[];
  dedupeKey?: string;
}

export interface TaxonomySuggestionsArtifact {
  suggestions: TaxonomySuggestion[];
  notes?: string;
}

const SLACK_PATTERN_FIELDS: ReadonlySet<string> = new Set<IngestSlackPatternField>([
  "materialPatterns",
  "ignoredLogPatterns",
  "transientCheckPatterns",
  "routineCoordinationPatterns",
  "statusOnlyPatterns",
]);

/** JSON Schema handed to the model via the routine `outputSchema`. */
export const TAXONOMY_SUGGESTIONS_OUTPUT_SCHEMA: JsonObject = {
  type: "object",
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        required: ["operation", "rationale", "confidence", "sourceRefs"],
        properties: {
          operation: {
            type: "object",
            required: ["kind"],
            properties: {
              kind: {
                type: "string",
                enum: [
                  "ingest.taxonomy.addProjectAlias",
                  "ingest.taxonomy.addSelfName",
                  "ingest.taxonomy.addSlackPattern",
                ],
              },
              label: { type: "string" },
              aliases: { type: "array", items: { type: "string" } },
              name: { type: "string" },
              field: {
                type: "string",
                enum: [
                  "materialPatterns",
                  "ignoredLogPatterns",
                  "transientCheckPatterns",
                  "routineCoordinationPatterns",
                  "statusOnlyPatterns",
                ],
              },
              rule: {
                type: "object",
                required: ["value"],
                properties: {
                  value: { type: "string" },
                  match: { type: "string", enum: ["literal", "regex"] },
                  flags: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
          },
          rationale: { type: "string" },
          confidence: { type: "number" },
          sourceRefs: { type: "array", items: { type: "string" } },
          dedupeKey: { type: "string" },
        },
      },
    },
    notes: { type: "string" },
  },
};

export interface RejectedSuggestion {
  reason: string;
  raw: JsonValue;
}

export interface SuggestionProposalMapping {
  inputs: StageIngestTaxonomyProposalInput[];
  rejected: RejectedSuggestion[];
}

export interface SuggestionMappingOptions {
  /** Drop suggestions below this confidence (default 0 — keep all well-formed). */
  minConfidence?: number;
}

/**
 * Convert a submitted suggestions artifact into proposal-staging inputs, keeping
 * only well-formed operations at or above the confidence floor. Malformed or
 * low-confidence suggestions are returned in `rejected` so callers can surface —
 * never silently drop — what was skipped.
 */
export function suggestionsToProposalInputs(
  payload: JsonValue,
  options: SuggestionMappingOptions = {},
): SuggestionProposalMapping {
  const minConfidence = options.minConfidence ?? 0;
  const inputs: StageIngestTaxonomyProposalInput[] = [];
  const rejected: RejectedSuggestion[] = [];

  const suggestions = isObject(payload) ? payload.suggestions : undefined;
  if (!Array.isArray(suggestions)) {
    return { inputs, rejected };
  }

  for (const raw of suggestions) {
    if (!isObject(raw)) {
      rejected.push({ reason: "not_an_object", raw });
      continue;
    }
    const operation = parseSuggestionOperation(raw.operation);
    if (operation === null) {
      rejected.push({ reason: "invalid_operation", raw });
      continue;
    }
    const confidence = typeof raw.confidence === "number" ? raw.confidence : 0;
    if (confidence < minConfidence) {
      rejected.push({ reason: "low_confidence", raw });
      continue;
    }
    const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    const sourceRefs = stringArray(raw.sourceRefs);
    inputs.push({
      operation,
      reason: rationale === "" ? `Taxonomy suggestion (confidence ${confidence}).` : rationale,
      evidence: sourceRefs,
    });
  }

  return { inputs, rejected };
}

/**
 * Strict, deterministic validation of one model-proposed operation. Returns a
 * typed {@link IngestTaxonomyOperation} or `null`. This is the safety gate: only
 * operations that pass become reviewable proposals.
 */
export function parseSuggestionOperation(
  value: JsonValue | undefined,
): IngestTaxonomyOperation | null {
  if (!isObject(value)) {
    return null;
  }
  switch (value.kind) {
    case "ingest.taxonomy.addProjectAlias": {
      const label = nonEmptyString(value.label);
      const aliases = stringArray(value.aliases).filter((alias) => alias.trim() !== "");
      if (label === null || aliases.length === 0) {
        return null;
      }
      return { kind: "ingest.taxonomy.addProjectAlias", label, aliases };
    }
    case "ingest.taxonomy.addSelfName": {
      const name = nonEmptyString(value.name);
      return name === null ? null : { kind: "ingest.taxonomy.addSelfName", name };
    }
    case "ingest.taxonomy.addSlackPattern": {
      const field = typeof value.field === "string" ? value.field : null;
      if (field === null || !SLACK_PATTERN_FIELDS.has(field)) {
        return null;
      }
      const rule = parsePatternRule(value.rule);
      if (rule === null) {
        return null;
      }
      return {
        kind: "ingest.taxonomy.addSlackPattern",
        field: field as IngestSlackPatternField,
        rule,
      };
    }
    default:
      return null;
  }
}

function parsePatternRule(value: JsonValue | undefined): IngestPatternRule | null {
  if (!isObject(value)) {
    return null;
  }
  const ruleValue = nonEmptyString(value.value);
  if (ruleValue === null) {
    return null;
  }
  const rule: IngestPatternRule = { value: ruleValue };
  if (value.match === "literal" || value.match === "regex") {
    rule.match = value.match;
  }
  if (typeof value.flags === "string" && value.flags !== "") {
    rule.flags = value.flags;
  }
  if (typeof value.reason === "string" && value.reason.trim() !== "") {
    rule.reason = value.reason.trim();
  }
  return rule;
}

function nonEmptyString(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
