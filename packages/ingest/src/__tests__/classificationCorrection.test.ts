import { describe, expect, test } from "bun:test";
import {
  type ClassificationCorrectionInput,
  correctionToTaxonomyOperation,
} from "../classificationCorrection.js";

describe("correctionToTaxonomyOperation", () => {
  test("unrecognized_project / wrong_project → addProjectAlias", () => {
    const op = correctionToTaxonomyOperation({
      source: "granola",
      verdict: "unrecognized_project",
      projectLabel: "Atlas Portal",
      aliases: ["atlas", "ship"],
    });
    expect(op).toEqual({
      kind: "ingest.taxonomy.addProjectAlias",
      label: "Atlas Portal",
      aliases: ["atlas", "ship"],
    });

    const wrong = correctionToTaxonomyOperation({
      source: "slack",
      verdict: "wrong_project",
      projectLabel: "Atlas Portal",
      aliases: ["atlas"],
    });
    expect(wrong).toMatchObject({ kind: "ingest.taxonomy.addProjectAlias", label: "Atlas Portal" });
  });

  test("project verdict without label or aliases yields null (records feedback only)", () => {
    expect(
      correctionToTaxonomyOperation({ source: "granola", verdict: "unrecognized_project" }),
    ).toBeNull();
    expect(
      correctionToTaxonomyOperation({
        source: "granola",
        verdict: "wrong_project",
        projectLabel: "Atlas Portal",
        aliases: [],
      }),
    ).toBeNull();
  });

  test("dedupes and trims aliases", () => {
    const op = correctionToTaxonomyOperation({
      source: "notion",
      verdict: "unrecognized_project",
      projectLabel: "Atlas Portal",
      aliases: [" atlas ", "Atlas", "ship", ""],
    });
    expect(op).toEqual({
      kind: "ingest.taxonomy.addProjectAlias",
      label: "Atlas Portal",
      aliases: ["atlas", "ship"],
    });
  });

  test("is_me → addSelfName; missing name → null", () => {
    expect(
      correctionToTaxonomyOperation({ source: "slack", verdict: "is_me", selfName: "Sam Rivera" }),
    ).toEqual({ kind: "ingest.taxonomy.addSelfName", name: "Sam Rivera" });
    expect(correctionToTaxonomyOperation({ source: "slack", verdict: "is_me" })).toBeNull();
  });

  test("noise on slack → ignoredLog slack pattern; noise off slack → null", () => {
    expect(
      correctionToTaxonomyOperation({
        source: "slack",
        verdict: "noise",
        ignorePattern: "deploy succeeded",
      }),
    ).toEqual({
      kind: "ingest.taxonomy.addSlackPattern",
      field: "ignoredLogPatterns",
      rule: { value: "deploy succeeded", match: "literal" },
    });
    expect(
      correctionToTaxonomyOperation({
        source: "granola",
        verdict: "noise",
        ignorePattern: "deploy succeeded",
      }),
    ).toBeNull();
    expect(correctionToTaxonomyOperation({ source: "slack", verdict: "noise" })).toBeNull();
  });

  test("confirm and not_me are feedback-only (null op)", () => {
    const confirm: ClassificationCorrectionInput = { source: "granola", verdict: "confirm" };
    expect(correctionToTaxonomyOperation(confirm)).toBeNull();
    expect(correctionToTaxonomyOperation({ source: "slack", verdict: "not_me" })).toBeNull();
  });
});
