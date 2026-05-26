import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("strata ingest granola propose", () => {
  test("stages raw-to-wiki proposals from the CLI", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const rawDir = path.join(repoRoot, "wiki/raw/granola");
      await mkdir(rawDir, { recursive: true });
      const rawPath = path.join(rawDir, "2026-05-04-roadmap-sync.md");
      await writeFile(
        rawPath,
        `---
type: raw_granola_transcript
source: granola
date: 2026-05-04
title: "Roadmap Sync"
attendees:
  - Ada
source_url: https://notes.granola.ai/d/roadmap
pulled_at: 2026-05-05T10:00:00.000Z
---

# Roadmap Sync

Ada: We agreed to stage proposals before editing pages.
`,
        "utf8",
      );

      const result = spawnSync(
        "bun",
        [cliPath, "ingest", "granola", "propose", "--raw-path", rawPath],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("proposals: 1");
      expect(result.stdout).toContain("proposal: .strata/proposals/");
      const match = /proposal: (.+)/.exec(result.stdout);
      expect(match?.[1]).toBeString();
      const proposal = await readFile(path.join(repoRoot, match?.[1] ?? ""), "utf8");
      expect(proposal).toContain("wiki/meetings/2026-05-04-roadmap-sync.md");
    });
  });

  test("indexes raw Granola snapshots into wiki pages from the CLI", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const rawDir = path.join(repoRoot, "wiki/raw/granola");
      await mkdir(rawDir, { recursive: true });
      const rawPath = path.join(rawDir, "2026-05-04-roadmap-sync.md");
      await writeFile(
        rawPath,
        `---
type: raw_granola_transcript
source: granola
date: 2026-05-04
title: "Roadmap Sync"
attendees:
  - Ada
source_url: https://notes.granola.ai/d/roadmap
pulled_at: 2026-05-05T10:00:00.000Z
---

# Roadmap Sync

## Summary

### Launch Readiness

- We agreed to index meetings automatically.
- Open question: how should follow-up actions be routed?

## Transcript

Ada: We agreed to index meetings automatically.
`,
        "utf8",
      );

      const result = spawnSync(
        "bun",
        [cliPath, "ingest", "granola", "index", "--raw-path", rawPath],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("indexed: 1");
      expect(result.stdout).toContain("wrote wiki/meetings/2026-05-04-roadmap-sync.md");
      const meeting = await readFile(
        path.join(repoRoot, "wiki/meetings/2026-05-04-roadmap-sync.md"),
        "utf8",
      );
      expect(meeting).toContain("type: meeting");
      expect(meeting).toContain("[[projects/launch-readiness|Launch Readiness]]");
    });
  });

  test("indexes raw Slack snapshots through the generalized raw index command", async () => {
    await withTempRepo(async (repoRoot) => {
      const cliPath = path.join(import.meta.dir, "index.ts");
      const rawDir = path.join(repoRoot, "wiki/raw/slack");
      await mkdir(rawDir, { recursive: true });
      const rawPath = path.join(rawDir, "2026-05-08-self-serve-pricing.md");
      await writeFile(
        rawPath,
        `---
type: raw_slack_thread
source: slack
date: 2026-05-08
channel: C123
thread_ts: "1778304572.568589"
latest_ts: "1778304572.568589"
title: "Can we enable self serve pricing?"
source_url: https://example.slack.com/archives/C123/p1778304572568589
message_count: 2
pulled_at: 2026-05-08T10:00:00.000Z
---

# Can we enable self serve pricing?

## 1778304572.568589 | Chris Estreich

Can we enable self serve pricing?

## 1778304580.000000 | Ada Lovelace

We agreed to test pricing with a small cohort.
`,
        "utf8",
      );

      const result = spawnSync(
        "bun",
        [cliPath, "ingest", "raw", "index", "--source", "slack", "--raw-path", rawPath],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("indexed: 1");
      expect(result.stdout).toContain(
        "wrote source wiki/sources/slack/c123/2026-05-08-1778304572568589-can-we-enable-self-serve-pricing.md",
      );
      const source = await readFile(
        path.join(
          repoRoot,
          "wiki/sources/slack/c123/2026-05-08-1778304572568589-can-we-enable-self-serve-pricing.md",
        ),
        "utf8",
      );
      expect(source).toContain("type: slack_source");
      expect(source).toContain("source: raw/slack/2026-05-08-self-serve-pricing.md");
    });
  });
});
