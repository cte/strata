import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultToolRegistry } from "./index.js";

describe("filesystem tools", () => {
  test("lists, reads, finds, and greps repo files", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-tools-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await mkdir(path.join(repoRoot, "wiki", "raw", "granola"), { recursive: true });
      await mkdir(path.join(repoRoot, "src"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "alpha.md"),
        "# Alpha\n\nNeedle appears here.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "raw", "granola", "source.md"),
        "# Source\n\nNeedle raw source.\n",
        "utf8",
      );
      await writeFile(path.join(repoRoot, "src", "main.ts"), "export const value = 1;\n", "utf8");

      const registry = createDefaultToolRegistry();
      const context = { repoRoot };

      const list = (await registry.execute(
        "fs.list",
        { path: "wiki", recursive: true },
        context,
      )) as {
        entries: { path: string; type: string }[];
      };
      expect(list.entries.map((entry) => entry.path)).toEqual([
        "wiki/index.md",
        "wiki/projects",
        "wiki/projects/alpha.md",
      ]);

      await expect(
        registry.execute("fs.read", { path: "wiki/projects/alpha.md", maxChars: 7 }, context),
      ).resolves.toMatchObject({
        path: "wiki/projects/alpha.md",
        content: "# Alpha",
        truncated: true,
      });

      await expect(
        registry.execute("fs.find", { pattern: "*.ts", root: "src" }, context),
      ).resolves.toMatchObject({
        count: 1,
        matches: [{ path: "src/main.ts", type: "file" }],
      });

      await expect(
        registry.execute("fs.grep", { query: "needle", root: "wiki" }, context),
      ).resolves.toMatchObject({
        count: 1,
        matches: [{ path: "wiki/projects/alpha.md", line: 3 }],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("requires explicit raw-source reads and searches", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-tools-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "raw"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "raw", "source.md"), "Raw needle.\n", "utf8");

      const registry = createDefaultToolRegistry();
      const context = { repoRoot };

      const readDenied = await registry.safeExecute(
        "fs.read",
        { path: "wiki/raw/source.md" },
        context,
      );
      expect(readDenied.ok).toBe(false);
      if (!readDenied.ok) {
        expect(readDenied.error.code).toBe("raw_read_not_enabled");
      }

      await expect(
        registry.execute("fs.read", { path: "wiki/raw/source.md", includeRaw: true }, context),
      ).resolves.toMatchObject({
        path: "wiki/raw/source.md",
        content: "Raw needle.\n",
      });

      await expect(
        registry.execute("fs.grep", { query: "needle" }, context),
      ).resolves.toMatchObject({
        count: 0,
      });
      await expect(
        registry.execute("fs.grep", { query: "needle", includeRaw: true }, context),
      ).resolves.toMatchObject({
        count: 1,
        matches: [{ path: "wiki/raw/source.md" }],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("blocks escapes, runtime dirs, binary files, and symlink reads", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-tools-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-outside-"));
    try {
      await mkdir(path.join(repoRoot, ".cortex"), { recursive: true });
      await writeFile(path.join(repoRoot, ".cortex", "secret.txt"), "secret\n", "utf8");
      await writeFile(path.join(repoRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));
      await writeFile(path.join(outsideRoot, "outside.txt"), "outside\n", "utf8");
      await symlink(path.join(outsideRoot, "outside.txt"), path.join(repoRoot, "link.txt"));
      await symlink(outsideRoot, path.join(repoRoot, "linkdir"));

      const registry = createDefaultToolRegistry();
      const context = { repoRoot };

      for (const [requestedPath, code] of [
        ["../outside.txt", "outside_repo"],
        [".cortex/secret.txt", "blocked_path_segment"],
        ["binary.dat", "binary_file"],
        ["link.txt", "symlink_not_followed"],
        ["linkdir/outside.txt", "symlink_not_followed"],
      ] as const) {
        const result = await registry.safeExecute("fs.read", { path: requestedPath }, context);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(code);
        }
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
      await rm(outsideRoot, { force: true, recursive: true });
    }
  });
});
