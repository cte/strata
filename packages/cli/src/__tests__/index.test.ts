import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore, writeLearningProposal } from "@strata/core";
import { RoutineStore } from "@strata/routines";
import { parseQueryOptions, parseTuiOptions } from "../index.js";

const cliPath = path.resolve(import.meta.dir, "..", "index.ts");

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

describe("strata --version", () => {
  test("prints the current development version", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = spawnSync("bun", [cliPath, "--version"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toMatch(/^strata 0\.1\.0-dev\+[0-9a-f]{12}(\.dirty)?$/);
    });
  });
});

describe("strata sessions delete", () => {
  test("deletes a session by unique id prefix with --yes", async () => {
    await withTempRepo(async (repoRoot) => {
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
  test("routes top-level TUI options to the TUI command", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = spawnSync("bun", [cliPath, "-r", "--help"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("usage: strata [tui] [options]");
      expect(result.stdout).toContain("--resume, -r [id]");
    });
  });

  test("prints Pi-style TUI session launch options", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = spawnSync("bun", [cliPath, "tui", "--help"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--continue, -c");
      expect(result.stdout).toContain("--resume, -r [id]");
      expect(result.stdout).toContain("--session <id>");
      expect(result.stdout).toContain("--fork <id>");
    });
  });

  test("rejects unknown TUI launch arguments before starting the TUI", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = spawnSync("bun", [cliPath, "tui", "--wat"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown tui argument: --wat");
    });
  });

  test("parses -r with an id as session resume shorthand", () => {
    expect(parseTuiOptions(["-r", "abc123"])).toEqual({
      initialSession: { type: "session", selector: "abc123" },
    });
  });

  test("parses bare -r as picker resume", () => {
    expect(parseTuiOptions(["-r"])).toEqual({ initialSession: { type: "resume" } });
  });

  test("rejects fork combined with other resume modes", async () => {
    await withTempRepo(async (repoRoot) => {
      const result = spawnSync("bun", [cliPath, "tui", "--fork", "abc", "-r", "def"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--fork cannot be combined");
    });
  });
});

describe("strata query options", () => {
  test("accepts Anthropic as a shared model provider", () => {
    expect(
      parseQueryOptions([
        "--provider",
        "anthropic-claude",
        "--model",
        "claude-opus-4-8",
        "--thinking",
        "xhigh",
        "say",
        "ok",
      ]),
    ).toEqual({
      provider: "anthropic-claude",
      model: "claude-opus-4-8",
      reasoningEffort: "xhigh",
      question: "say ok",
    });
  });

  test("uses the shared provider list in validation errors", () => {
    expect(() => parseQueryOptions(["--provider", "other", "say ok"])).toThrow(
      "--provider must be openai-codex, openai-compatible, anthropic-claude",
    );
  });

  test("validates query thinking levels from the shared level list", () => {
    expect(() => parseQueryOptions(["--thinking", "nope", "say ok"])).toThrow(
      "--thinking must be off, minimal, low, medium, high, xhigh",
    );
  });
});

describe("strata proposals", () => {
  test("lists and applies supported wiki proposals", async () => {
    await withTempRepo(async (repoRoot) => {
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_cli",
        title: "Create CLI proposal page",
        reason: "Exercise CLI proposal review.",
        evidence: ["wiki/raw/granola/2026-05-27-cli-proposal.md"],
        proposedChange: [
          "Proposed meeting page: `wiki/meetings/2026-05-27-cli-proposal.md`",
          "",
          "```markdown",
          "---",
          "type: meeting",
          "date: 2026-05-27",
          "title: CLI Proposal",
          "---",
          "",
          "# CLI Proposal",
          "",
          "## Summary",
          "",
          "- Test proposal apply.",
          "```",
        ].join("\n"),
        risk: "low",
      });

      const listed = spawnSync("bun", [cliPath, "proposals", "list", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toMatchObject({
        proposals: [expect.objectContaining({ id: proposal.id, status: "pending" })],
      });

      const applied = spawnSync("bun", [cliPath, "proposals", "apply", proposal.id], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(applied.status).toBe(0);
      expect(applied.stdout).toContain("Created wiki/meetings/2026-05-27-cli-proposal.md");
      expect(
        await readFile(path.join(repoRoot, "wiki/meetings/2026-05-27-cli-proposal.md"), "utf8"),
      ).toContain("# CLI Proposal");

      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/projects/cli-proposals.md"),
        ["# CLI Proposals", "", "- Pending CLI review.", ""].join("\n"),
        "utf8",
      );
      const patch = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_cli",
        title: "Patch CLI proposal page",
        reason: "Exercise CLI patch proposal review.",
        evidence: ["wiki/projects/cli-proposals.md"],
        proposedChange: [
          "Patch wiki page: `wiki/projects/cli-proposals.md`",
          "",
          "Expected old text:",
          "",
          "```markdown",
          "- Pending CLI review.",
          "```",
          "",
          "Replacement text:",
          "",
          "```markdown",
          "- Reviewed through the CLI.",
          "```",
        ].join("\n"),
        risk: "low",
      });
      const patchApplied = spawnSync("bun", [cliPath, "proposals", "apply", patch.id], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(patchApplied.status).toBe(0);
      expect(patchApplied.stdout).toContain("Patched wiki/projects/cli-proposals.md");
      expect(
        await readFile(path.join(repoRoot, "wiki/projects/cli-proposals.md"), "utf8"),
      ).toContain("- Reviewed through the CLI.");
    });
  });
});

describe("strata routines", () => {
  test("imports, lists, shows, and inspects routine runs and artifacts", async () => {
    await withTempRepo(async (repoRoot) => {
      const routinePath = path.join(repoRoot, "routine.json");
      await writeFile(
        routinePath,
        JSON.stringify(
          {
            id: "routine_cli_smoke",
            name: "CLI smoke routine",
            description: "Exercise routine CLI surfaces.",
            prompt: "Summarize input.",
            inputSchema: { type: "object" },
            outputMode: "none",
            outputSchema: null,
          },
          null,
          2,
        ),
        "utf8",
      );

      const created = spawnSync("bun", [cliPath, "routines", "create", "--file", routinePath], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(created.status).toBe(0);
      expect(created.stdout).toContain("created routine routine_cli_smoke");

      const listed = spawnSync("bun", [cliPath, "routines", "list", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toMatchObject({
        routines: [expect.objectContaining({ id: "routine_cli_smoke", status: "enabled" })],
      });

      const shown = spawnSync("bun", [cliPath, "routines", "show", "routine_cli_smoke", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(shown.status).toBe(0);
      expect(JSON.parse(shown.stdout)).toMatchObject({
        routine: {
          id: "routine_cli_smoke",
          name: "CLI smoke routine",
          outputMode: "none",
        },
      });

      let jobSessionId = "";
      let agentSessionId = "";
      const sessionStore = await SessionStore.open(repoRoot);
      try {
        jobSessionId = (await sessionStore.createSession({ kind: "job", title: "Routine CLI job" }))
          .id;
        agentSessionId = (
          await sessionStore.createSession({
            kind: "query",
            title: "Routine CLI agent",
          })
        ).id;
      } finally {
        sessionStore.close();
      }

      const store = await RoutineStore.open({ repoRoot });
      try {
        const run = store.createRoutineRun({
          routineId: "routine_cli_smoke",
          routineVersion: 1,
          input: {},
          status: "completed",
          taskStatus: "succeeded",
          jobSessionId,
          agentSessionId,
        });
        store.createRoutineArtifact({
          routineRunId: run.id,
          routineId: "routine_cli_smoke",
          schemaName: "routine_cli_smoke.output",
          schemaVersion: "1",
          payload: { ok: true },
          taskStatus: "succeeded",
          sessionId: agentSessionId,
        });
      } finally {
        store.close();
      }

      const runs = spawnSync("bun", [cliPath, "routines", "runs", "routine_cli_smoke", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(runs.status).toBe(0);
      expect(JSON.parse(runs.stdout)).toMatchObject({
        runs: [expect.objectContaining({ routineId: "routine_cli_smoke" })],
      });

      const artifacts = spawnSync(
        "bun",
        [cliPath, "routines", "artifacts", "routine_cli_smoke", "--json"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );
      expect(artifacts.status).toBe(0);
      expect(JSON.parse(artifacts.stdout)).toMatchObject({
        artifacts: [
          expect.objectContaining({
            routineId: "routine_cli_smoke",
            payload: { ok: true },
          }),
        ],
      });
    });
  });
});

describe("strata wiki search", () => {
  test("returns consolidated curated pages before source and raw evidence", async () => {
    await withTempRepo(async (repoRoot) => {
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

      const refreshed = spawnSync("bun", [cliPath, "wiki", "search-index", "refresh"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: process.env,
      });
      expect(refreshed.status).toBe(0);
      expect(refreshed.stdout).toContain("indexed 3 docs");

      const searched = spawnSync(
        "bun",
        [
          cliPath,
          "wiki",
          "search",
          "--include-raw",
          "--limit",
          "5",
          "deploy",
          "markers",
          "visible",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(searched.status).toBe(0);
      const lines = searched.stdout.trim().split(/\r?\n/);
      expect(lines[0]?.startsWith("projects/roo-code.md:")).toBe(true);
      expect(lines[1]?.startsWith("sources/slack/roo-code-sync.md:")).toBe(true);
      expect(lines[2]?.startsWith("raw/slack/roo-code-sync.md:")).toBe(true);
      expect(lines).toContain("matches: 3");
      expect(searched.stdout).not.toContain("projects/roocodeinc-sync.md");
    });
  });
});

describe("strata connectors config", () => {
  test("saves, lists, and rejects secret connector defaults", async () => {
    await withTempRepo(async (repoRoot) => {
      const saved = spawnSync(
        "bun",
        [
          cliPath,
          "connectors",
          "config",
          "save",
          "slack",
          "team-sync",
          "--config",
          '{"channels":"engineering,product","includePrivateChannels":true}',
          "--label",
          "Team sync",
          "--default",
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );

      expect(saved.status).toBe(0);
      expect(saved.stdout).toContain("saved slack config team-sync (default)");

      const listed = spawnSync(
        "bun",
        [cliPath, "connectors", "config", "list", "slack", "--json"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );
      expect(listed.status).toBe(0);
      expect(JSON.parse(listed.stdout)).toMatchObject({
        connector: "slack",
        defaultProfile: {
          id: "team-sync",
          label: "Team sync",
          config: {
            channels: "engineering,product",
            includePrivateChannels: true,
          },
        },
      });

      const rejected = spawnSync(
        "bun",
        [
          cliPath,
          "connectors",
          "config",
          "save",
          "slack",
          "secret",
          "--config",
          '{"userToken":"xoxp-secret"}',
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: process.env,
        },
      );
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('Connector config field "userToken" is secret');
    });
  });
});

describe("strata ingest granola propose", () => {
  test("stages raw-to-wiki proposals from the CLI", async () => {
    await withTempRepo(async (repoRoot) => {
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
