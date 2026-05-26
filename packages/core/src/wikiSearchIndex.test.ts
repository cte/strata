import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshWikiSearchIndex, searchWikiSearchIndex } from "./wikiSearchIndex.js";

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-wiki-search-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki", "threads"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki", "raw", "slack"), { recursive: true });
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("wiki search index", () => {
  test("indexes curated and raw pages with curated-first retrieval", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "self-serve-pricing.md"),
        "# Self Serve Pricing\n\nself serve pricing curated context.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "raw", "slack", "source.md"),
        "# Raw Slack\n\nself serve pricing raw transcript context.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "threads", "generated-source-thread.md"),
        [
          "---",
          "type: thread",
          "source: raw/slack/source.md",
          "---",
          "",
          "# Generated Source Thread",
          "",
          "self serve pricing generated source context.",
          "",
          "Automatically opened from source indexing.",
          "",
        ].join("\n"),
        "utf8",
      );

      const refresh = await refreshWikiSearchIndex({ repoRoot });
      expect(refresh.indexed).toBe(3);
      expect(refresh.curated).toBe(1);
      expect(refresh.raw).toBe(1);
      expect(refresh.sources).toBe(1);

      const curatedOnly = await searchWikiSearchIndex({
        repoRoot,
        query: "self serve pricing",
        limit: 1,
      });
      expect(curatedOnly?.map((match) => match.path)).toEqual(["projects/self-serve-pricing.md"]);

      const withRaw = await searchWikiSearchIndex({
        repoRoot,
        query: "self serve pricing",
        includeRaw: true,
        limit: 3,
      });
      expect(withRaw?.map((match) => match.path)).toEqual([
        "projects/self-serve-pricing.md",
        "threads/generated-source-thread.md",
        "raw/slack/source.md",
      ]);
    });
  });
});
