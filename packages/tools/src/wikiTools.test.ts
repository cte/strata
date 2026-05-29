import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { refreshWikiSearchIndex } from "@strata/core";
import { createDefaultToolRegistry } from "./index.js";
import type { ToolFileChange } from "./types.js";

describe("wiki tools", () => {
  test("lists, reads, and searches markdown pages", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tools-"));
    try {
      const wikiRoot = path.join(repoRoot, "wiki");
      await mkdir(path.join(wikiRoot, "projects"), { recursive: true });
      await mkdir(path.join(wikiRoot, "raw", "granola"), { recursive: true });
      await writeFile(path.join(wikiRoot, "index.md"), "# Index\n\nStrata root\n", "utf8");
      await writeFile(
        path.join(wikiRoot, "projects", "alpha.md"),
        "# Alpha\n\nNeedle appears here.\n",
        "utf8",
      );
      await writeFile(
        path.join(wikiRoot, "raw", "granola", "source.md"),
        "# Source\n\nNeedle raw source.\n",
        "utf8",
      );

      const registry = createDefaultToolRegistry();
      const context = { repoRoot };

      await expect(registry.execute("wiki.listPages", {}, context)).resolves.toEqual({
        pages: ["index.md", "projects/alpha.md"],
        count: 2,
      });

      // Regression: model often passes `root: ""` for "list everything".
      // Should resolve to the wiki root rather than throwing empty_path.
      await expect(
        registry.execute("wiki.listPages", { root: "", limit: 100 }, context),
      ).resolves.toEqual({
        pages: ["index.md", "projects/alpha.md"],
        count: 2,
      });

      await expect(
        registry.execute("wiki.readPage", { path: "projects/alpha.md" }, context),
      ).resolves.toMatchObject({
        path: "projects/alpha.md",
        content: "# Alpha\n\nNeedle appears here.\n",
        truncated: false,
      });

      await expect(
        registry.execute("wiki.readPage", { path: "wiki/projects/alpha.md" }, context),
      ).resolves.toMatchObject({
        path: "projects/alpha.md",
        truncated: false,
      });

      await expect(
        registry.execute("wiki.search", { query: "needle" }, context),
      ).resolves.toMatchObject({
        query: "needle",
        count: 1,
        matches: [{ path: "projects/alpha.md", line: 3 }],
      });

      await expect(
        registry.execute("wiki.search", { query: "needle", includeRaw: true }, context),
      ).resolves.toMatchObject({
        count: 2,
      });

      for (const requestedPath of ["../package.json", "..", "/tmp/outside.md"]) {
        const outside = await registry.safeExecute(
          "wiki.readPage",
          { path: requestedPath },
          context,
        );
        expect(outside.ok).toBe(false);
        if (!outside.ok) {
          expect(outside.error.code).toBe("outside_wiki");
        }
      }

      const blocked = await registry.safeExecute(
        "wiki.readPage",
        { path: ".strata/secret.md" },
        context,
      );
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error.code).toBe("blocked_path_segment");
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("search prefers curated wiki pages over raw sources when raw search is enabled", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tools-"));
    try {
      const wikiRoot = path.join(repoRoot, "wiki");
      await mkdir(path.join(wikiRoot, "threads"), { recursive: true });
      await mkdir(path.join(wikiRoot, "raw", "slack"), { recursive: true });
      await writeFile(
        path.join(wikiRoot, "raw", "slack", "source.md"),
        "# Raw\n\nself serve pricing raw transcript mention.\n",
        "utf8",
      );
      await writeFile(
        path.join(wikiRoot, "threads", "self-serve-pricing.md"),
        "# Self Serve Pricing\n\nself serve pricing curated decision context.\n",
        "utf8",
      );

      const registry = createDefaultToolRegistry();
      const context = { repoRoot };

      await expect(
        registry.execute(
          "wiki.search",
          { query: "self serve pricing", includeRaw: true, limit: 1 },
          context,
        ),
      ).resolves.toMatchObject({
        count: 1,
        matches: [{ path: "threads/self-serve-pricing.md" }],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("search returns consolidated curated context before source and raw evidence", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tools-"));
    try {
      const wikiRoot = path.join(repoRoot, "wiki");
      await mkdir(path.join(wikiRoot, "projects"), { recursive: true });
      await mkdir(path.join(wikiRoot, "sources", "slack"), { recursive: true });
      await mkdir(path.join(wikiRoot, "raw", "slack"), { recursive: true });
      await writeFile(
        path.join(wikiRoot, "projects", "roo-code.md"),
        [
          "---",
          "type: project",
          "title: Roo Code",
          "---",
          "",
          "# Roo Code",
          "",
          "## Consolidated Sources",
          "",
          "### RooCodeInc Sync",
          "",
          "- Status:",
          "  - Slack sync said deploy markers should stay visible in release summaries.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(wikiRoot, "projects", "roocodeinc-sync.md"),
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
          "deploy markers visible superseded redirect.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(wikiRoot, "sources", "slack", "roo-code-sync.md"),
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
        path.join(wikiRoot, "raw", "slack", "roo-code-sync.md"),
        "# Raw Slack\n\ndeploy markers visible raw transcript evidence.\n",
        "utf8",
      );
      await refreshWikiSearchIndex({ repoRoot });

      const registry = createDefaultToolRegistry();
      const context = { repoRoot };

      await expect(
        registry.execute(
          "wiki.search",
          { query: "deploy markers visible", includeRaw: true, limit: 5 },
          context,
        ),
      ).resolves.toMatchObject({
        indexed: true,
        count: 3,
        matches: [
          {
            path: "projects/roo-code.md",
            kind: "curated",
            preview: expect.stringContaining("deploy markers should stay visible"),
          },
          { path: "sources/slack/roo-code-sync.md", kind: "source" },
          { path: "raw/slack/roo-code-sync.md", kind: "raw" },
        ],
      });

      await expect(
        registry.execute(
          "wiki.search",
          { query: "deploy markers visible", includeRaw: false, limit: 5 },
          context,
        ),
      ).resolves.toMatchObject({
        indexed: true,
        count: 2,
        matches: [
          { path: "projects/roo-code.md", kind: "curated" },
          { path: "sources/slack/roo-code-sync.md", kind: "source" },
        ],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("writes, patches, logs, and updates the wiki index", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tools-"));
    try {
      const changes: ToolFileChange[] = [];
      const wikiRoot = path.join(repoRoot, "wiki");
      await mkdir(wikiRoot, { recursive: true });
      await writeFile(
        path.join(wikiRoot, "index.md"),
        [
          "---",
          "type: index",
          "last_updated: null",
          "---",
          "",
          "# Strata Index",
          "",
          "## Projects",
          "",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(path.join(wikiRoot, "log.md"), "# Strata - Activity Log\n", "utf8");

      const registry = createDefaultToolRegistry({ profile: "maintenance" });
      const context = {
        repoRoot,
        recordFileChange(change: ToolFileChange) {
          changes.push(change);
        },
      };

      await expect(
        registry.execute(
          "wiki.writePage",
          {
            path: "projects/alpha.md",
            content: "# Alpha\n\nStatus: draft\n",
            createDirs: true,
          },
          context,
        ),
      ).resolves.toMatchObject({
        path: "projects/alpha.md",
        repoPath: "wiki/projects/alpha.md",
        changeType: "create",
      });

      await expect(
        registry.execute(
          "wiki.patchPage",
          {
            path: "projects/alpha.md",
            oldText: "Status: draft",
            newText: "Status: active",
          },
          context,
        ),
      ).resolves.toMatchObject({
        path: "projects/alpha.md",
        repoPath: "wiki/projects/alpha.md",
        replacements: 1,
      });
      expect(await readFile(path.join(wikiRoot, "projects", "alpha.md"), "utf8")).toContain(
        "Status: active",
      );

      await expect(
        registry.execute(
          "wiki.appendLog",
          { entry: "Created alpha project page.", timestamp: "2026-05-02T00:00:00.000Z" },
          context,
        ),
      ).resolves.toMatchObject({
        path: "log.md",
        repoPath: "wiki/log.md",
        changeType: "append",
      });
      expect(await readFile(path.join(wikiRoot, "log.md"), "utf8")).toContain(
        "Created alpha project page.",
      );

      await expect(
        registry.execute(
          "wiki.updateIndex",
          {
            section: "Projects",
            target: "projects/alpha.md",
            label: "Alpha",
            description: "Active project",
          },
          context,
        ),
      ).resolves.toMatchObject({
        path: "index.md",
        repoPath: "wiki/index.md",
        target: "projects/alpha",
      });
      expect(await readFile(path.join(wikiRoot, "index.md"), "utf8")).toContain(
        "- [[projects/alpha|Alpha]] - Active project",
      );
      expect(changes.map((change) => change.path)).toEqual([
        "wiki/projects/alpha.md",
        "wiki/projects/alpha.md",
        "wiki/log.md",
        "wiki/index.md",
      ]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("blocks wiki writes outside markdown pages and raw sources", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tools-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "raw"), { recursive: true });
      const registry = createDefaultToolRegistry({ profile: "maintenance" });
      const context = { repoRoot };

      for (const [toolName, args, code] of [
        [
          "wiki.writePage",
          { path: "../outside.md", content: "no\n", createDirs: true },
          "outside_wiki",
        ],
        [
          "wiki.writePage",
          { path: "raw/source.md", content: "no\n", createDirs: true },
          "raw_write_forbidden",
        ],
        ["wiki.writePage", { path: "projects/alpha.txt", content: "no\n" }, "not_markdown"],
      ] as const) {
        const result = await registry.safeExecute(toolName, args, context);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(code);
        }
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
