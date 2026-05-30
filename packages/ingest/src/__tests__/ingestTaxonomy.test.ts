import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addIngestTaxonomyProjectAlias,
  applyIngestTaxonomyProposal,
  loadIngestTaxonomy,
  readIngestTaxonomy,
  stageIngestTaxonomyProposal,
} from "../ingestTaxonomy.js";

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-ingest-taxonomy-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await mkdir(path.join(repoRoot, ".strata/ingest"), { recursive: true });
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("ingest taxonomy", () => {
  test("writes canonical taxonomy.json and resolves project aliases", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = await addIngestTaxonomyProjectAlias(repoRoot, {
        label: "Atlas Portal",
        aliases: ["atlas", "atlas"],
      });

      expect(result.changed).toBe(true);
      expect(path.relative(repoRoot, result.path)).toBe(".strata/ingest/taxonomy.json");
      const taxonomy = await readIngestTaxonomy(repoRoot);
      expect(taxonomy.taxonomy.projects).toEqual([{ label: "Atlas Portal", aliases: ["atlas"] }]);

      const resolved = await loadIngestTaxonomy(repoRoot);
      expect(resolved.projects[0]?.label).toBe("Atlas Portal");
      expect(resolved.projects[0]?.aliases[1]?.pattern.test("ship atlas next week")).toBe(true);
    });
  });

  test("stages and applies taxonomy proposals", async () => {
    await withTempRepo(async (repoRoot) => {
      const proposal = await stageIngestTaxonomyProposal(repoRoot, {
        operation: {
          kind: "ingest.taxonomy.addSelfName",
          name: "Sam Rivera",
        },
        reason: "Reviewed action ownership false negative.",
      });

      expect(proposal.kind).toBe("schema");
      const applied = await applyIngestTaxonomyProposal(repoRoot, {
        selector: proposal.id,
        actor: "test",
      });
      expect(applied.changed).toBe(true);
      expect(applied.proposal.status).toBe("applied");

      const taxonomy = JSON.parse(
        await readFile(path.join(repoRoot, ".strata/ingest/taxonomy.json"), "utf8"),
      ) as { selfNames?: string[] };
      expect(taxonomy.selfNames).toEqual(["Sam Rivera"]);
    });
  });
});
