import { describe, expect, test } from "bun:test";
import type { ResolvedIngestTaxonomy } from "../ingestTaxonomy.js";
import type { ReviewQueueItem } from "../reviewQueue.js";
import { buildTaxonomyEvidence } from "../taxonomyEvidence.js";

function mkQueueItem(over: Partial<ReviewQueueItem>): ReviewQueueItem {
  return {
    dedupeKey: over.rawPath ?? "wiki/raw/granola/a.md",
    source: over.source ?? "granola",
    sessionId: "s1",
    eventId: over.eventId ?? 1,
    rawPath: over.rawPath ?? "wiki/raw/granola/a.md",
    title: over.title ?? null,
    primaryPath: over.primaryPath ?? null,
    projectPaths: over.projectPaths ?? [],
    reasons: [],
    reviewReason: over.reviewReason ?? "no_project",
    score: over.score ?? 4,
  };
}

const emptyTaxonomy: ResolvedIngestTaxonomy = {
  path: null,
  found: false,
  source: "taxonomy",
  selfNames: [],
  projects: [],
  slack: {
    materialPatterns: [],
    ignoredLogPatterns: [],
    transientCheckPatterns: [],
    routineCoordinationPatterns: [],
    statusOnlyPatterns: [],
  },
};

describe("buildTaxonomyEvidence", () => {
  test("caps Slack and keeps structured sources, reporting the drop", () => {
    const queue: ReviewQueueItem[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        mkQueueItem({ source: "granola", rawPath: `g${i}.md`, score: 4 }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        mkQueueItem({ source: "slack", rawPath: `s${i}.md`, score: 2 }),
      ),
    ];
    const bundle = buildTaxonomyEvidence(queue, emptyTaxonomy, { slackCap: 5 });
    expect(bundle.counts.structured).toBe(3);
    expect(bundle.counts.slack).toBe(5);
    expect(bundle.counts.droppedSlack).toBe(15);
    expect(bundle.counts.candidates).toBe(8);
    // Structured (score 4) sorted above slack (score 2).
    expect(bundle.candidates[0]?.source).toBe("granola");
  });

  test("structuredCap bounds Granola/Notion volume", () => {
    const queue = Array.from({ length: 10 }, (_, i) =>
      mkQueueItem({ source: "notion", rawPath: `n${i}.md`, score: 3 }),
    );
    const bundle = buildTaxonomyEvidence(queue, emptyTaxonomy, { structuredCap: 4 });
    expect(bundle.counts.structured).toBe(4);
    expect(bundle.counts.candidates).toBe(4);
  });

  test("summarizes existing taxonomy so the model avoids re-proposing", () => {
    const taxonomy: ResolvedIngestTaxonomy = {
      ...emptyTaxonomy,
      selfNames: ["chris"],
      projects: [
        // resolved projects carry the label as the first alias
        { label: "Roo Code", aliases: [{} as never, {} as never], patterns: [] },
      ],
    };
    const bundle = buildTaxonomyEvidence([], taxonomy);
    expect(bundle.taxonomy).toMatchObject({
      projects: 1,
      aliases: 1,
      selfNames: 1,
      projectLabels: ["Roo Code"],
    });
  });
});
