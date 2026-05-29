import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findRepoFiles } from "../repoFiles.js";

async function makeRepo(layout: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "strata-repo-files-"));
  for (const [relativePath, content] of Object.entries(layout)) {
    const full = path.join(root, relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

describe("findRepoFiles", () => {
  test("scopes search to the entire repo and ranks by filename match", async () => {
    const repoRoot = await makeRepo({
      "wiki/projects/alpha.md": "# Alpha\n",
      "wiki/people/alice.md": "# Alice\n",
      "src/utils/alpha.ts": "export const x = 1;\n",
      "README.md": "readme\n",
    });
    try {
      const bare = findRepoFiles({ repoRoot, query: "", limit: 20 });
      expect(bare.length).toBeGreaterThan(0);

      const alpha = findRepoFiles({ repoRoot, query: "alpha", limit: 20 });
      expect(alpha.map((entry) => entry.path)).toEqual(
        expect.arrayContaining(["src/utils/alpha.ts", "wiki/projects/alpha.md"]),
      );
      expect(alpha[0]).toEqual({ path: "src/utils/alpha.ts", isDirectory: false });

      const none = findRepoFiles({ repoRoot, query: "xyzzy", limit: 20 });
      expect(none).toEqual([]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("surfaces directories alongside files with a trailing-path entry", async () => {
    const repoRoot = await makeRepo({
      "wiki/projects/alpha.md": "",
      "wiki/projects/notes/meeting.md": "",
    });
    try {
      const result = findRepoFiles({ repoRoot, query: "projects", limit: 20 });
      expect(result).toContainEqual({ path: "wiki/projects", isDirectory: true });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("matches regardless of case", async () => {
    const repoRoot = await makeRepo({ "wiki/projects/Alpha-Beta.md": "" });
    try {
      const result = findRepoFiles({ repoRoot, query: "alpha", limit: 20 });
      expect(result[0]).toEqual({ path: "wiki/projects/Alpha-Beta.md", isDirectory: false });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("returns an empty list when repo enumeration fails", () => {
    const result = findRepoFiles({
      repoRoot: path.join(os.tmpdir(), "strata-repo-files-missing"),
      query: "",
      limit: 20,
    });
    expect(result).toEqual([]);
  });
});
