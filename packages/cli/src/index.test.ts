import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-cli-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await writeFile(path.join(repoRoot, "CLAUDE.md"), "# test\n", "utf8");
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("strata sessions delete", () => {
  test("deletes a session by unique id prefix with --yes", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const store = await SessionStore.open(repoRoot);
      const session = await store.createSession({ kind: "query", title: "CLI delete target" });
      await store.appendMessage({
        sessionId: session.id,
        role: "user",
        content: "delete through cli",
      });
      await store.endSession(session.id, "completed");
      const tracePath = path.join(store.paths.traceDir, `${session.id}.jsonl`);
      await access(tracePath);
      store.close();

      const result = spawnSync(
        "bun",
        [cliPath, "sessions", "delete", session.id.slice(0, 12), "--yes"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`deleted session ${session.id}`);
      const reopened = await SessionStore.open(repoRoot);
      try {
        expect(reopened.getSession(session.id)).toBeUndefined();
        expect(reopened.listMessages(session.id)).toEqual([]);
      } finally {
        reopened.close();
      }
      await expect(access(tracePath)).rejects.toThrow();
    });
  });
});

describe("strata tui options", () => {
  test("prints Pi-style TUI session launch options", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const result = spawnSync("bun", [cliPath, "tui", "--help"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--continue, -c");
      expect(result.stdout).toContain("--resume, -r");
      expect(result.stdout).toContain("--session <id>");
      expect(result.stdout).toContain("--fork <id>");
    });
  });

  test("rejects unknown TUI launch arguments before starting the TUI", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const result = spawnSync("bun", [cliPath, "tui", "--wat"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown tui argument: --wat");
    });
  });

  test("rejects fork combined with other resume modes", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const result = spawnSync("bun", [cliPath, "tui", "--fork", "abc", "--continue"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--fork cannot be combined");
    });
  });
});
