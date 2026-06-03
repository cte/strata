import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findRepoRoot } from "../paths.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "strata-paths-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("findRepoRoot", () => {
  test("uses STRATA_REPO_ROOT when running outside the repo", async () => {
    await withTempDir(async (repoRoot) => {
      await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
      await writeFile(path.join(repoRoot, "CLAUDE.md"), "# test\n", "utf8");
      const previous = process.env.STRATA_REPO_ROOT;
      process.env.STRATA_REPO_ROOT = repoRoot;
      try {
        expect(findRepoRoot(path.join(os.tmpdir(), "outside-strata"))).toBe(path.resolve(repoRoot));
      } finally {
        if (previous === undefined) {
          delete process.env.STRATA_REPO_ROOT;
        } else {
          process.env.STRATA_REPO_ROOT = previous;
        }
      }
    });
  });
});
