import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listWikiActions } from "@strata/core";
import { frontmatter } from "../common.js";
import {
  createModelDailyTodoVerifier,
  DAILY_TODO_EXTRACTION,
  deterministicTodoCandidates,
  evidenceSpansForDocuments,
  fakeDailyTodoVerifier,
  findCompletedExtractionRun,
  listExtractionCandidates,
  MODEL_TODO_VERIFIER_PROMPT_VERSION,
  resolveDailyTodoCorpus,
  runDailyTodoExtractionApply,
  runDailyTodoExtractionBackfillApply,
  runDailyTodoExtractionBackfillDryRun,
  runDailyTodoExtractionDryRun,
  type TodoVerifierModelRequest,
} from "./index.js";

async function withTempRepo<T>(fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-extraction-"));
  try {
    await writeFile(path.join(repoRoot, "package.json"), "{}\n", "utf8");
    await writeFile(path.join(repoRoot, "CLAUDE.md"), "# test\n", "utf8");
    await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki/raw/granola"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki/raw/notion"), { recursive: true });
    await mkdir(path.join(repoRoot, "wiki/meetings"), { recursive: true });
    return await fn(repoRoot);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("daily.todo extraction", () => {
  test("resolves a day-scoped corpus and segments Slack messages", async () => {
    await withTempRepo(async (repoRoot) => {
      const todayPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md");
      const tomorrowPath = path.join(repoRoot, "wiki/raw/slack/2026-05-10-launch.md");
      await writeFile(todayPath, rawSlackSnapshot("2026-05-09", "Launch thread"), "utf8");
      await writeFile(tomorrowPath, rawSlackSnapshot("2026-05-10", "Tomorrow thread"), "utf8");

      const documents = await resolveDailyTodoCorpus({ repoRoot, day: "2026-05-09" });
      expect(documents.map((document) => document.path)).toEqual([
        path.join("wiki", "raw", "slack", "2026-05-09-launch.md"),
      ]);

      const spans = evidenceSpansForDocuments(documents);
      expect(spans).toHaveLength(2);
      expect(spans[0]).toMatchObject({
        sourceType: "slack",
        text: "Can you prepare the launch checklist?",
      });
      expect(spans[0]?.lineStart).toBeGreaterThan(1);
      expect(spans[1]?.metadata).toMatchObject({
        speaker: "Ada Lovelace",
        speakerKind: "person",
      });
    });
  });

  test("finds direct asks, human Slack commitments, and checkbox TODOs", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md");
      const notionPath = path.join(repoRoot, "wiki/raw/notion/2026-05-09-launch.md");
      await writeFile(slackPath, rawSlackSnapshot("2026-05-09", "Launch thread"), "utf8");
      await writeFile(notionPath, rawNotionSnapshot(), "utf8");

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
      });

      expect(result.sourcesScanned).toBe(2);
      expect(result.countsBySource.slack.documents).toBe(1);
      expect(result.countsBySource.notion.documents).toBe(1);
      expect(result.candidates.map((item) => item.candidate.candidateText)).toEqual(
        expect.arrayContaining([
          "Can you prepare the launch checklist?",
          "Ada Lovelace will update the billing copy by Friday.",
          "Follow up with finance on launch readiness.",
          "Sam Rivera will send launch notes.",
        ]),
      );
      expect(result.rejected).toHaveLength(0);
    });
  });

  test("rejects action-shaped agent summaries and search-count output", async () => {
    await withTempRepo(async (repoRoot) => {
      const summaryPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-agent-summary.md");
      await writeFile(summaryPath, rawAgentSummarySnapshot(), "utf8");

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
      });

      expect(result.candidates).toHaveLength(0);
      expect(result.rejected.map((item) => item.reasons)).toEqual(
        expect.arrayContaining([
          expect.arrayContaining(["tool_search_count_output"]),
          expect.arrayContaining(["agent_or_status_report"]),
        ]),
      );
    });
  });

  test("deduplicates repeated Slack snapshots of the same source message", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch-first.md"),
        rawSingleMessageSlackSnapshot(
          "2026-05-09",
          "Launch checklist",
          "Can you prepare the launch checklist?",
        ),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch-second.md"),
        rawSingleMessageSlackSnapshot(
          "2026-05-09",
          "Launch checklist",
          "Can you prepare the launch checklist?",
        ),
        "utf8",
      );

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
      });

      expect(result.candidates.map((item) => item.candidate.candidateText)).toEqual([
        "Can you prepare the launch checklist?",
      ]);
    });
  });

  test("deduplicates raw and curated copies of the same source document", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki/raw/granola/2026-05-09-sync.md"),
        rawGranolaMeetingSnapshot(),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/meetings/2026-05-09-sync.md"),
        curatedMeetingSnapshot(),
        "utf8",
      );

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
      });

      expect(result.sourcesScanned).toBe(2);
      expect(result.candidates.map((item) => item.candidate.candidateText)).toEqual([
        "Deploy Wednesday, shut down Friday.",
      ]);
    });
  });

  test("rejects terse acknowledgements, preference questions, and service-ticket payloads", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-noise.md"),
        rawSlackMessagesSnapshot("2026-05-09", "Noisy thread", [
          { speaker: "Sam Rivera", text: "please do" },
          { speaker: "Sam Rivera", text: "<@U0ANX2RMDRQ> please do" },
          {
            speaker: "Sam Rivera",
            text: "Please do, I have a task running to solve the merge conflicts.",
          },
          {
            speaker: "Sam Rivera",
            text: "Would you be comfortable with a user level setting for this Bruno?",
          },
          {
            speaker: "Logsharp",
            text: "New support ticket: Issue #67 - Rescheduling request. Requester: Zoran Perokovic Assignee: Bruno Bergher Status: New",
          },
          { speaker: "Sam Rivera", text: "I don't think we need to clear them out" },
          { speaker: "Sam Rivera", text: "The villain needs to be sharper." },
        ]),
        "utf8",
      );

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
      });

      expect(result.candidates).toHaveLength(0);
      expect(result.rejected.map((item) => item.verification.rationale)).toEqual(
        expect.arrayContaining([
          "elliptical_direct_request",
          "preference_question",
          "service_ticket_notification",
        ]),
      );
      expect(result.results.map((item) => item.candidate.candidateText)).not.toContain(
        "I don't think we need to clear them out",
      );
      expect(result.results.map((item) => item.candidate.candidateText)).not.toContain(
        "The villain needs to be sharper.",
      );
    });
  });

  test("keeps candidate hashes stable across repeated dry runs and writes trace events", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md");
      await writeFile(slackPath, rawSlackSnapshot("2026-05-09", "Launch thread"), "utf8");

      const first = await runDailyTodoExtractionDryRun({ repoRoot, day: "2026-05-09" });
      const storedFirst = await listExtractionCandidates({
        repoRoot,
        name: first.extractionName,
        day: first.day,
      });
      const second = await runDailyTodoExtractionDryRun({ repoRoot, day: "2026-05-09" });
      const storedSecond = await listExtractionCandidates({
        repoRoot,
        name: second.extractionName,
        day: second.day,
      });
      const completed = await findCompletedExtractionRun({
        repoRoot,
        name: DAILY_TODO_EXTRACTION.name,
        day: "2026-05-09",
        extractorVersion: DAILY_TODO_EXTRACTION.extractorVersion,
        verifierVersion: fakeDailyTodoVerifier.version,
      });

      expect(second.candidates.map((item) => item.candidate.candidateHash)).toEqual(
        first.candidates.map((item) => item.candidate.candidateHash),
      );
      expect(storedFirst.map((item) => item.candidateHash)).toEqual(
        first.results.map((item) => item.candidate.candidateHash),
      );
      expect(storedSecond.map((item) => item.id)).toEqual(storedFirst.map((item) => item.id));
      expect(new Set(storedSecond.map((item) => item.runId))).toEqual(
        new Set([second.extractionRunId]),
      );
      expect(completed?.status).toBe("completed");
      expect(completed?.candidateCount).toBe(second.candidateCount);

      const trace = await readFile(
        path.join(repoRoot, ".strata/traces", `${first.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("extraction.daily_todo.started");
      expect(trace).toContain("extraction.daily_todo.candidate");
      expect(trace).toContain("extraction.daily_todo.completed");
    });
  });

  test("backfills day-by-day and skips already completed dry runs", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md"),
        rawSlackSnapshot("2026-05-09", "Launch thread"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-10-retro.md"),
        rawSlackSnapshot("2026-05-10", "Retro thread"),
        "utf8",
      );

      const first = await runDailyTodoExtractionBackfillDryRun({
        repoRoot,
        from: "2026-05-09",
        to: "2026-05-10",
      });
      const second = await runDailyTodoExtractionBackfillDryRun({
        repoRoot,
        from: "2026-05-09",
        to: "2026-05-10",
      });
      const forced = await runDailyTodoExtractionBackfillDryRun({
        repoRoot,
        from: "2026-05-09",
        to: "2026-05-10",
        force: true,
      });
      const stored = await listExtractionCandidates({
        repoRoot,
        name: DAILY_TODO_EXTRACTION.name,
      });

      expect(first.processed).toBe(2);
      expect(first.skipped).toBe(0);
      expect(second.processed).toBe(0);
      expect(second.skipped).toBe(2);
      expect(forced.processed).toBe(2);
      expect(forced.skipped).toBe(0);
      expect(new Set(stored.map((item) => item.day))).toEqual(
        new Set(["2026-05-09", "2026-05-10"]),
      );
      expect(stored).toHaveLength(4);
    });
  });

  test("applies backfills day-by-day and skips completed apply runs only", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md"),
        rawSlackSnapshot("2026-05-09", "Launch thread"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-10-retro.md"),
        rawSlackSnapshot("2026-05-10", "Retro thread"),
        "utf8",
      );

      await runDailyTodoExtractionBackfillDryRun({
        repoRoot,
        from: "2026-05-09",
        to: "2026-05-10",
      });
      const firstApply = await runDailyTodoExtractionBackfillApply({
        repoRoot,
        from: "2026-05-09",
        to: "2026-05-10",
      });
      const repeatedApply = await runDailyTodoExtractionBackfillApply({
        repoRoot,
        from: "2026-05-09",
        to: "2026-05-10",
      });
      const actions = await listWikiActions(repoRoot, { owner: "all", status: "all" });

      expect(firstApply.dryRun).toBe(false);
      expect(firstApply.processed).toBe(2);
      expect(firstApply.skipped).toBe(0);
      expect(firstApply.publishedCount).toBe(2);
      expect(repeatedApply.processed).toBe(0);
      expect(repeatedApply.skipped).toBe(2);
      expect(actions.map((item) => item.title)).toEqual([
        "Ada Lovelace will update the billing copy by Friday.",
        "Ada Lovelace will update the billing copy by Friday.",
      ]);
    });
  });

  test("verifies candidates with a schema-checked model response and stores model metadata", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md");
      await writeFile(slackPath, rawSlackSnapshot("2026-05-09", "Launch thread"), "utf8");
      const model = new StubTodoVerifierModel([
        JSON.stringify({
          classification: "action",
          confidence: 0.86,
          owner: "mine",
          actionText: "Prepare the launch checklist.",
          dueDate: null,
          rationale: "A human made a direct concrete request.",
        }),
        JSON.stringify({
          classification: "action",
          confidence: 0.81,
          owner: "theirs",
          actionText: "Ada Lovelace will update the billing copy by Friday.",
          dueDate: "Friday",
          rationale: "A human-readable Slack speaker made a concrete commitment.",
        }),
      ]);
      const verifier = createModelDailyTodoVerifier({ model });

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
        verifier,
      });
      const completed = await findCompletedExtractionRun({
        repoRoot,
        name: DAILY_TODO_EXTRACTION.name,
        day: "2026-05-09",
        extractorVersion: DAILY_TODO_EXTRACTION.extractorVersion,
        verifierVersion: MODEL_TODO_VERIFIER_PROMPT_VERSION,
        modelName: model.name,
      });
      const deterministicCompleted = await findCompletedExtractionRun({
        repoRoot,
        name: DAILY_TODO_EXTRACTION.name,
        day: "2026-05-09",
        extractorVersion: DAILY_TODO_EXTRACTION.extractorVersion,
        verifierVersion: MODEL_TODO_VERIFIER_PROMPT_VERSION,
      });

      expect(result.verifierVersion).toBe(MODEL_TODO_VERIFIER_PROMPT_VERSION);
      expect(result.modelName).toBe(model.name);
      expect(result.candidates.map((item) => item.status)).toEqual(["confirmed", "confirmed"]);
      expect(result.candidates[0]?.verification.actionText).toBe("Prepare the launch checklist.");
      expect(model.requests).toHaveLength(2);
      expect(model.requests[0]?.messages[0]?.content).toContain("Search-count output");
      expect(model.requests[0]?.messages[1]?.content).toContain("Can you prepare");
      expect(completed?.modelName).toBe(model.name);
      expect(completed?.candidateCount).toBe(2);
      expect(deterministicCompleted).toBeNull();
    });
  });

  test("applies high-confidence owned candidates to wiki action ledgers with source metadata", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md");
      await writeFile(slackPath, rawSlackSnapshot("2026-05-09", "Launch thread"), "utf8");

      const first = await runDailyTodoExtractionApply({
        repoRoot,
        day: "2026-05-09",
        verifier: createModelDailyTodoVerifier({
          model: new StubTodoVerifierModel([
            verificationJson({
              owner: "mine",
              actionText: "Prepare the launch checklist.",
            }),
            verificationJson({
              owner: "theirs",
              actionText: "Ada Lovelace will update the billing copy by Friday.",
            }),
          ]),
        }),
        now: new Date("2026-05-09T12:00:00.000Z"),
      });
      const second = await runDailyTodoExtractionApply({
        repoRoot,
        day: "2026-05-09",
        verifier: createModelDailyTodoVerifier({
          model: new StubTodoVerifierModel([
            verificationJson({
              owner: "mine",
              actionText: "Prepare the launch checklist.",
            }),
            verificationJson({
              owner: "theirs",
              actionText: "Ada Lovelace will update the billing copy by Friday.",
            }),
          ]),
        }),
        now: new Date("2026-05-09T13:00:00.000Z"),
      });

      expect(first.dryRun).toBe(false);
      expect(first.publishedCount).toBe(2);
      expect(second.publishedCount).toBe(0);
      expect(second.skipped.map((item) => item.reason)).toEqual(["duplicate", "duplicate"]);

      const actions = await listWikiActions(repoRoot, { owner: "all", status: "all" });
      expect(actions.map((item) => [item.owner, item.title])).toEqual([
        ["mine", "Prepare the launch checklist."],
        ["theirs", "Ada Lovelace will update the billing copy by Friday."],
      ]);
      expect(actions[0]?.source).toMatchObject({
        target: "raw/slack/2026-05-09-launch",
        label: "Launch thread",
      });

      const mine = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
      expect(mine).toContain('"extractionRunId"');
      expect(mine).toContain('"extractionCandidateId"');
      expect(mine).toContain('"sourcePath":"wiki/raw/slack/2026-05-09-launch.md"');

      const stored = await listExtractionCandidates({
        repoRoot,
        name: DAILY_TODO_EXTRACTION.name,
        day: "2026-05-09",
      });
      expect(stored.every((candidate) => candidate.publishedTarget !== null)).toBe(true);
    });
  });

  test("keeps unknown owner, low-confidence, and rejected candidates out of wiki ledgers", async () => {
    await withTempRepo(async (repoRoot) => {
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-launch.md"),
        rawSlackSnapshot("2026-05-09", "Launch thread"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/2026-05-09-search-output.md"),
        rawSingleMessageSlackSnapshot(
          "2026-05-09",
          "Search output",
          "search: 999. Action item: Investigate ROOMOTE-WORKER-28Y first.",
        ),
        "utf8",
      );

      const result = await runDailyTodoExtractionApply({
        repoRoot,
        day: "2026-05-09",
        verifier: createModelDailyTodoVerifier({
          model: new StubTodoVerifierModel([
            verificationJson({
              owner: "unknown",
              actionText: "Prepare the launch checklist.",
              confidence: 0.95,
            }),
            verificationJson({
              owner: "mine",
              actionText: "Ada Lovelace will update the billing copy by Friday.",
              confidence: 0.72,
            }),
          ]),
        }),
      });

      expect(result.publishedCount).toBe(0);
      expect(result.skipped.map((item) => item.reason)).toEqual(
        expect.arrayContaining(["unknown_owner", "low_confidence", "rejected"]),
      );
      expect(await listWikiActions(repoRoot, { owner: "all", status: "all" })).toEqual([]);
    });
  });

  test("rejects deterministic hard suppressions before model verification", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-search-output.md");
      await writeFile(
        slackPath,
        rawSingleMessageSlackSnapshot(
          "2026-05-09",
          "Search output",
          "search: 999. Action item: Investigate ROOMOTE-WORKER-28Y first.",
        ),
        "utf8",
      );
      const model = new StubTodoVerifierModel([
        JSON.stringify({
          classification: "action",
          confidence: 0.99,
          owner: "mine",
          actionText: "Investigate the search output.",
          dueDate: null,
          rationale: "This response should not be used.",
        }),
      ]);

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
        verifier: createModelDailyTodoVerifier({ model }),
      });

      expect(result.candidates).toHaveLength(0);
      expect(result.rejected[0]?.verification.rationale).toBe("tool_search_count_output");
      expect(model.requests).toHaveLength(0);
    });
  });

  test("degrades invalid model verifier JSON to needs_review", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-single.md");
      await writeFile(
        slackPath,
        rawSingleMessageSlackSnapshot(
          "2026-05-09",
          "Launch checklist",
          "Can you prepare the launch checklist?",
        ),
        "utf8",
      );
      const verifier = createModelDailyTodoVerifier({
        model: new StubTodoVerifierModel(["this is not json"]),
      });

      const result = await runDailyTodoExtractionDryRun({
        repoRoot,
        day: "2026-05-09",
        verifier,
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.status).toBe("needs_review");
      expect(result.candidates[0]?.verification.rationale).toContain("model_verifier_invalid_json");
    });
  });

  test("degrades model verifier failures to needs_review without throwing", async () => {
    await withTempRepo(async (repoRoot) => {
      const slackPath = path.join(repoRoot, "wiki/raw/slack/2026-05-09-single.md");
      await writeFile(
        slackPath,
        rawSingleMessageSlackSnapshot(
          "2026-05-09",
          "Launch checklist",
          "Can you prepare the launch checklist?",
        ),
        "utf8",
      );
      const documents = await resolveDailyTodoCorpus({ repoRoot, day: "2026-05-09" });
      const span = evidenceSpansForDocuments(documents)[0];
      if (span === undefined) {
        throw new Error("expected a test evidence span");
      }
      const candidate = deterministicTodoCandidates(span)[0];
      if (candidate === undefined) {
        throw new Error("expected a test candidate");
      }
      const verifier = createModelDailyTodoVerifier({
        model: new StubTodoVerifierModel([new Error("network down")]),
      });

      const verification = await verifier.verify(candidate, span);

      expect(verification.classification).toBe("needs_review");
      expect(verification.confidence).toBe(0);
      expect(verification.rationale).toContain("model_verifier_error: network down");
    });
  });
});

function rawSlackSnapshot(date: string, title: string): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date,
    channel: "C123",
    thread_ts: "1778304572.568589",
    latest_ts: "1778304580.000000",
    title,
    message_count: 2,
    pulled_at: `${date}T10:00:00.000Z`,
  })}
# ${title}

## 1778304572.568589 | Sam Rivera

Can you prepare the launch checklist?

## 1778304580.000000 | Ada Lovelace

I will update the billing copy by Friday.
`;
}

function rawSingleMessageSlackSnapshot(date: string, title: string, message: string): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date,
    channel: "C123",
    thread_ts: "1778304572.568589",
    latest_ts: "1778304572.568589",
    title,
    message_count: 1,
    pulled_at: `${date}T10:00:00.000Z`,
  })}
