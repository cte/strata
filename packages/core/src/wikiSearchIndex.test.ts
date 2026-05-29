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

  test("skips superseded redirect pages", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing.md"),
        "---\ntype: project\ntitle: Pricing\n---\n# Pricing\n\npricing strategy canonical context.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing-strategy.md"),
        [
          "---",
          "type: project",
          "title: Pricing Strategy",
          "status: superseded",
          "superseded_by: projects/pricing.md",
          "---",
          "",
          "# Pricing Strategy",
          "",
          "pricing strategy redirect context.",
          "",
        ].join("\n"),
        "utf8",
      );

      const refresh = await refreshWikiSearchIndex({ repoRoot, includeRaw: false });
      expect(refresh.indexed).toBe(1);
      expect(refresh.curated).toBe(1);

      const matches = await searchWikiSearchIndex({
        repoRoot,
        query: "pricing strategy",
        limit: 5,
      });
      expect(matches?.map((match) => match.path)).toEqual(["projects/pricing.md"]);
    });
  });

  test("ranks canonical project pages before incidental curated matches", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki", "decisions"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing.md"),
        "---\ntype: project\ntitle: Pricing\n---\n# Pricing\n\npricing strategy and launch context.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "decisions", "2026-05-08-pricing-choice.md"),
        "---\ntype: decision\ntitle: Pricing choice\n---\n# Pricing choice\n\npricing decision context.\n",
        "utf8",
      );

      await refreshWikiSearchIndex({ repoRoot, includeRaw: false });
      const matches = await searchWikiSearchIndex({
        repoRoot,
        query: "pricing",
        limit: 2,
      });

      expect(matches?.map((match) => match.path)).toEqual([
        "projects/pricing.md",
        "decisions/2026-05-08-pricing-choice.md",
      ]);
    });
  });

  test("retrieves consolidated canonical pages before source and raw evidence", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki", "sources", "slack"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roo-code.md"),
        [
          "---",
          "type: project",
          "title: Roo Code",
          "---",
          "",
          "# Roo Code",
          "",
          "## Status",
          "",
          "- Canonical project context.",
          "",
          "## Consolidated Sources",
          "",
          "### RooCodeInc Sync",
          "",
          "Source page: [[projects/roocodeinc-sync|RooCodeInc Sync]]",
          "",
          "- Status:",
          "  - Slack sync said deploy markers should stay visible in release summaries.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roocodeinc-sync.md"),
        [
          "---",
          "type: project",
          "title: RooCodeInc Sync",
          "status: superseded",
          "superseded_by: wiki/projects/roo-code.md",
          "---",
          "",
          "# RooCodeInc Sync",
          "",
          "Slack sync said deploy markers should stay visible in release summaries.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "sources", "slack", "roo-code-sync.md"),
        [
          "---",
          "type: source",
          "source: raw/slack/roo-code-sync.md",
          "---",
          "",
          "# Roo Code Sync Source",
          "",
          "deploy markers visible source evidence.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "raw", "slack", "roo-code-sync.md"),
        "# Raw Slack\n\ndeploy markers visible raw transcript evidence.\n",
        "utf8",
      );

      const refresh = await refreshWikiSearchIndex({ repoRoot });
      expect(refresh).toMatchObject({ indexed: 3, curated: 1, sources: 1, raw: 1 });

      const curatedAndSource = await searchWikiSearchIndex({
        repoRoot,
        query: "deploy markers visible",
        limit: 5,
      });
      expect(curatedAndSource?.map((match) => `${match.kind}:${match.path}`)).toEqual([
        "curated:projects/roo-code.md",
        "source:sources/slack/roo-code-sync.md",
      ]);
      expect(curatedAndSource?.[0]?.preview).toContain("deploy markers should stay visible");

      const withRaw = await searchWikiSearchIndex({
        repoRoot,
        query: "deploy markers visible",
        includeRaw: true,
        limit: 5,
      });
      expect(withRaw?.map((match) => `${match.kind}:${match.path}`)).toEqual([
        "curated:projects/roo-code.md",
        "source:sources/slack/roo-code-sync.md",
        "raw:raw/slack/roo-code-sync.md",
      ]);
    });
  });
});
