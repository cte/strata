import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultToolRegistry } from "./index.js";
import type { ToolFileChange } from "./types.js";

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

  test("creates and overwrites text files with file-change records", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-tools-"));
    try {
      const changes: ToolFileChange[] = [];
      const registry = createDefaultToolRegistry({ profile: "maintenance" });
      const context = {
        repoRoot,
        recordFileChange(change: ToolFileChange) {
          changes.push(change);
        },
      };

      await expect(
        registry.execute(
          "fs.write",
          { path: "notes/today.md", content: "# Today\n", createDirs: true },
          context,
        ),
      ).resolves.toMatchObject({
        path: "notes/today.md",
        changeType: "create",
        overwritten: false,
      });
      expect(await readFile(path.join(repoRoot, "notes", "today.md"), "utf8")).toBe("# Today\n");
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        path: "notes/today.md",
        changeType: "create",
        beforeHash: null,
        beforeBytes: 0,
        afterBytes: 8,
      });

      const exists = await registry.safeExecute(
        "fs.write",
        { path: "notes/today.md", content: "# Replacement\n" },
        context,
      );
      expect(exists.ok).toBe(false);
      if (!exists.ok) {
        expect(exists.error.code).toBe("file_exists");
      }

      await expect(
        registry.execute(
          "fs.write",
          { path: "notes/today.md", content: "# Replacement\n", overwrite: true },
          context,
        ),
      ).resolves.toMatchObject({
        path: "notes/today.md",
        changeType: "update",
        overwritten: true,
      });
      expect(changes).toHaveLength(2);
      expect(changes[1]?.beforeHash).toBe(changes[0]?.afterHash);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("edits text files only when the match is unambiguous", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-tools-"));
    try {
      await mkdir(path.join(repoRoot, "notes"), { recursive: true });
      await writeFile(path.join(repoRoot, "notes", "today.md"), "alpha\nbeta\nbeta\n", "utf8");

      const changes: ToolFileChange[] = [];
      const registry = createDefaultToolRegistry({ profile: "maintenance" });
      const context = {
        repoRoot,
        recordFileChange(change: ToolFileChange) {
          changes.push(change);
        },
      };

      await expect(
        registry.execute(
          "fs.edit",
          { path: "notes/today.md", oldText: "alpha", newText: "gamma" },
          context,
        ),
      ).resolves.toMatchObject({
        path: "notes/today.md",
        replacements: 1,
      });

      const ambiguous = await registry.safeExecute(
        "fs.edit",
        { path: "notes/today.md", oldText: "beta", newText: "delta" },
        context,
      );
      expect(ambiguous.ok).toBe(false);
      if (!ambiguous.ok) {
        expect(ambiguous.error.code).toBe("ambiguous_match");
      }

      await expect(
        registry.execute(
          "fs.edit",
          { path: "notes/today.md", oldText: "beta", newText: "delta", replaceAll: true },
          context,
        ),
      ).resolves.toMatchObject({
        path: "notes/today.md",
        replacements: 2,
      });
      expect(await readFile(path.join(repoRoot, "notes", "today.md"), "utf8")).toBe(
        "gamma\ndelta\ndelta\n",
      );
      expect(changes.map((change) => change.changeType)).toEqual(["update", "update"]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("blocks writes under raw, runtime dirs, and symlink paths", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-tools-"));
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-fs-outside-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "raw"), { recursive: true });
      await symlink(outsideRoot, path.join(repoRoot, "linkdir"));

      const registry = createDefaultToolRegistry({ profile: "maintenance" });
      const context = { repoRoot };

      for (const [requestedPath, code] of [
        ["wiki/raw/source.md", "raw_write_forbidden"],
        [".cortex/secret.txt", "blocked_path_segment"],
        ["linkdir/outside.txt", "symlink_not_followed"],
      ] as const) {
        const result = await registry.safeExecute(
          "fs.write",
          { path: requestedPath, content: "no\n", createDirs: true },
          context,
        );
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