# ${title}

## 1778304572.568589 | Sam Rivera

${message}
`;
}

function rawSlackMessagesSnapshot(
  date: string,
  title: string,
  messages: { speaker: string; text: string }[],
): string {
  const body = messages
    .map(
      (message, index) => `## 177830457${index}.568589 | ${message.speaker}

${message.text}`,
    )
    .join("\n\n");
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date,
    channel: "C123",
    thread_ts: "1778304572.568589",
    latest_ts: "1778304580.000000",
    title,
    message_count: messages.length,
    pulled_at: `${date}T10:00:00.000Z`,
  })}
# ${title}

${body}
`;
}

function rawNotionSnapshot(): string {
  return `${frontmatter({
    type: "raw_notion_page",
    source: "notion",
    date: "2026-05-09",
    title: "Launch checklist",
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Launch checklist

## Actions

- [ ] Follow up with finance on launch readiness.
- Action item: Sam Rivera will send launch notes.
`;
}

function rawGranolaMeetingSnapshot(): string {
  return `${frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date: "2026-05-09",
    title: "Sync",
    source_url: "https://notes.granola.ai/d/test",
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Sync

## Summary

- Deploy Wednesday, shut down Friday.
`;
}

function curatedMeetingSnapshot(): string {
  return `${frontmatter({
    type: "meeting",
    date: "2026-05-09",
    title: "Sync",
    source: "raw/granola/2026-05-09-sync.md",
    indexed_at: "2026-05-09T10:30:00.000Z",
  })}
# Sync

## Summary

- Deploy Wednesday, shut down Friday.
`;
}

