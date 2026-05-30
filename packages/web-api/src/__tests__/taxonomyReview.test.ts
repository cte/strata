import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadIngestTaxonomy } from "@strata/ingest/ingest-taxonomy";
import { correctTaxonomyReviewForWeb } from "../taxonomyReviewServices.js";

function baseInput(over: Record<string, unknown>) {
  return {
    dedupeKey: "wiki/raw/granola/x.md",
    source: "granola" as const,
    targetSessionId: "sess_test",
    targetEventId: 1,
    rawPath: "wiki/raw/granola/x.md",
    title: "Roo Code sync",
    projectPaths: [],
    verdict: "unrecognized_project" as const,
    ...over,
  };
}

describe("correctTaxonomyReviewForWeb (immediate apply)", () => {
  test("a project correction edits the taxonomy directly — no proposal", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-review-apply-"));
    try {
      const result = await correctTaxonomyReviewForWeb(
        baseInput({ projectLabel: "Roo Code", aliases: ["roo", "roomote"] }),
        { repoRoot },
      );
      expect(result.applied).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.appliedSummary).toContain("Roo Code");

      const taxonomy = await loadIngestTaxonomy(repoRoot);
      const project = taxonomy.projects.find((entry) => entry.label === "Roo Code");
      expect(project).toBeDefined();
      // Resolved aliases include the label itself plus the surface aliases.
      expect(project?.aliases.map((alias) => alias.value)).toEqual(
        expect.arrayContaining(["roo", "roomote"]),
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("a confirm verdict records feedback but applies nothing", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-review-confirm-"));
    try {
      const result = await correctTaxonomyReviewForWeb(baseInput({ verdict: "confirm" }), {
        repoRoot,
      });
      expect(result.applied).toBe(false);
      expect(result.appliedSummary).toBeNull();

      const taxonomy = await loadIngestTaxonomy(repoRoot);
      expect(taxonomy.projects).toHaveLength(0);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
