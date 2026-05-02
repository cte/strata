import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultToolRegistry } from "./index.js";

describe("wiki tools", () => {
  test("lists, reads, and searches markdown pages", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tools-"));
    try {
      const wikiRoot = path.join(repoRoot, "wiki");
      await mkdir(path.join(wikiRoot, "projects"), { recursive: true });
      await mkdir(path.join(wikiRoot, "raw", "granola"), { recursive: true });
      await writeFile(path.join(wikiRoot, "index.md"), "# Index\n\nCortex root\n", "utf8");
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
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
