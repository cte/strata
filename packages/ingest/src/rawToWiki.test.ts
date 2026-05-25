import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { frontmatter } from "./common.js";
import {
  buildGranolaMeetingDraft,
  runGranolaRawToWikiIndex,
  runGranolaRawToWikiProposals,
  runRawToWikiIndex,
} from "./rawToWiki.js";

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-raw-to-wiki-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await writeFile(path.join(repoRoot, "CLAUDE.md"), "# test\n", "utf8");
    await mkdir(path.join(repoRoot, "wiki/raw/granola"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki/meetings"), { recursive: true });
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("Granola raw-to-wiki proposals", () => {
  test("builds the minimal proposal shape from a raw Granola snapshot", () => {
    const rawPath = "wiki/raw/granola/2026-05-04-roadmap-sync.md";
    const draft = buildGranolaMeetingDraft("/repo", rawPath, rawGranolaSnapshot("Roadmap Sync"));

    expect(draft).toMatchObject({
      rawPath,
      title: "Roadmap Sync",
      date: "2026-05-04",
      proposedMeetingPath: "wiki/meetings/2026-05-04-roadmap-sync.md",
      peopleCandidates: ["Ada Lovelace", "Grace Hopper"],
    });
    expect(draft?.actionCandidates.map((candidate) => candidate.text)).toContain(
      "Grace Hopper will prepare the migration checklist.",
    );
    expect(draft?.decisionCandidates.map((candidate) => candidate.text)).toContain(
      "We agreed to stage raw-to-wiki proposals before editing the wiki.",
    );
    expect(draft?.uncertainty).toContain(
      "No explicit project was found; project page updates require manual mapping.",
    );
  });

  test("stages proposals without writing wiki meeting pages", async () => {
    await withTempRepo(async (repoRoot) => {
      const rawPath = path.join(repoRoot, "wiki/raw/granola/2026-05-04-roadmap-sync.md");
      await writeFile(rawPath, rawGranolaSnapshot("Roadmap Sync"), "utf8");

      const result = await runGranolaRawToWikiProposals({
        repoRoot,
        rawPaths: [rawPath],
      });

      expect(result.scanned).toBe(1);
      expect(result.proposals).toHaveLength(1);
      expect(result.items[0]?.proposedMeetingPath).toBe("wiki/meetings/2026-05-04-roadmap-sync.md");
      await expect(
        access(path.join(repoRoot, "wiki/meetings/2026-05-04-roadmap-sync.md")),
      ).rejects.toThrow();

      const proposalPath = path.join(repoRoot, result.proposals[0]?.path ?? "");
      const proposal = await readFile(proposalPath, "utf8");
      expect(proposal).toContain("kind: wiki");
      expect(proposal).toContain(
        "Proposed meeting page: `wiki/meetings/2026-05-04-roadmap-sync.md`",
      );
      expect(proposal).toContain("Decision candidates:");
      expect(proposal).toContain("Action candidates:");
      expect(proposal).toContain("Uncertainty:");

      const trace = await readFile(
        path.join(repoRoot, ".strata/traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("raw_to_wiki.granola.started");
      expect(trace).toContain("proposal.created");
      expect(trace).toContain("raw_to_wiki.granola.completed");
    });
  });

  test("indexes raw Granola snapshots into meeting and entity wiki pages", async () => {
    await withTempRepo(async (repoRoot) => {
      const rawPath = path.join(repoRoot, "wiki/raw/granola/2026-05-04-roadmap-sync.md");
      await writeFile(rawPath, rawGranolaSnapshot("Roadmap Sync"), "utf8");

      const result = await runGranolaRawToWikiIndex({
        repoRoot,
        rawPaths: [rawPath],
        now: new Date("2026-05-05T10:00:00.000Z"),
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.meetingPath).toBe("wiki/meetings/2026-05-04-roadmap-sync.md");
      expect(result.indexed[0]?.peoplePaths).toContain("wiki/people/ada-lovelace.md");
      expect(result.indexed[0]?.projectPaths).toContain("wiki/projects/document-classifier.md");
      expect(result.indexed[0]?.decisionPaths.length).toBeGreaterThan(0);
      expect(result.indexed[0]?.threadPaths.length).toBeGreaterThan(0);

      const meeting = await readFile(
        path.join(repoRoot, "wiki/meetings/2026-05-04-roadmap-sync.md"),
        "utf8",
      );
      expect(meeting).toContain("type: meeting");
      expect(meeting).toContain("[[people/ada-lovelace|Ada Lovelace]]");
      expect(meeting).toContain("[[projects/document-classifier|Document Classifier]]");
      expect(meeting).toContain("Raw transcript:");

      const person = await readFile(path.join(repoRoot, "wiki/people/ada-lovelace.md"), "utf8");
      expect(person).toContain("[[meetings/2026-05-04-roadmap-sync|Roadmap Sync]]");

      const project = await readFile(
        path.join(repoRoot, "wiki/projects/document-classifier.md"),
        "utf8",
      );
      expect(project).toContain("Source Meetings");
      expect(project).toContain("[[meetings/2026-05-04-roadmap-sync|Roadmap Sync]]");

      const actions = await readFile(path.join(repoRoot, "wiki/actions/theirs.md"), "utf8");
      expect(actions).toContain("Grace Hopper will prepare the migration checklist.");

      const index = await readFile(path.join(repoRoot, "wiki/index.md"), "utf8");
      expect(index).toContain("[[meetings/2026-05-04-roadmap-sync|Roadmap Sync]]");
      expect(index).toContain("[[projects/document-classifier|Document Classifier]]");

      const log = await readFile(path.join(repoRoot, "wiki/log.md"), "utf8");
      expect(log).toContain("ingest | Raw-to-wiki indexed 1 source");
    });
  });

  test("applies the limit to explicit raw paths", async () => {
    await withTempRepo(async (repoRoot) => {
      const firstPath = path.join(repoRoot, "wiki/raw/granola/2026-05-04-roadmap-sync.md");
      const secondPath = path.join(repoRoot, "wiki/raw/granola/2026-05-04-design-sync.md");
      await writeFile(firstPath, rawGranolaSnapshot("Roadmap Sync"), "utf8");
      await writeFile(secondPath, rawGranolaSnapshot("Design Sync"), "utf8");

      const result = await runGranolaRawToWikiIndex({
        repoRoot,
        rawPaths: [firstPath, secondPath],
        limit: 1,
        dryRun: true,
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.meetingPath).toBe("wiki/meetings/2026-05-04-roadmap-sync.md");
    });
  });

  test("indexes raw Notion pages into project wiki pages", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/notion"), { recursive: true });
      const rawPath = path.join(repoRoot, "wiki/raw/notion/2026-05-06-launch-plan.md");
      await writeFile(rawPath, rawNotionSnapshot("Launch Plan"), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "notion",
        rawPaths: [rawPath],
        now: new Date("2026-05-07T10:00:00.000Z"),
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.source).toBe("notion");
      expect(result.indexed[0]?.primaryKind).toBe("project");
      expect(result.indexed[0]?.primaryPath).toBe("wiki/projects/launch-plan.md");

      const project = await readFile(path.join(repoRoot, "wiki/projects/launch-plan.md"), "utf8");
      expect(project).toContain("type: project");
      expect(project).toContain("source: raw/notion/2026-05-06-launch-plan.md");
      expect(project).toContain("We agreed to ship the onboarding checklist.");

      const actions = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(actions).toContain("Chris will draft the launch checklist.");
    });
  });

  test("indexes raw Slack threads into thread wiki pages", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      const rawPath = path.join(repoRoot, "wiki/raw/slack/2026-05-08-self-serve-pricing.md");
      await writeFile(rawPath, rawSlackSnapshot("Can we enable self serve pricing?"), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "slack",
        rawPaths: [rawPath],
        now: new Date("2026-05-08T10:00:00.000Z"),
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.source).toBe("slack");
      expect(result.indexed[0]?.primaryKind).toBe("thread");
      expect(result.indexed[0]?.primaryPath).toBe(
        "wiki/threads/c123-1778304572568589-can-we-enable-self-serve-pricing.md",
      );
      expect(result.indexed[0]?.projectPaths).toContain("wiki/projects/self-serve.md");
      expect(result.indexed[0]?.projectPaths).toContain("wiki/projects/pricing.md");

      const thread = await readFile(
        path.join(
          repoRoot,
          "wiki/threads/c123-1778304572568589-can-we-enable-self-serve-pricing.md",
        ),
        "utf8",
      );
      expect(thread).toContain("type: thread");
      expect(thread).toContain("Raw source:");
      expect(thread).toContain("Can we enable self serve pricing?");

      const index = await readFile(path.join(repoRoot, "wiki/index.md"), "utf8");
      expect(index).toContain(
        "[[threads/c123-1778304572568589-can-we-enable-self-serve-pricing|Can we enable self serve pricing?]]",
      );
    });
  });

  test("maps Slack project candidates to canonical topic pages", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      const rawPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-sentry-modal.md");
      await writeFile(rawPath, rawSlackCanonicalProjectSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "slack",
        rawPaths: [rawPath],
        dryRun: true,
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.projectPaths).toEqual([
        "wiki/projects/roo-code.md",
        "wiki/projects/roomote.md",
        "wiki/projects/sentry.md",
        "wiki/projects/modal.md",
      ]);
      expect(result.indexed[0]?.projectPaths).not.toContain(
        "wiki/projects/can-you-triage-sentry-errors-for-roocodeinc-roomote-on-modal.md",
      );
    });
  });

  test("skips low-signal Slack automation and empty threads", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      const logPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-worker-error.md");
      const emptyPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-empty-thread.md");
      const bellPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-bell-alert.md");
      const deployPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-deploy-starting.md");
      const linkPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-link-only.md");
      const smallTalkPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-small-talk.md");
      await writeFile(logPath, rawSlackWorkerLogSnapshot(), "utf8");
      await writeFile(emptyPath, rawSlackEmptySnapshot(), "utf8");
      await writeFile(bellPath, rawSlackBellSnapshot(), "utf8");
      await writeFile(deployPath, rawSlackDeploySnapshot(), "utf8");
      await writeFile(linkPath, rawSlackLinkOnlySnapshot(), "utf8");
      await writeFile(smallTalkPath, rawSlackSmallTalkSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "slack",
        rawPaths: [logPath, emptyPath, bellPath, deployPath, linkPath, smallTalkPath],
        dryRun: true,
      });

      expect(result.scanned).toBe(6);
      expect(result.indexed).toHaveLength(0);
      expect(result.skipped.map((item) => item.reason)).toContain(
        "Slack thread appears to be an automation/log notification.",
      );
      expect(result.skipped.map((item) => item.reason)).toContain(
        "Slack thread contains no message text.",
      );
      expect(result.skipped.map((item) => item.reason)).toContain(
        "Slack thread only contains links and no material context.",
      );
      expect(result.skipped.map((item) => item.reason)).toContain(
        "Slack thread has no material ask, decision, action, incident, or project signal.",
      );
    });
  });
});

