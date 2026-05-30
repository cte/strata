import { describe, expect, test } from "bun:test";
import { parseSuggestionOperation, suggestionsToProposalInputs } from "../taxonomySuggestions.js";

describe("parseSuggestionOperation", () => {
  test("accepts a well-formed addProjectAlias", () => {
    expect(
      parseSuggestionOperation({
        kind: "ingest.taxonomy.addProjectAlias",
        label: "Roo Code",
        aliases: ["roo", "roo-code"],
      }),
    ).toEqual({
      kind: "ingest.taxonomy.addProjectAlias",
      label: "Roo Code",
      aliases: ["roo", "roo-code"],
    });
  });

  test("rejects addProjectAlias without aliases", () => {
    expect(
      parseSuggestionOperation({
        kind: "ingest.taxonomy.addProjectAlias",
        label: "Roo Code",
        aliases: [],
      }),
    ).toBeNull();
  });

  test("accepts addSlackPattern with a valid field, rejects unknown field", () => {
    expect(
      parseSuggestionOperation({
        kind: "ingest.taxonomy.addSlackPattern",
        field: "ignoredLogPatterns",
        rule: { value: "deploy succeeded", match: "literal" },
      }),
    ).toMatchObject({ kind: "ingest.taxonomy.addSlackPattern", field: "ignoredLogPatterns" });
    expect(
      parseSuggestionOperation({
        kind: "ingest.taxonomy.addSlackPattern",
        field: "nope",
        rule: { value: "x" },
      }),
    ).toBeNull();
  });

  test("rejects unknown kind", () => {
    expect(parseSuggestionOperation({ kind: "ingest.taxonomy.delete" })).toBeNull();
    expect(parseSuggestionOperation(undefined)).toBeNull();
  });
});

describe("suggestionsToProposalInputs", () => {
  test("maps valid suggestions and rejects malformed / low-confidence ones", () => {
    const { inputs, rejected } = suggestionsToProposalInputs(
      {
        suggestions: [
          {
            operation: {
              kind: "ingest.taxonomy.addProjectAlias",
              label: "Polsia",
              aliases: ["polsia"],
            },
            rationale: "Recurring project mention in Granola syncs.",
            confidence: 0.9,
            sourceRefs: ["wiki/raw/granola/x.md"],
          },
          {
            operation: { kind: "ingest.taxonomy.addProjectAlias", label: "Bad", aliases: [] },
            rationale: "broken",
            confidence: 0.9,
            sourceRefs: [],
          },
          {
            operation: { kind: "ingest.taxonomy.addSelfName", name: "chris" },
            rationale: "self",
            confidence: 0.2,
            sourceRefs: [],
          },
        ],
      },
      { minConfidence: 0.5 },
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      operation: { kind: "ingest.taxonomy.addProjectAlias", label: "Polsia" },
      reason: "Recurring project mention in Granola syncs.",
      evidence: ["wiki/raw/granola/x.md"],
    });
    expect(rejected.map((r) => r.reason).sort()).toEqual(["invalid_operation", "low_confidence"]);
  });

  test("returns empty mapping for a payload without suggestions", () => {
    expect(suggestionsToProposalInputs({ notes: "none" })).toEqual({ inputs: [], rejected: [] });
  });
});
