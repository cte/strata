import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { notionConnector } from "../notionConnector.js";

describe("notionConnector", () => {
  test("reports missing token as not configured", async () => {
    const status = await notionConnector.validate(
      { pageId: "page_123" },
      { repoRoot: "/tmp/strata", env: {} },
    );

    expect(status.state).toBe("not_configured");
    expect(status.configured).toBe(false);
  });

  test("dry-runs and pulls through the shared connector contract", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-notion-connector-"));
    try {
      const runtime = {
        repoRoot,
        env: { NOTION_TOKEN: "secret" },
        fetchImpl: fakeNotionFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      };

      const preview = await notionConnector.dryRun({ pageId: "page_123" }, runtime);
      expect(preview).toMatchObject({
        connector: "notion",
        sourceId: "page_123",
        title: "Strategy Doc",
        rawPath: "wiki/raw/notion/2026-05-04-strategy-doc.md",
        written: false,
        skipped: false,
        dryRun: true,
      });

      const pulled = await notionConnector.pull({ pageId: "page_123" }, runtime);
      expect(pulled).toMatchObject({
        connector: "notion",
        rawPath: "wiki/raw/notion/2026-05-04-strategy-doc.md",
        written: true,
        skipped: false,
        dryRun: false,
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function fakeNotionFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      const headers = new Headers(args[1]?.headers);
      expect(headers.get("authorization")).toBe("Bearer secret");

      if (url.pathname === "/v1/pages/page_123") {
        return Response.json({
          id: "page_123",
          url: "https://notion.so/page_123",
          last_edited_time: "2026-05-04T12:00:00.000Z",
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Strategy Doc" }],
            },
          },
        });
      }

      if (url.pathname === "/v1/blocks/page_123/children") {
        return Response.json({
          results: [
            {
              id: "block_1",
              type: "paragraph",
              has_children: false,
              paragraph: {
                rich_text: [{ plain_text: "Connector content." }],
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }

      return Response.json({ error: "not found" }, { status: 404 });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}