function rawGranolaSnapshot(title: string): string {
  return `${frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date: "2026-05-04",
    title,
    attendees: ["Ada Lovelace", "Grace Hopper"],
    source_url: "https://notes.granola.ai/d/roadmap",
    pulled_at: "2026-05-05T10:00:00.000Z",
  })}
# ${title}

## Summary

### Document Classifier Progress

- We agreed to stage raw-to-wiki proposals before editing the wiki.
- Grace Hopper will prepare the migration checklist.
- Open question: how should indexed meeting pages update projects?

## Transcript

Ada Lovelace: We agreed to stage raw-to-wiki proposals before editing the wiki.

Grace Hopper: Grace Hopper will prepare the migration checklist.

Next step: review the generated proposal.
`;
}

function rawNotionSnapshot(title: string): string {
  return `${frontmatter({
    type: "raw_notion_page",
    source: "notion",
    date: "2026-05-06",
    title,
    page_id: "11111111-1111-1111-1111-111111111111",
    source_url: "https://notion.so/launch",
    pulled_at: "2026-05-07T10:00:00.000Z",
  })}
# ${title}

## Status

We agreed to ship the onboarding checklist.
Chris will draft the launch checklist.
Open question: how should we announce pricing?
`;
}

function rawSlackSnapshot(title: string): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-08",
    channel: "C123",
    thread_ts: "1778304572.568589",
    latest_ts: "1778304572.568589",
    title,
    source_url: "https://example.slack.com/archives/C123/p1778304572568589",
    message_count: 2,
    pulled_at: "2026-05-08T10:00:00.000Z",
  })}
