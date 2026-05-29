import { describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { frontmatter } from "./common.js";
import { listExtractionCandidates } from "./extraction/store.js";
import type { IngestTaxonomy } from "./ingestTaxonomy.js";
import {
  buildGranolaMeetingDraft,
  runGranolaRawToWikiIndex,
  runGranolaRawToWikiProposals,
  runRawToWikiIndex,
} from "./rawToWiki.js";

const TEST_INGEST_TAXONOMY = {
  version: 1,
  selfNames: ["Sam Rivera", "Sam"],
  projects: [
    { label: "Document Classifier", aliases: ["Document Classifier"] },
    { label: "Pricing", aliases: ["Pricing Strategy", "pricing"] },
    { label: "Self Serve", aliases: ["self serve"] },
    { label: "Connector Reliability", aliases: ["Connector Reliability"] },
    { label: "Atlas Portal", aliases: ["Atlas Portal"] },
    { label: "Error Tracker", aliases: ["tracker errors", "error tracker"] },
    { label: "Cloud Runner", aliases: ["Cloud Runner"] },
  ],
  slack: {
    materialPatterns: [{ value: "billing", match: "literal" }],
    ignoredLogPatterns: [
      {
        value: "automation-worker",
        match: "literal",
        reason: "Slack thread appears to be an automation/log notification.",
      },
      {
        value: "monitor alert",
        match: "literal",
        reason: "Slack thread appears to be an automation/log notification.",
      },
    ],
    transientCheckPatterns: [{ value: "^all working(?: for you)? now\\??$", match: "regex" }],
    routineCoordinationPatterns: [
      { value: "\\bhow do i\\b.{0,120}\\bagain\\??$", match: "regex" },
      { value: "^what would be the backend bit\\??$", match: "regex" },
      { value: "^how do i clean my cache\\??$", match: "regex" },
      { value: "should i wait", match: "literal" },
      { value: "would it be ok if i forwarded", match: "literal" },
      { value: "could you add the following users to it", match: "literal" },
      { value: "general sign up", match: "literal" },
      { value: "trying to figure out how to make you admin", match: "literal" },
      { value: "maybe this will help", match: "literal" },
      { value: "then i'll add users", match: "literal" },
      { value: "backend right", match: "literal" },
      { value: "test in production right", match: "literal" },
      { value: "move out our call", match: "literal" },
      { value: "update the cal invite", match: "literal" },
      { value: "forward any confirmation emails", match: "literal" },
      { value: "please let me know if anything from before pops up again", match: "literal" },
      { value: "should be quick verifications", match: "literal" },
    ],
  },
} satisfies IngestTaxonomy;

async function withTempRepo<T>(
  fn: (repoRoot: string) => Promise<T>,
  options: { writeTaxonomy?: boolean } = {},
): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-raw-to-wiki-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await writeFile(path.join(repoRoot, "CLAUDE.md"), "# test\n", "utf8");
    await mkdir(path.join(repoRoot, "wiki/raw/granola"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki/meetings"), { recursive: true });
    if (options.writeTaxonomy ?? true) {
      await mkdir(path.join(repoRoot, ".strata/ingest"), { recursive: true });
      await writeFile(
        path.join(repoRoot, ".strata/ingest/taxonomy.json"),
        `${JSON.stringify(TEST_INGEST_TAXONOMY, null, 2)}\n`,
        "utf8",
      );
    }
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
      expect(actions).toContain("strata:action-context");
      expect(actions).toContain("extractionCandidateId");
      expect(result.indexed[0]?.extractionRunIds).toHaveLength(1);
      expect(result.indexed[0]?.actionCandidateIds).toHaveLength(1);

      const candidates = await listExtractionCandidates({
        repoRoot,
        name: "daily.todo",
        day: "2026-05-04",
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        sourcePath: "wiki/raw/granola/2026-05-04-roadmap-sync.md",
        sourceType: "granola",
        status: "confirmed",
      });
      expect(candidates[0]?.publishedTarget).toContain("wiki/actions/theirs.md");
      expect(candidates[0]?.metadata.evidenceMetadata).toMatchObject({
        sourceTarget: "wiki/meetings/2026-05-04-roadmap-sync.md",
      });

      const index = await readFile(path.join(repoRoot, "wiki/index.md"), "utf8");
      expect(index).toContain("[[meetings/2026-05-04-roadmap-sync|Roadmap Sync]]");
      expect(index).toContain("[[projects/document-classifier|Document Classifier]]");

      const log = await readFile(path.join(repoRoot, "wiki/log.md"), "utf8");
      expect(log).toContain("ingest | Raw-to-wiki indexed 1 source");

      const trace = await readFile(
        path.join(repoRoot, ".strata/traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("raw_to_wiki.index.item");
      expect(trace).toContain("wiki/projects/document-classifier.md");
      expect(trace).toContain('"actionCount"');
    });
  });

  test("normalizes meeting-derived project labels to canonical project pages", async () => {
    await withTempRepo(async (repoRoot) => {
      const rawPath = path.join(repoRoot, "wiki/raw/granola/2026-05-08-pricing-strategy.md");
      await writeFile(rawPath, rawGranolaPricingSnapshot(), "utf8");

      const result = await runGranolaRawToWikiIndex({
        repoRoot,
        rawPaths: [rawPath],
        dryRun: true,
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.projectPaths).toContain("wiki/projects/pricing.md");
      expect(result.indexed[0]?.projectPaths).not.toContain("wiki/projects/pricing-strategy.md");
      expect(result.indexed[0]?.decisionPaths).toEqual([]);
      expect(result.indexed[0]?.actionCount).toBe(0);
    });
  });

  test("extracts only explicit meeting decisions and actions", async () => {
    await withTempRepo(async (repoRoot) => {
      const rawPath = path.join(repoRoot, "wiki/raw/granola/2026-05-10-connector-sync.md");
      await writeFile(rawPath, rawGranolaExplicitDecisionActionSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "granola",
        rawPaths: [rawPath],
        now: new Date("2026-05-10T12:00:00.000Z"),
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.decisionPaths).toHaveLength(1);
      expect(result.indexed[0]?.actionCount).toBe(1);

      const decision = await readFile(
        path.join(repoRoot, result.indexed[0]?.decisionPaths[0] ?? ""),
        "utf8",
      );
      expect(decision).toContain(
        "We will keep Granola polling behind the shared connector workflow.",
      );

      const mine = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(mine).toContain("Sam will draft the connector runbook.");
      expect(mine).not.toContain("We should revisit queue retries later.");
      expect(mine).toContain("strata:action-context");
      expect(mine).toContain("extractionRunId");
      expect(mine).toContain("extractionCandidateId");
      expect(result.indexed[0]?.extractionRunIds).toHaveLength(1);
      expect(result.indexed[0]?.actionCandidateIds).toHaveLength(1);

      const candidates = await listExtractionCandidates({
        repoRoot,
        name: "daily.todo",
        day: "2026-05-10",
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.verification.owner).toBe("mine");
      expect(candidates[0]?.publishedTarget).toContain("wiki/actions/mine.md");

      const index = await readFile(path.join(repoRoot, "wiki/index.md"), "utf8");
      expect(index).toContain("We will keep Granola polling behind the shared connector workflow");
      expect(index).not.toContain("We should revisit queue retries later");
    });
  });

  test("routes raw-to-wiki action-like tool output through daily.todo rejection", async () => {
    await withTempRepo(async (repoRoot) => {
      const rawPath = path.join(repoRoot, "wiki/raw/granola/2026-05-12-tool-output.md");
      await writeFile(rawPath, rawGranolaToolOutputActionSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "granola",
        rawPaths: [rawPath],
        now: new Date("2026-05-12T12:00:00.000Z"),
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.decisionPaths).toHaveLength(1);
      expect(result.indexed[0]?.actionCount).toBe(0);
      expect(result.indexed[0]?.extractionRunIds).toHaveLength(1);
      expect(result.indexed[0]?.actionCandidateIds).toHaveLength(1);

      await expect(access(path.join(repoRoot, "wiki/actions/mine.md"))).rejects.toThrow();
      await expect(access(path.join(repoRoot, "wiki/actions/theirs.md"))).rejects.toThrow();

      const candidates = await listExtractionCandidates({
        repoRoot,
        name: "daily.todo",
        day: "2026-05-12",
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.status).toBe("rejected");
      expect(candidates[0]?.deterministicReasons).toContain("tool_search_count_output");
      expect(candidates[0]?.publishedTarget).toBeNull();

      const trace = await readFile(
        path.join(repoRoot, ".strata/traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("extraction.daily_todo.candidate");
      expect(trace).toContain("raw_to_wiki.index.item");
      expect(trace).toContain("actionCandidateIds");
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
      expect(actions).toContain("Sam will draft the launch checklist.");
      expect(actions).toContain("extractionCandidateId");
      expect(result.indexed[0]?.actionCandidateIds).toHaveLength(1);
    });
  });

  test("indexes raw Slack threads into source pages without root thread fanout", async () => {
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
      expect(result.indexed[0]?.primaryKind).toBe("source");
      expect(result.indexed[0]?.primaryPath).toBe(
        "wiki/sources/slack/c123/2026-05-08-1778304572568589-can-we-enable-self-serve-pricing.md",
      );
      expect(result.indexed[0]?.projectPaths).toContain("wiki/projects/self-serve.md");
      expect(result.indexed[0]?.projectPaths).toContain("wiki/projects/pricing.md");
      expect(result.indexed[0]?.threadPaths).toEqual([]);

      const source = await readFile(
        path.join(
          repoRoot,
          "wiki/sources/slack/c123/2026-05-08-1778304572568589-can-we-enable-self-serve-pricing.md",
        ),
        "utf8",
      );
      expect(source).toContain("type: slack_source");
      expect(source).toContain("Raw source:");
      expect(source).toContain("Can we enable self serve pricing?");

      const index = await readFile(path.join(repoRoot, "wiki/index.md"), "utf8");
      expect(index).toContain("[[projects/self-serve|Self Serve]]");
      expect(index).not.toContain("[[sources/slack/c123/");
    });
  });

  test("attributes Slack first-person commitments to the message speaker", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      const rawPath = path.join(repoRoot, "wiki/raw/slack/2026-05-11-billing-rollout.md");
      await writeFile(rawPath, rawSlackDecisionActionSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "slack",
        rawPaths: [rawPath],
        now: new Date("2026-05-11T12:00:00.000Z"),
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.decisionPaths).toHaveLength(1);
      expect(result.indexed[0]?.actionCount).toBe(1);

      const decision = await readFile(
        path.join(repoRoot, result.indexed[0]?.decisionPaths[0] ?? ""),
        "utf8",
      );
      expect(decision).toContain("We approved the self serve pricing rollout.");

      const theirs = await readFile(path.join(repoRoot, "wiki/actions/theirs.md"), "utf8");
      expect(theirs).toContain("Ada Lovelace will update the billing copy by Friday.");
      expect(theirs).not.toContain("Should we revisit coupons next quarter?");
      expect(theirs).toContain("extractionCandidateId");
      expect(result.indexed[0]?.actionCandidateIds).toHaveLength(1);

      const candidates = await listExtractionCandidates({
        repoRoot,
        name: "daily.todo",
        day: "2026-05-11",
      });
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        sourceType: "slack",
        status: "confirmed",
      });
      expect(candidates[0]?.metadata.evidenceMetadata).toMatchObject({
        sourceTarget:
          "wiki/sources/slack/c789/2026-05-11-1778561000123456-billing-rollout-decision.md",
      });
    });
  });

  test("maps Slack project candidates to canonical topic pages", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      const rawPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-tracker-cloud.md");
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
        "wiki/projects/atlas-portal.md",
        "wiki/projects/error-tracker.md",
        "wiki/projects/cloud-runner.md",
      ]);
      expect(result.indexed[0]?.classificationReasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "project_alias",
            source: "taxonomy",
            label: "Atlas Portal",
          }),
          expect.objectContaining({
            kind: "slack_material_signal",
          }),
        ]),
      );
      expect(result.indexed[0]?.projectPaths).not.toContain(
        "wiki/projects/can-you-triage-tracker-errors-for-atlas-portal-on-cloud-runner.md",
      );
    });
  });

  test("does not use workspace aliases without a local ingest taxonomy", async () => {
    await withTempRepo(
      async (repoRoot) => {
        await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
        const rawPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-tracker-cloud.md");
        await writeFile(rawPath, rawSlackCanonicalProjectSnapshot(), "utf8");

        const result = await runRawToWikiIndex({
          repoRoot,
          source: "slack",
          rawPaths: [rawPath],
          dryRun: true,
        });

        expect(result.scanned).toBe(1);
        expect(result.indexed).toHaveLength(1);
        expect(result.indexed[0]?.projectPaths).toEqual([]);
      },
      { writeTaxonomy: false },
    );
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
      const supportCheckPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-support-check.md");
      const acknowledgementPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-acknowledgement.md",
      );
      const coordinationQuestionPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-coordination-question.md",
      );
      const testingCoordinationPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-testing-coordination.md",
      );
      const testingHandoffPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-testing-handoff.md",
      );
      const incompleteUserListPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-incomplete-user-list.md",
      );
      const signupClarificationPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-signup-clarification.md",
      );
      const accountAdminStatusPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-account-admin-status.md",
      );
      const loginHelpArticlePath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-login-help-article.md",
      );
      const setupStatusPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-setup-status.md");
      const techStackClarificationPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-tech-stack-clarification.md",
      );
      const backendBitPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-backend-bit.md");
      const cacheHelpPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-cache-help.md");
      const productionTestingPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-production-testing.md",
      );
      const callSchedulingPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-call-scheduling.md",
      );
      const calendarUpdatePath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-calendar-update.md",
      );
      const forwardConfirmationsPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-forward-confirmations.md",
      );
      const flagStatusPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-flag-status.md");
      const quickDataQuestionsPath = path.join(
        repoRoot,
        "wiki/raw/slack/2026-05-09-quick-data-questions.md",
      );
      await writeFile(logPath, rawSlackWorkerLogSnapshot(), "utf8");
      await writeFile(emptyPath, rawSlackEmptySnapshot(), "utf8");
      await writeFile(bellPath, rawSlackBellSnapshot(), "utf8");
      await writeFile(deployPath, rawSlackDeploySnapshot(), "utf8");
      await writeFile(linkPath, rawSlackLinkOnlySnapshot(), "utf8");
      await writeFile(smallTalkPath, rawSlackSmallTalkSnapshot(), "utf8");
      await writeFile(supportCheckPath, rawSlackSupportCheckSnapshot(), "utf8");
      await writeFile(acknowledgementPath, rawSlackAcknowledgementSnapshot(), "utf8");
      await writeFile(coordinationQuestionPath, rawSlackCoordinationQuestionSnapshot(), "utf8");
      await writeFile(testingCoordinationPath, rawSlackTestingCoordinationSnapshot(), "utf8");
      await writeFile(testingHandoffPath, rawSlackTestingHandoffSnapshot(), "utf8");
      await writeFile(incompleteUserListPath, rawSlackIncompleteUserListSnapshot(), "utf8");
      await writeFile(signupClarificationPath, rawSlackSignupClarificationSnapshot(), "utf8");
      await writeFile(accountAdminStatusPath, rawSlackAccountAdminStatusSnapshot(), "utf8");
      await writeFile(loginHelpArticlePath, rawSlackLoginHelpArticleSnapshot(), "utf8");
      await writeFile(setupStatusPath, rawSlackSetupStatusSnapshot(), "utf8");
      await writeFile(techStackClarificationPath, rawSlackTechStackClarificationSnapshot(), "utf8");
      await writeFile(backendBitPath, rawSlackBackendBitSnapshot(), "utf8");
      await writeFile(cacheHelpPath, rawSlackCacheHelpSnapshot(), "utf8");
      await writeFile(productionTestingPath, rawSlackProductionTestingSnapshot(), "utf8");
      await writeFile(callSchedulingPath, rawSlackCallSchedulingSnapshot(), "utf8");
      await writeFile(calendarUpdatePath, rawSlackCalendarUpdateSnapshot(), "utf8");
      await writeFile(forwardConfirmationsPath, rawSlackForwardConfirmationsSnapshot(), "utf8");
      await writeFile(flagStatusPath, rawSlackFlagStatusSnapshot(), "utf8");
      await writeFile(quickDataQuestionsPath, rawSlackQuickDataQuestionsSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "slack",
        rawPaths: [
          logPath,
          emptyPath,
          bellPath,
          deployPath,
          linkPath,
          smallTalkPath,
          supportCheckPath,
          acknowledgementPath,
          coordinationQuestionPath,
          testingCoordinationPath,
          testingHandoffPath,
          incompleteUserListPath,
          signupClarificationPath,
          accountAdminStatusPath,
          loginHelpArticlePath,
          setupStatusPath,
          techStackClarificationPath,
          backendBitPath,
          cacheHelpPath,
          productionTestingPath,
          callSchedulingPath,
          calendarUpdatePath,
          forwardConfirmationsPath,
          flagStatusPath,
          quickDataQuestionsPath,
        ],
        dryRun: true,
      });

      expect(result.scanned).toBe(25);
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
      expect(result.skipped.map((item) => item.reason)).toContain(
        "Slack thread is a transient support/status check.",
      );
      expect(result.skipped.map((item) => item.reason)).toContain(
        "Slack thread is a routine coordination check.",
      );

      const trace = await readFile(
        path.join(repoRoot, ".strata/traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("raw_to_wiki.index.skipped");
      expect(trace).toContain("Slack thread appears to be an automation/log notification.");
    });
  });

  test("does not promote Slack first-person actions from user-id speakers", async () => {
    await withTempRepo(async (repoRoot) => {
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      const rawPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-user-id-action.md");
      await writeFile(rawPath, rawSlackUserIdMaterialFirstPersonActionSnapshot(), "utf8");

      const result = await runRawToWikiIndex({
        repoRoot,
        source: "slack",
        rawPaths: [rawPath],
        dryRun: true,
      });

      expect(result.scanned).toBe(1);
      expect(result.indexed).toHaveLength(1);
      expect(result.indexed[0]?.actionCount).toBe(0);
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

function rawGranolaPricingSnapshot(): string {
  return `${frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date: "2026-05-08",
    title: "Weekly Team Meeting",
    attendees: ["Ada Lovelace", "Grace Hopper"],
    pulled_at: "2026-05-08T10:00:00.000Z",
  })}
# Weekly Team Meeting

## Summary

### Pricing Strategy

- We need to decide how pricing supports self serve launch.

## Transcript

Ada Lovelace: We need to decide how pricing supports self serve launch.
`;
}

function rawGranolaExplicitDecisionActionSnapshot(): string {
  return `${frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date: "2026-05-10",
    title: "Connector Reliability Sync",
    attendees: ["Sam Rivera", "Ada Lovelace"],
    projects: ["Connector Reliability"],
    pulled_at: "2026-05-10T12:00:00.000Z",
  })}
# Connector Reliability Sync

## Summary

### Connector Reliability

- Decision: We will keep Granola polling behind the shared connector workflow.
- Sam will draft the connector runbook.
- We should revisit queue retries later.
- Open question: should we expose retry tuning in the web UI?

## Transcript

Sam Rivera: Decision: We will keep Granola polling behind the shared connector workflow.
Ada Lovelace: Sam will draft the connector runbook.
`;
}

function rawGranolaToolOutputActionSnapshot(): string {
  return `${frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date: "2026-05-12",
    title: "Connector Tool Output Sync",
    attendees: ["Sam Rivera", "Ada Lovelace"],
    projects: ["Connector Reliability"],
    pulled_at: "2026-05-12T12:00:00.000Z",
  })}
# Connector Tool Output Sync

## Summary

### Connector Reliability

- Decision: We will keep connector retry reporting observable.
- [ ] search: 999. Action item: Investigate ROOMOTE-WORKER-28Y first.

## Transcript

Ada Lovelace: Decision: We will keep connector retry reporting observable.
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
Sam will draft the launch checklist.
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

## 1778304572.568589 | Sam Rivera

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
    title: "Can you triage tracker errors for Atlas Portal on Cloud Runner?",
    source_url: "https://example.slack.com/archives/C456/p1778399999123456",
    message_count: 2,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Can you triage tracker errors for Atlas Portal on Cloud Runner?

## 1778399999.123456 | Sam Rivera

Can you triage the tracker errors for Atlas Portal on Cloud Runner?

## 1778400000.000000 | Ada Lovelace

I will check whether Cloud Runner is causing the Atlas Portal error spike.
`;
}

function rawSlackDecisionActionSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-11",
    channel: "C789",
    thread_ts: "1778561000.123456",
    latest_ts: "1778561060.123456",
    title: "Billing rollout decision",
    source_url: "https://example.slack.com/archives/C789/p1778561000123456",
    message_count: 3,
    pulled_at: "2026-05-11T12:00:00.000Z",
  })}
# Billing rollout decision

## 1778561000.123456 | Ada Lovelace

I will update the billing copy by Friday.

## 1778561030.123456 | Sam Rivera

Decision: We approved the self serve pricing rollout.

## 1778561060.123456 | Sam Rivera

Should we revisit coupons next quarter?
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
    title: "[automation-worker] [runtime:stderr] ERROR",
    message_count: 1,
    pulled_at: "2026-05-09T08:17:16.343Z",
  })}
