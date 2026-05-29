import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { archiveGeneratedSlackThreads, compactWikiIndex } from "./wikiIndex.js";

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-compact-index-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await mkdir(path.join(repoRoot, "wiki", "threads"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki", "raw", "slack"), { recursive: true });
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("compact wiki index", () => {
  test("keeps generated Slack source threads out of the root thread index", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing.md"),
        "# Pricing\n\nProject context.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "threads", "curated.md"),
        "# Curated Thread\n\nReal open thread.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "threads", "generated.md"),
        [
          "---",
          "type: thread",
          "source: raw/slack/source.md",
          "---",
          "",
          "# Generated",
          "",
          "Automatically opened from source indexing.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "raw", "slack", "source.md"),
        [
          "---",
          "type: raw_slack_thread",
          "source: slack",
          "date: 2026-05-08",
          "channel: C123",
          "---",
          "",
          "# Source",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await compactWikiIndex({ repoRoot, now: new Date("2026-05-10T00:00:00Z") });
      expect(result.counts.threads).toBe(1);
      expect(result.counts.slackRawThreads).toBe(1);

      const index = await readFile(path.join(repoRoot, "wiki", "index.md"), "utf8");
      expect(index).toContain("[[threads/curated|Curated Thread]]");
      expect(index).not.toContain("[[threads/generated|Generated]]");

      const slackIndex = await readFile(
        path.join(repoRoot, "wiki", "sources", "slack", "index.md"),
        "utf8",
      );
      expect(slackIndex).toContain("`C123`: 1 raw threads, last 2026-05-08");
    });
  });

  test("keeps superseded project redirects out of the root project index", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing.md"),
        "---\ntype: project\ntitle: Pricing\n---\n# Pricing\n\nCanonical page.\n",
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
          "Consolidated into [[projects/pricing|Pricing]].",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await compactWikiIndex({ repoRoot, now: new Date("2026-05-27T00:00:00Z") });
      expect(result.counts.projects).toBe(1);

      const index = await readFile(path.join(repoRoot, "wiki", "index.md"), "utf8");
      expect(index).toContain("[[projects/pricing|Pricing]]");
      expect(index).not.toContain("[[projects/pricing-strategy|Pricing Strategy]]");
    });
  });

  test("archives generated Slack thread pages and rewrites wiki links to raw evidence", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki", "raw", "slack", "source.md"),
        "# Raw Slack\n\nOriginal transcript.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "threads", "generated.md"),
        [
          "---",
          "type: thread",
          "source: raw/slack/source.md",
          "---",
          "",
          "# Generated Thread",
          "",
          "Automatically opened from source indexing.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "threads", "curated.md"),
        "# Curated Thread\n\nReal open thread.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing.md"),
        "- [[threads/generated|[not urgent] Generated Thread]]\n- [[threads/curated|Curated Thread]]\n",
        "utf8",
      );

      const result = await archiveGeneratedSlackThreads({
        repoRoot,
        now: new Date("2026-05-25T10:00:00.000Z"),
      });

      expect(result.archived).toBe(1);
      expect(result.kept).toBe(1);
      expect(result.rewrittenFiles).toBe(1);
      expect(result.rewrittenLinks).toBe(1);
      await expect(
        access(path.join(repoRoot, "wiki", "threads", "generated.md")),
      ).rejects.toThrow();
      await access(path.join(repoRoot, ".strata/archive/generated-slack-threads/20260525T100000Z"));

      const project = await readFile(path.join(repoRoot, "wiki", "projects", "pricing.md"), "utf8");
      expect(project).toContain("[[raw/slack/source|[not urgent] Generated Thread]]");
      expect(project).toContain("[[threads/curated|Curated Thread]]");

      const manifest = await readFile(
        path.join(
          repoRoot,
          ".strata/archive/generated-slack-threads/20260525T100000Z/manifest.json",
        ),
        "utf8",
      );
      expect(manifest).toContain('"path": "wiki/threads/generated.md"');
    });
  });
});
