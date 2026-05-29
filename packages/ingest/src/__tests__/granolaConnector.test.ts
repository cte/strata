import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  configureGranola,
  disconnectGranola,
  getGranolaStatus,
  granolaConnector,
  hasGranolaCredentialsSync,
} from "../granolaConnector.js";

describe("granolaConnector", () => {
  test("persists credentials through the shared connector secret store", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-granola-connector-"));
    try {
      const options = {
        repoRoot,
        env: {},
        fetchImpl: fakeGranolaFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      };

      expect(hasGranolaCredentialsSync(options)).toBe(false);
      expect(await getGranolaStatus(options)).toMatchObject({
        state: "not_configured",
        configured: false,
      });

      const configured = await configureGranola({ apiToken: "grn_secret" }, options);
      expect(configured).toMatchObject({
        state: "connected",
        configured: true,
        validatedAt: "2026-05-05T10:00:00.000Z",
      });
      expect(hasGranolaCredentialsSync(options)).toBe(true);

      const connectorStatus = await granolaConnector.validate({}, options);
      expect(connectorStatus).toMatchObject({
        name: "granola",
        state: "ready",
        configured: true,
      });

      const disconnected = await disconnectGranola(options);
      expect(disconnected.state).toBe("not_configured");
      expect(hasGranolaCredentialsSync(options)).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("dry-runs and pulls raw meeting snapshots", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-granola-pull-"));
    try {
      const fixture = path.join(repoRoot, "granola.json");
      await writeFile(
        fixture,
        JSON.stringify({
          notes: [
            {
              id: "note_1",
              title: "Roadmap Sync",
              created_at: "2026-05-04T12:00:00.000Z",
              attendees: [{ name: "Ada" }],
              transcript: "We agreed to port connectors.",
              url: "https://granola.ai/notes/note_1",
            },
          ],
        }),
        "utf8",
      );

      const runtime = {
        repoRoot,
        env: {},
        now: new Date("2026-05-05T10:00:00.000Z"),
      };
      const preview = await granolaConnector.dryRun(
        { fixture, since: "2026-05-01T00:00:00.000Z" },
        runtime,
      );
      expect(preview).toMatchObject({
        connector: "granola",
        rawPath: "wiki/raw/granola/2026-05-04-roadmap-sync.md",
        written: false,
        dryRun: true,
      });
      expect(preview.items).toHaveLength(1);

      const pulled = await granolaConnector.pull(
        { fixture, since: "2026-05-01T00:00:00.000Z" },
        runtime,
      );
      expect(pulled.written).toBe(true);
      const content = await readFile(path.join(repoRoot, pulled.rawPath), "utf8");
      expect(content).toContain("type: raw_granola_transcript");
      expect(content).toContain("We agreed to port connectors.");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("paginates official note lists and fetches transcript details", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-granola-api-"));
    try {
      const runtime = {
        repoRoot,
        env: { GRANOLA_API_TOKEN: "grn_secret" },
        fetchImpl: fakePaginatedGranolaFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      };

      const pulled = await granolaConnector.pull(
        {
          since: "2026-05-01T00:00:00.000Z",
          pageSize: 30,
          maxPages: 3,
        },
        runtime,
      );

      expect(pulled.items).toHaveLength(2);
      expect(pulled.metadata.pagesFetched).toBe(2);
      const first = await readFile(
        path.join(repoRoot, "wiki/raw/granola/2026-05-02-product-review.md"),
        "utf8",
      );
      expect(first).toContain("## Summary");
      expect(first).toContain("## Transcript");
      expect(first).toContain("Ada: We agreed to launch the backfill.");
      expect(first).toContain("source_url: https://notes.granola.ai/d/one");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("writes immutable revision snapshots when Granola note content changes", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-granola-revision-"));
    try {
      const fixture = path.join(repoRoot, "granola.json");
      await writeFile(fixture, granolaFixture("Initial transcript."), "utf8");
      const runtime = {
        repoRoot,
        env: {},
        now: new Date("2026-05-05T10:00:00.000Z"),
      };

      const first = await granolaConnector.pull(
        { fixture, since: "2026-05-01T00:00:00.000Z" },
        runtime,
      );
      expect(first.rawPath).toBe("wiki/raw/granola/2026-05-04-roadmap-sync.md");
      expect(first.items?.[0]?.metadata).toMatchObject({ revision: false });
      const firstContent = await readFile(path.join(repoRoot, first.rawPath), "utf8");
      expect(firstContent).toContain("content_hash:");
      expect(firstContent).toContain("source_id: note_1");

      await writeFile(fixture, granolaFixture("Updated transcript."), "utf8");
      const second = await granolaConnector.pull(
        { fixture, since: "2026-05-01T00:00:00.000Z" },
        runtime,
      );

      expect(second.rawPath.startsWith("wiki/raw/granola/2026-05-04-roadmap-sync-")).toBe(true);
      expect(second.rawPath.endsWith(".md")).toBe(true);
      expect(second.items?.[0]?.metadata).toMatchObject({ revision: true });
      const revisionContent = await readFile(path.join(repoRoot, second.rawPath), "utf8");
      expect(revisionContent).toContain("Updated transcript.");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function granolaFixture(transcript: string): string {
  return JSON.stringify({
    notes: [
      {
        id: "note_1",
        title: "Roadmap Sync",
        created_at: "2026-05-04T12:00:00.000Z",
        attendees: [{ name: "Ada" }],
        transcript,
        url: "https://granola.ai/notes/note_1",
      },
    ],
  });
}

function fakeGranolaFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      const headers = new Headers(args[1]?.headers);
      expect(url.href).toBe("https://public-api.granola.ai/v1/notes");
      expect(headers.get("authorization")).toBe("Bearer grn_secret");
      return Response.json({ notes: [] });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}

function fakePaginatedGranolaFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      const headers = new Headers(args[1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer grn_secret");

      if (url.pathname === "/v1/notes" && url.searchParams.get("cursor") === null) {
        expect(url.searchParams.get("created_after")).toBe("2026-05-01T00:00:00.000Z");
        expect(url.searchParams.get("page_size")).toBe("30");
        return Response.json({
          notes: [
            {
              id: "not_page_one",
              title: "Product Review",
              created_at: "2026-05-02T12:00:00.000Z",
            },
          ],
          hasMore: true,
          cursor: "cursor_2",
        });
      }

      if (url.pathname === "/v1/notes" && url.searchParams.get("cursor") === "cursor_2") {
        return Response.json({
          notes: [
            {
              id: "not_page_two",
              title: "Design Sync",
              created_at: "2026-05-03T12:00:00.000Z",
            },
          ],
          hasMore: false,
          cursor: null,
        });
      }

      if (url.pathname === "/v1/notes/not_page_one") {
        expect(url.searchParams.get("include")).toBe("transcript");
        return Response.json({
          id: "not_page_one",
          title: "Product Review",
          created_at: "2026-05-02T12:00:00.000Z",
          web_url: "https://notes.granola.ai/d/one",
          attendees: [{ name: "Ada" }],
          summary_markdown: "We reviewed the product backfill.",
          transcript: [
            {
              speaker: { name: "Ada" },
              text: "We agreed to launch the backfill.",
            },
          ],
        });
      }

      if (url.pathname === "/v1/notes/not_page_two") {
        return Response.json({
          id: "not_page_two",
          title: "Design Sync",
          created_at: "2026-05-03T12:00:00.000Z",
          attendees: [{ name: "Grace" }],
          transcript: [
            {
              speaker: { name: "Grace" },
              text: "Next step is reviewing the proposal.",
            },
          ],
        });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}