# [automation-worker] [runtime:stderr] ERROR

## 1778314634.215679 | U090NHYC4JX

[automation-worker] [runtime:stderr] ERROR Unhandled error during turn: Quota exceeded.
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
    title: ":bell: Monitor alert <https://monitoring.example.com/question/1420|Alert>",
    message_count: 1,
    pulled_at: "2026-05-09T05:00:12.638Z",
  })}
# :bell: Monitor alert <https://monitoring.example.com/question/1420|Alert>

## 1778302810.999859 | Metabot

:bell: Monitor alert <https://monitoring.example.com/question/1420|Monitor alert> Monitor alert
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
    title: "*Deploy-ECS-Image worker-node* (prod): starting...",
    message_count: 1,
    pulled_at: "2026-05-09T15:44:02.274Z",
  })}
# *Deploy-ECS-Image worker-node* (prod): starting...

## 1778341440.184029 | U04JF0W5W1K

*Deploy-ECS-Image worker-node* (prod): starting...
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

function rawSlackSupportCheckSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417197.778269",
    latest_ts: "1779417197.778269",
    title: "All working for you now?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# All working for you now?

## 1779417197.778269 | UCVFDK4VB

All working for you now?
`;
}

function rawSlackAcknowledgementSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417198.778269",
    latest_ts: "1779417198.778269",
    title: "Ok will have a look",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Ok will have a look

## 1779417198.778269 | UD03N4P0W

Ok will have a look
`;
}

function rawSlackCoordinationQuestionSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417199.778269",
    latest_ts: "1779417199.778269",
    title: "Hey Shawna - how do I make comments within Invision again?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Hey Shawna - how do I make comments within Invision again?

## 1779417199.778269 | UD03N4P0W

Hey Shawna - how do I make comments within Invision again?
`;
}

function rawSlackTestingCoordinationSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417200.778269",
    latest_ts: "1779417200.778269",
    title: "Also- I’m going to do another round of testing, including mobile, today",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Also- I’m going to do another round of testing, including mobile, today

## 1779417200.778269 | UD03N4P0W

Also- I’m going to do another round of testing, including mobile, today, did they implement the features already or should I wait a couple of hours or so?
`;
}

function rawSlackTestingHandoffSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417203.778269",
    latest_ts: "1779417203.778269",
    title: "Hi Lisa, I’m going to be testing all the updates today",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Hi Lisa, I’m going to be testing all the updates today

## 1779417203.778269 | UEESBDTUZ

Hi Lisa, I’m going to be testing all the updates today that were pushed to dev this morning. Would it be ok if I forwarded all the known issues from my testing to you before looked through the site?
`;
}

function rawSlackIncompleteUserListSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417201.778269",
    latest_ts: "1779417201.778269",
    title: "<@UD03N4P0W> could you add the following users to it:",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# <@UD03N4P0W> could you add the following users to it:

## 1779417201.778269 | UCVFDK4VB

<@UD03N4P0W> could you add the following users to it:
`;
}

function rawSlackSignupClarificationSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417204.778269",
    latest_ts: "1779417204.778269",
    title: "I’ll get that done, is it just a general sign up?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# I’ll get that done, is it just a general sign up?

## 1779417204.778269 | UD03N4P0W

I’ll get that done, is it just a general sign up starting on the main page for JIRA and Google Analytics, or are there specific links I need to go to to sign up?
`;
}

function rawSlackAccountAdminStatusSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417205.778269",
    latest_ts: "1779417205.778269",
    title: "I just added you guys, am also trying to figure out how to make you admin",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# I just added you guys, am also trying to figure out how to make you admin

## 1779417205.778269 | UD03N4P0W

I just added you guys, am also trying to figure out how to make you admin
`;
}

function rawSlackLoginHelpArticleSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417206.778269",
    latest_ts: "1779417206.778269",
    title: "Awesome, was able to login to the workspace",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Awesome, was able to login to the workspace

## 1779417206.778269 | UCV4LVBMJ

Awesome, was able to login to the workspace, found this article in one of the help sections, maybe this will help? <https://confluence.atlassian.com/adminjiracloud/managing-global-permissions-776636359.html>
`;
}

function rawSlackSetupStatusSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417207.778269",
    latest_ts: "1779417207.778269",
    title: "Ok I need to first set it up on my email, then I'll add users",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Ok I need to first set it up on my email, then I'll add users

## 1779417207.778269 | UD03N4P0W

Ok I need to first set it up on my email (Michael has to set up dev@example.test), then I'll add users
`;
}

function rawSlackTechStackClarificationSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417208.778269",
    latest_ts: "1779417208.778269",
    title: "QQ - React.js, Redux, JavaScript, NodeJS",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# QQ - React.js, Redux, JavaScript, NodeJS

## 1779417208.778269 | UD03N4P0W

<@UCVFDK4VB> QQ - when you list out React.js, Redux, JavaScript, NodeJS - that is for the backend right?
`;
}

function rawSlackBackendBitSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417209.778269",
    latest_ts: "1779417209.778269",
    title: "what would be the backend bit?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# what would be the backend bit?

## 1779417209.778269 | UD03N4P0W

what would be the backend bit?
`;
}

function rawSlackCacheHelpSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417210.778269",
    latest_ts: "1779417210.778269",
    title: "How do I clean my cache?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# How do I clean my cache?

## 1779417210.778269 | UD03N4P0W

How do I clean my cache?
`;
}

function rawSlackProductionTestingSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417211.778269",
    latest_ts: "1779417211.778269",
    title: "Ok, so things have been pushed to production and I’ll test in production right?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Ok, so things have been pushed to production and I’ll test in production right?

## 1779417211.778269 | UD03N4P0W

Ok, so things have been pushed to production and I’ll test in production right?
`;
}

function rawSlackCallSchedulingSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417212.778269",
    latest_ts: "1779417212.778269",
    title: "Also - can we move out our call to around 5:30pm ET?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Also - can we move out our call to around 5:30pm ET?

