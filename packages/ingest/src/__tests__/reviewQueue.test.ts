import { describe, expect, test } from "bun:test";
import type { IngestActivityItem, RawToWikiIndexRecord } from "../activity.js";
import type { ClassificationReason } from "../raw-to-wiki/types.js";
import { selectReviewQueue } from "../reviewQueue.js";

function mkItem(over: Partial<IngestActivityItem>): IngestActivityItem {
  return {
    id: over.id ?? "item",
    eventId: over.eventId ?? 1,
    ts: "2026-05-30T00:00:00.000Z",
    stage: "raw_to_wiki",
    status: over.status ?? "indexed",
    source: over.source ?? "granola",
    operation: "raw.index",
    sourceId: null,
    title: over.title ?? null,
    rawPath: over.rawPath ?? "wiki/raw/granola/a.md",
    sourceUrl: null,
    primaryKind: null,
    primaryPath: over.primaryPath ?? null,
    peoplePaths: [],
    projectPaths: over.projectPaths ?? [],
    decisionPaths: [],
    threadPaths: [],
    writtenPaths: [],
    classificationReasons: over.classificationReasons ?? [],
    reason: null,
    message: null,
    relatedSessionIds: [],
  };
}

function mkRecord(sessionId: string, over: Partial<IngestActivityItem>): RawToWikiIndexRecord {
  return { sessionId, item: mkItem(over) };
}

const taxonomyReason: ClassificationReason = {
  kind: "project_alias",
  source: "taxonomy",
  label: "Atlas Portal",
};

describe("selectReviewQueue", () => {
  test("surfaces unexplained outcomes; reviewReason + source-weighted score", () => {
    const queue = selectReviewQueue(
      [
        mkRecord("s1", { eventId: 1, rawPath: "wiki/raw/granola/a.md", projectPaths: [] }),
        mkRecord("s1", {
          eventId: 2,
          source: "slack",
          rawPath: "wiki/raw/slack/b.md",
          projectPaths: ["wiki/projects/x.md"],
        }),
      ],
      new Set(),
    );
    expect(queue.map((q) => q.rawPath)).toEqual(["wiki/raw/granola/a.md", "wiki/raw/slack/b.md"]);
    // granola + no_project = 4 ranks above slack + generic_project = 1.
    expect(queue[0]).toMatchObject({ reviewReason: "no_project", source: "granola", score: 4 });
    expect(queue[1]).toMatchObject({ reviewReason: "generic_project", source: "slack", score: 1 });
  });

  test("excludes taxonomy-explained, skipped, and already-corrected items", () => {
    const queue = selectReviewQueue(
      [
        mkRecord("s1", { rawPath: "explained.md", classificationReasons: [taxonomyReason] }),
        mkRecord("s1", { rawPath: "skipped.md", status: "skipped" }),
        mkRecord("s1", { rawPath: "corrected.md" }),
        mkRecord("s1", { rawPath: "keep.md" }),
      ],
      new Set(["corrected.md"]),
    );
    expect(queue.map((q) => q.rawPath)).toEqual(["keep.md"]);
  });

  test("excludes dry-run previews (only durable index outcomes)", () => {
    const queue = selectReviewQueue(
      [mkRecord("s1", { rawPath: "preview.md", status: "previewed" })],
      new Set(),
    );
    expect(queue).toHaveLength(0);
  });

  test("dedupes by rawPath, keeping the latest classification", () => {
    const queue = selectReviewQueue(
      [
        mkRecord("old", { eventId: 5, rawPath: "x.md", projectPaths: ["wiki/projects/x.md"] }),
        mkRecord("new", { eventId: 9, rawPath: "x.md", projectPaths: [] }),
      ],
      new Set(),
    );
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ eventId: 9, reviewReason: "no_project", sessionId: "new" });
  });

  test("respects source filter and limit", () => {
    const records = [
      mkRecord("s1", { eventId: 1, source: "granola", rawPath: "g.md" }),
      mkRecord("s1", { eventId: 2, source: "slack", rawPath: "s.md" }),
    ];
    expect(
      selectReviewQueue(records, new Set(), { source: "slack" }).map((q) => q.rawPath),
    ).toEqual(["s.md"]);
    expect(selectReviewQueue(records, new Set(), { limit: 1 })).toHaveLength(1);
  });
});