function rawAgentSummarySnapshot(): string {
  return `${frontmatter({
    type: "raw_slack_thread",
    source: "slack",
    date: "2026-05-09",
    channel: "C999",
    thread_ts: "1778309999.000000",
    latest_ts: "1778310000.000000",
    title: "Agent investigation summary",
    message_count: 2,
    pulled_at: "2026-05-09T10:00:00.000Z",
  })}
# Agent investigation summary

## 1778309999.000000 | Roomote Agent

search: 999. Action item: Investigate ROOMOTE-WORKER-28Y and ROOMOTE-19 first.

## 1778310000.000000 | Roomote Agent

Scanned the last 24 hours across roomote. Follow-up: decide whether ROOMOTE-DISPATCHER-H should be downgraded. No code change needed.

## 1778310001.000000 | Roomote Agent

Update: the transcript-focused tests are passing. I'll do the delivery pass if it stays clean.
`;
}

function verificationJson(
  overrides: Partial<{
    classification: "action" | "not_action" | "needs_review";
    confidence: number;
    owner: "mine" | "theirs" | "unknown";
    actionText: string;
    dueDate: string | null;
    rationale: string;
  }> = {},
): string {
  return JSON.stringify({
    classification: "action",
    confidence: 0.91,
    owner: "unknown",
    actionText: "Prepare the launch checklist.",
    dueDate: null,
    rationale: "A human made a concrete commitment or request.",
    ...overrides,
  });
}

class StubTodoVerifierModel {
  readonly name = "stub-todo-model";
  readonly requests: TodoVerifierModelRequest[] = [];

  constructor(private readonly responses: Array<string | Error>) {}

  async complete(request: TodoVerifierModelRequest): Promise<{ content: string }> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response instanceof Error) {
      throw response;
    }
    return { content: response ?? "{}" };
  }
}