## 1779417212.778269 | UD03N4P0W

Also - can we move out our call to around 5:30pm ET? Will test first then we can regroup
`;
}

function rawSlackCalendarUpdateSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417213.778269",
    latest_ts: "1779417213.778269",
    title: "Sure thing, will update the cal invite for 5:30ET",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Sure thing, will update the cal invite for 5:30ET

## 1779417213.778269 | UEESBDTUZ

Sure thing, will update the cal invite for 5:30ET
`;
}

function rawSlackForwardConfirmationsSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417214.778269",
    latest_ts: "1779417214.778269",
    title: "I’ll make sure to forward any confirmation emails for your review.",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# I’ll make sure to forward any confirmation emails for your review.

## 1779417214.778269 | UEESBDTUZ

I’ll make sure to forward any confirmation emails for your review.
`;
}

function rawSlackFlagStatusSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417215.778269",
    latest_ts: "1779417215.778269",
    title: "Will flag that, please let me know if anything from before pops up again",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Will flag that, please let me know if anything from before pops up again

## 1779417215.778269 | UEESBDTUZ

Will flag that, please let me know if anything from before pops up again, will ask dev team about it
`;
}

function rawSlackQuickDataQuestionsSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417216.778269",
    latest_ts: "1779417216.778269",
    title: "Ok. Can Swapnil or someone look at my data questions?",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Ok. Can Swapnil or someone look at my data questions?

## 1779417216.778269 | UD03N4P0W

Ok. Can Swapnil or someone look at my data questions? Should be quick verifications
`;
}

function rawSlackUserIdMaterialFirstPersonActionSnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "CD9NUN7UJ",
    thread_ts: "1779417202.778269",
    latest_ts: "1779417202.778269",
    title: "I need to investigate the release bug before launch",
    message_count: 1,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# I need to investigate the release bug before launch

## 1779417202.778269 | UD03N4P0W

I need to investigate the release bug before launch.
`;
}
