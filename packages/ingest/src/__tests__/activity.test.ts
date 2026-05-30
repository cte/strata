import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { getIngestActivityRunFromStore, listIngestActivityFromStore } from "../activity.js";

async function withStore<T>(fn: (store: SessionStore, repoRoot: string) => Promise<T>): Promise<T> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-activity-"));
  try {
    await mkdir(path.join(repoRoot, "wiki"), { recursive: true });
    const store = await SessionStore.open(repoRoot);
    try {
      return await fn(store, repoRoot);
    } finally {
      store.close();
    }
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

describe("ingest activity", () => {
  test("normalizes scheduled job, connector, and raw-to-wiki sessions", async () => {
    await withStore(async (store) => {
      const job = await store.createSession({
        kind: "job",
        title: "Scheduled job: Granola near-real-time sync",
      });
      await store.appendEvent(job.id, "job.started", {
        jobName: "connector.pull",
        mode: "write",
        input: {
          connector: "granola",
          index: true,
          config: { apiToken: "[redacted]", maxPages: 3 },
        },
        schedule: {
          id: "sched_granola",
          name: "Granola near-real-time sync",
        },
      });

      const connector = await store.createSession({
        kind: "ingest",
        title: "Scheduled granola pull",
      });
      await store.appendEvent(connector.id, "connector.granola.pull.started", {
        connector: "granola",
        operation: "pull",
        config: { since: "2026-05-27T10:00:00.000Z" },
      });
      await store.appendEvent(connector.id, "connector.granola.pull.item", {
        connector: "granola",
        operation: "pull",
        dryRun: false,
        sourceId: "note_1",
        title: "Roadmap Sync",
        rawPath: "wiki/raw/granola/2026-05-27-roadmap-sync.md",
        sourceUrl: "https://notes.example/1",
        written: true,
        skipped: false,
        metadata: { date: "2026-05-27" },
      });
      await store.appendEvent(connector.id, "connector.granola.pull.completed", {
        connector: "granola",
        sourceId: "granola:2026-05-27T10:00:00.000Z",
        title: "Granola meetings since 2026-05-27T10:00:00.000Z",
        rawPath: "wiki/raw/granola/2026-05-27-roadmap-sync.md",
        sourceUrl: null,
        written: true,
        skipped: false,
        dryRun: false,
        metadata: { itemCount: 1, writtenCount: 1, skippedCount: 0 },
        items: [
          {
            sourceId: "note_1",
            title: "Roadmap Sync",
            rawPath: "wiki/raw/granola/2026-05-27-roadmap-sync.md",
            sourceUrl: "https://notes.example/1",
            written: true,
            skipped: false,
            metadata: { date: "2026-05-27" },
          },
        ],
      });
      await store.endSession(connector.id, "completed");

      const raw = await store.createSession({
        kind: "ingest",
        title: "Index 1 granola raw file",
      });
      await store.appendEvent(raw.id, "raw_to_wiki.index.started", {
        rawPaths: ["wiki/raw/granola/2026-05-27-roadmap-sync.md"],
        dryRun: false,
        limit: null,
        source: "granola",
      });
      await store.appendEvent(raw.id, "raw_to_wiki.index.item", {
        source: "granola",
        rawPath: "wiki/raw/granola/2026-05-27-roadmap-sync.md",
        primaryKind: "meeting",
        primaryPath: "wiki/meetings/2026-05-27-roadmap-sync.md",
        title: "Roadmap Sync",
        date: "2026-05-27",
        peoplePaths: ["wiki/people/ada-lovelace.md"],
        projectPaths: ["wiki/projects/roadmap.md"],
        decisionPaths: ["wiki/decisions/2026-05-27-ship-roadmap.md"],
        threadPaths: [],
        writtenPaths: ["wiki/meetings/2026-05-27-roadmap-sync.md", "wiki/projects/roadmap.md"],
        classificationReasons: [
          {
            kind: "project_alias",
            source: "taxonomy",
            label: "Roadmap",
            matchedText: "roadmap",
          },
        ],
        dryRun: false,
      });
      await store.appendEvent(raw.id, "raw_to_wiki.index.skipped", {
        source: "granola",
        rawPath: "wiki/raw/granola/2026-05-26-existing.md",
        reason: "Source already indexed.",
        classificationReasons: [
          {
            kind: "slack_low_signal",
            source: "generic",
            label: "status-only message",
          },
        ],
        dryRun: false,
      });
      await store.appendEvent(raw.id, "raw_to_wiki.index.completed", {
        scanned: 2,
        indexedCount: 1,
        skipped: [
          {
            rawPath: "wiki/raw/granola/2026-05-26-existing.md",
            reason: "Source already indexed.",
          },
        ],
        dryRun: false,
        source: "granola",
      });
      await store.endSession(raw.id, "completed");

      await store.appendEvent(job.id, "job.completed", {
        sessionId: job.id,
        jobName: "connector.pull",
        status: "completed",
        summary: "granola pull processed 1 item (1 written).",
        output: {
          status: "ok",
          summary: "granola pull processed 1 item (1 written).",
          metrics: {
            connectorSessionId: connector.id,
            rawToWikiSessionId: raw.id,
            itemCount: 1,
            writtenCount: 1,
            skippedCount: 0,
            indexedCount: 1,
            indexSkippedCount: 1,
            searchIndexed: 42,
          },
          details: {
            connector: {
              connector: "granola",
              sessionId: connector.id,
              dryRun: false,
            },
            rawToWiki: {
              sessionId: raw.id,
              dryRun: false,
              scanned: 2,
              indexed: [{ rawPath: "wiki/raw/granola/2026-05-27-roadmap-sync.md" }],
              skipped: [{ rawPath: "wiki/raw/granola/2026-05-26-existing.md" }],
            },
            searchIndex: { indexed: 42 },
          },
        },
        schedule: {
          id: "sched_granola",
          name: "Granola near-real-time sync",
        },
        errorMessage: null,
      });
      await store.endSession(job.id, "completed");

      const list = listIngestActivityFromStore(store, { limit: 10 });
      expect(list.runs.find((run) => run.sessionId === job.id)).toMatchObject({
        stage: "job",
        operation: "connector.pull",
        source: "granola",
        scheduleId: "sched_granola",
        counts: {
          rawWritten: 1,
          rawIndexed: 1,
          rawIndexSkipped: 1,
          searchIndexed: 42,
        },
      });
      expect(list.runs.find((run) => run.sessionId === connector.id)).toMatchObject({
        stage: "connector",
        parentSessionId: job.id,
        source: "granola",
        counts: {
          rawWritten: 1,
          itemCount: 1,
        },
      });
      expect(list.runs.find((run) => run.sessionId === raw.id)).toMatchObject({
        stage: "raw_to_wiki",
        parentSessionId: job.id,
        source: "granola",
        counts: {
          rawScanned: 2,
          rawIndexed: 1,
          rawIndexSkipped: 1,
        },
      });

      const detail = getIngestActivityRunFromStore(store, {
        sessionId: raw.id,
        itemLimit: 10,
      });
      expect(detail?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "indexed",
            title: "Roadmap Sync",
            primaryPath: "wiki/meetings/2026-05-27-roadmap-sync.md",
            projectPaths: ["wiki/projects/roadmap.md"],
            classificationReasons: [
              {
                kind: "project_alias",
                source: "taxonomy",
                label: "Roadmap",
                matchedText: "roadmap",
              },
            ],
          }),
          expect.objectContaining({
            status: "skipped",
            rawPath: "wiki/raw/granola/2026-05-26-existing.md",
            reason: "Source already indexed.",
            classificationReasons: [
              {
                kind: "slack_low_signal",
                source: "generic",
                label: "status-only message",
              },
            ],
          }),
        ]),
      );
    });
  });

  test("filters to activity that wrote or indexed durable content", async () => {
    await withStore(async (store) => {
      const connector = await store.createSession({
        kind: "ingest",
        title: "Slack pull with one write",
      });
      await store.appendEvent(connector.id, "connector.slack.pull.completed", {
        connector: "slack",
        operation: "pull",
        dryRun: false,
        items: [
          {
            sourceId: "thread_1",
            title: "Material thread",
            rawPath: "wiki/raw/slack/thread-1.md",
            written: true,
            skipped: false,
          },
          {
            sourceId: "thread_2",
            title: "Already captured",
            rawPath: "wiki/raw/slack/thread-2.md",
            written: false,
            skipped: true,
          },
        ],
      });
      await store.endSession(connector.id, "completed");

      const skipped = await store.createSession({
        kind: "ingest",
        title: "Index skipped raw files",
      });
      await store.appendEvent(skipped.id, "raw_to_wiki.index.started", {
        rawPaths: ["wiki/raw/slack/thread-2.md"],
        dryRun: false,
        source: "slack",
      });
      await store.appendEvent(skipped.id, "raw_to_wiki.index.skipped", {
        source: "slack",
        rawPath: "wiki/raw/slack/thread-2.md",
        reason: "Source already indexed.",
        dryRun: false,
      });
      await store.appendEvent(skipped.id, "raw_to_wiki.index.completed", {
        scanned: 1,
        indexedCount: 0,
        skipped: [{ rawPath: "wiki/raw/slack/thread-2.md" }],
        dryRun: false,
        source: "slack",
      });
      await store.endSession(skipped.id, "completed");

      const indexed = await store.createSession({
        kind: "ingest",
        title: "Index raw page",
      });
      await store.appendEvent(indexed.id, "raw_to_wiki.index.started", {
        rawPaths: ["wiki/raw/notion/page-written.md"],
        dryRun: false,
        source: "notion",
      });
      await store.appendEvent(indexed.id, "raw_to_wiki.index.item", {
        source: "notion",
        rawPath: "wiki/raw/notion/page-written.md",
        primaryKind: "project",
        primaryPath: "wiki/projects/page-written.md",
        title: "Page Written",
        writtenPaths: ["wiki/projects/page-written.md"],
        dryRun: false,
      });
      await store.appendEvent(indexed.id, "raw_to_wiki.index.completed", {
        scanned: 1,
        indexedCount: 1,
        skipped: [],
        dryRun: false,
        source: "notion",
      });
      await store.endSession(indexed.id, "completed");

      const preview = await store.createSession({
        kind: "ingest",
        title: "Preview raw index",
      });
      await store.appendEvent(preview.id, "raw_to_wiki.index.started", {
        rawPaths: ["wiki/raw/notion/page-1.md"],
        dryRun: true,
        source: "notion",
      });
      await store.appendEvent(preview.id, "raw_to_wiki.index.item", {
        source: "notion",
        rawPath: "wiki/raw/notion/page-1.md",
        primaryKind: "project",
        primaryPath: "wiki/projects/page-1.md",
        title: "Page 1",
        writtenPaths: ["wiki/projects/page-1.md"],
        dryRun: true,
      });
      await store.appendEvent(preview.id, "raw_to_wiki.index.completed", {
        scanned: 1,
        indexedCount: 1,
        skipped: [],
        dryRun: true,
        source: "notion",
      });
      await store.endSession(preview.id, "completed");

      const searchOnly = await store.createSession({
        kind: "job",
        title: "Refresh wiki search index",
      });
      await store.appendEvent(searchOnly.id, "job.completed", {
        jobName: "wiki.search-index.refresh",
        status: "completed",
        summary: "Indexed 999 wiki documents.",
        output: {
          status: "ok",
          summary: "Indexed 999 wiki documents.",
          metrics: {
            searchIndexed: 999,
          },
          details: {
            searchIndex: { indexed: 999 },
          },
        },
      });
      await store.endSession(searchOnly.id, "completed");

      const list = listIngestActivityFromStore(store, {
        limit: 10,
        resultFilters: ["raw_written", "wiki_indexed"],
      });
      expect(list.runs.some((run) => run.sessionId === connector.id)).toBe(true);
      expect(list.runs.some((run) => run.sessionId === indexed.id)).toBe(true);
      expect(list.runs.some((run) => run.sessionId === skipped.id)).toBe(false);
      expect(list.runs.some((run) => run.sessionId === preview.id)).toBe(false);
      expect(list.runs.some((run) => run.sessionId === searchOnly.id)).toBe(false);

      const searchList = listIngestActivityFromStore(store, {
        limit: 10,
        resultFilters: ["search_indexed"],
      });
      expect(searchList.runs.some((run) => run.sessionId === searchOnly.id)).toBe(true);
      expect(searchList.runs.some((run) => run.sessionId === connector.id)).toBe(false);

      const skippedPreviewList = listIngestActivityFromStore(store, {
        limit: 10,
        resultFilters: ["skipped_or_previewed"],
      });
      expect(skippedPreviewList.runs.some((run) => run.sessionId === skipped.id)).toBe(true);
      expect(skippedPreviewList.runs.some((run) => run.sessionId === preview.id)).toBe(true);
      expect(skippedPreviewList.runs.some((run) => run.sessionId === searchOnly.id)).toBe(false);

      const projections = store.db
        .query<
          {
            sessionId: string;
            hasWritesOrWikiIndexes: number;
            rawWritten: number;
            rawIndexed: number;
            searchIndexed: number;
          },
          []
        >(
          `select
            session_id as sessionId,
            has_writes_or_wiki_indexes as hasWritesOrWikiIndexes,
            raw_written as rawWritten,
            raw_indexed as rawIndexed,
            search_indexed as searchIndexed
          from ingest_activity_runs`,
        )
        .all();
      const projectionById = new Map(projections.map((row) => [row.sessionId, row]));
      expect(projectionById.get(connector.id)).toMatchObject({
        hasWritesOrWikiIndexes: 1,
        rawWritten: 1,
      });
      expect(projectionById.get(searchOnly.id)).toMatchObject({
        hasWritesOrWikiIndexes: 0,
        searchIndexed: 999,
      });

      const detail = getIngestActivityRunFromStore(store, {
        sessionId: connector.id,
        itemLimit: 10,
        resultFilters: ["raw_written"],
      });
      expect(detail?.items).toEqual([
        expect.objectContaining({
          sourceId: "thread_1",
          status: "written",
        }),
      ]);
      const previewDetail = getIngestActivityRunFromStore(store, {
        sessionId: preview.id,
        itemLimit: 10,
        resultFilters: ["skipped_or_previewed"],
      });
      expect(previewDetail?.items).toEqual([
        expect.objectContaining({
          rawPath: "wiki/raw/notion/page-1.md",
          status: "previewed",
        }),
      ]);
    });
  });

  test("continues scanning past recent no-op runs when filtering writes and indexes", async () => {
    await withStore(async (store) => {
      const write = await store.createSession({
        kind: "ingest",
        title: "Older Slack pull with a write",
      });
      await store.appendEvent(write.id, "connector.slack.pull.completed", {
        connector: "slack",
        operation: "pull",
        dryRun: false,
        items: [
          {
            sourceId: "thread_older",
            title: "Older material thread",
            rawPath: "wiki/raw/slack/thread-older.md",
            written: true,
            skipped: false,
          },
        ],
      });
      await store.endSession(write.id, "completed");
      setSessionStartedAt(store, write.id, "2026-05-28T00:00:00.000Z");

      for (let index = 0; index < 12; index += 1) {
        const searchOnly = await store.createSession({
          kind: "job",
          title: `Recent search refresh ${index}`,
        });
        await store.appendEvent(searchOnly.id, "job.completed", {
          jobName: "wiki.search-index.refresh",
          status: "completed",
          summary: "Indexed 999 wiki documents.",
          output: {
            status: "ok",
            summary: "Indexed 999 wiki documents.",
            metrics: {
              searchIndexed: 999,
            },
            details: {
              searchIndex: { indexed: 999 },
            },
          },
        });
        await store.endSession(searchOnly.id, "completed");
        setSessionStartedAt(
          store,
          searchOnly.id,
          `2026-05-28T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
        );
      }

      const list = listIngestActivityFromStore(store, {
        limit: 1,
        writesOrIndexesOnly: true,
      });
      expect(list.runs).toHaveLength(1);
      expect(list.runs[0]?.sessionId).toBe(write.id);
    });
  });

  test("refreshes stale activity run projections when session events change", async () => {
    await withStore(async (store) => {
      const session = await store.createSession({
        kind: "ingest",
        title: "Mutable activity projection",
      });
      await store.appendEvent(session.id, "connector.slack.pull.completed", {
        connector: "slack",
        operation: "pull",
        dryRun: false,
        items: [
          {
            sourceId: "thread_skip",
            title: "Already captured",
            rawPath: "wiki/raw/slack/thread-skip.md",
            written: false,
            skipped: true,
          },
        ],
      });

      expect(
        listIngestActivityFromStore(store, {
          limit: 10,
          writesOrIndexesOnly: true,
        }).runs,
      ).toHaveLength(0);

      await store.appendEvent(session.id, "connector.slack.pull.completed", {
        connector: "slack",
        operation: "pull",
        dryRun: false,
        items: [
          {
            sourceId: "thread_write",
            title: "Material thread",
            rawPath: "wiki/raw/slack/thread-write.md",
            written: true,
            skipped: false,
          },
        ],
      });

      const list = listIngestActivityFromStore(store, {
        limit: 10,
        writesOrIndexesOnly: true,
      });
      expect(list.runs.map((run) => run.sessionId)).toContain(session.id);
      const projection = store.db
        .query<{ hasWritesOrWikiIndexes: number; rawWritten: number }, [string]>(
          `select
            has_writes_or_wiki_indexes as hasWritesOrWikiIndexes,
            raw_written as rawWritten
          from ingest_activity_runs
          where session_id = ?`,
        )
        .get(session.id);
      expect(projection).toMatchObject({
        hasWritesOrWikiIndexes: 1,
        rawWritten: 1,
      });
    });
  });
});

function setSessionStartedAt(store: SessionStore, sessionId: string, startedAt: string): void {
  store.db.query("update sessions set started_at = ? where id = ?").run(startedAt, sessionId);
}