# ${title}

## 1778304572.568589 | Chris Estreich

Can we enable self serve pricing?

## 1778304580.000000 | Ada Lovelace

We agreed to test pricing with a small cohort.
`;
}

function rawSlackCanonicalProjectSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C456",
    thread_ts: "1778399999.123456",
    latest_ts: "1778399999.123456",
    title: "Can you triage Sentry errors for RooCodeInc Roomote on Modal?",
    source_url: "https://example.slack.com/archives/C456/p1778399999123456",
    message_count: 2,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Can you triage Sentry errors for RooCodeInc Roomote on Modal?

## 1778399999.123456 | Chris Estreich

Can you triage the Sentry errors for RooCodeInc Roomote on Modal?

## 1778400000.000000 | Ada Lovelace

I will check whether Modal is causing the Roomote error spike.
`;
}

function rawSlackWorkerLogSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C090WJK6TRQ",
    thread_ts: "1778314634.215679",
    latest_ts: "1778314634.215679",
    title: "[roomote-worker] [codex-acp:stderr] ERROR",
    message_count: 1,
    pulled_at: "2026-05-09T08:17:16.343Z",
  })}
# [roomote-worker] [codex-acp:stderr] ERROR

## 1778314634.215679 | U090NHYC4JX

[roomote-worker] [codex-acp:stderr] ERROR Unhandled error during turn: Quota exceeded.
`;
}

function rawSlackEmptySnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C08RMST9GSH",
    thread_ts: "1778291205.009759",
    latest_ts: "1778291205.223049",
    title: "Slack thread",
    message_count: 2,
    pulled_at: "2026-05-09T13:42:08.401Z",
  })}
# Slack thread

## 1778291205.009759 | U08RMCJEK24

_No text_

## 1778291205.223049 | U08RMCJEK24

_No text_
`;
}

function rawSlackBellSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C09PFJSR5T2",
    thread_ts: "1778302810.999859",
    latest_ts: "1778302810.999859",
    title: ":bell: Unsuccessful (Last 5m) <https://roocode.metabaseapp.com/question/1420|Uns",
    message_count: 1,
    pulled_at: "2026-05-09T05:00:12.638Z",
  })}
# :bell: Unsuccessful (Last 5m) <https://roocode.metabaseapp.com/question/1420|Uns

## 1778302810.999859 | Metabot

:bell: Unsuccessful (Last 5m) <https://roocode.metabaseapp.com/question/1420|Unsuccessful (Last 5m)> Unsuccessful (Last 5m)
`;
}

function rawSlackDeploySnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1778341440.184029",
    latest_ts: "1778341440.184029",
    title: "*Deploy-ECS-Image roo-node* (prod): starting...",
    message_count: 1,
    pulled_at: "2026-05-09T15:44:02.274Z",
  })}
# *Deploy-ECS-Image roo-node* (prod): starting...

## 1778341440.184029 | U04JF0W5W1K

*Deploy-ECS-Image roo-node* (prod): starting...
`;
}

function rawSlackLinkOnlySnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C09CZ8ZCBK4",
    thread_ts: "1778360486.172469",
    latest_ts: "1778360486.172469",
    title: "<https://x.com/tobi/status/2053121182044451016?s=46|https://x.com/tobi/status/20",
    message_count: 1,
    pulled_at: "2026-05-09T21:01:27.823Z",
  })}
# <https://x.com/tobi/status/2053121182044451016?s=46|https://x.com/tobi/status/20

## 1778360486.172469 | U08ELT3D32A

<https://x.com/tobi/status/2053121182044451016?s=46|https://x.com/tobi/status/2053121182044451016?s=46>
`;
}

function rawSlackSmallTalkSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C095Y0N6HRQ",
    thread_ts: "1779417197.778269",
    latest_ts: "1779417197.778269",
    title: "U0AGF0CA8D7 hi hi tell me a joke",
    message_count: 1,
    pulled_at: "2026-05-22T10:00:00.000Z",
  })}
# U0AGF0CA8D7 hi hi tell me a joke

## 1779417197.778269 | U0AGF0CA8D7

hi hi tell me a joke
`;
}
