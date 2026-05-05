import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeNotionPageId, pullNotionPage } from "./notion.js";

describe("pullNotionPage", () => {
  test("snapshots a Notion page into wiki raw Notion sources", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-notion-"));
    try {
      const result = await pullNotionPage({
        pageId: "page_123",
        repoRoot,
        token: "secret",
        now: new Date("2026-05-05T10:00:00.000Z"),
        fetchImpl: fakeNotionFetch(),
      });

      expect(result).toMatchObject({
        pageId: "page_123",
        title: "Strategy Doc",
        date: "2026-05-04",
        path: "wiki/raw/notion/2026-05-04-strategy-doc.md",
        written: true,
        skipped: false,
        dryRun: false,
      });

      const content = await readFile(path.join(repoRoot, result.path), "utf8");
      expect(content).toContain("type: raw_notion_page");
      expect(content).toContain("source: notion");
      expect(content).toContain('title: "Strategy Doc"');
      expect(content).toContain("# Strategy Doc");
      expect(content).toContain("This is a **useful** source document.");
      expect(content).toContain("[Source link](https://example.com)");
      expect(content).toContain("  - Nested item");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("dry run returns the target path without writing", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-notion-"));
    try {
      const result = await pullNotionPage({
        pageId: "page_123",
        repoRoot,
        token: "secret",
        dryRun: true,
        fetchImpl: fakeNotionFetch(),
      });

      expect(result.path).toBe("wiki/raw/notion/2026-05-04-strategy-doc.md");
      expect(result.written).toBe(false);
      expect(result.skipped).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("normalizes pasted Notion page URLs", () => {
    expect(
      normalizeNotionPageId(
        "https://www.notion.so/acme/Strategy-Doc-0123456789abcdef0123456789abcdef?pvs=4",
      ),
    ).toBe("01234567-89ab-cdef-0123-456789abcdef");
  });

  test("retries rate-limited Notion requests", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-notion-"));
    try {
      let pageRequests = 0;
      const result = await pullNotionPage({
        pageId: "page_123",
        repoRoot,
        token: "secret",
        fetchImpl: retryOnceFetch(() => {
          pageRequests += 1;
          return pageRequests === 1;
        }),
      });

      expect(result.written).toBe(true);
      expect(pageRequests).toBe(2);
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
      expect(headers.get("notion-version")).toBe("2026-03-11");
      expect(headers.get("content-type")).toBe("application/json");

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
                rich_text: [
                  { plain_text: "This is a " },
                  {
                    plain_text: "useful",
                    annotations: { bold: true },
                  },
                  { plain_text: " source document." },
                ],
              },
            },
            {
              id: "block_2",
              type: "bulleted_list_item",
              has_children: true,
              bulleted_list_item: {
                rich_text: [
                  {
                    plain_text: "Source link",
                    href: "https://example.com",
                  },
                ],
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }

      if (url.pathname === "/v1/blocks/block_2/children") {
        return Response.json({
          results: [
            {
              id: "block_3",
              type: "bulleted_list_item",
              has_children: false,
              bulleted_list_item: {
                rich_text: [{ plain_text: "Nested item" }],
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

function retryOnceFetch(shouldRateLimit: () => boolean): typeof fetch {
  const fallback = fakeNotionFetch();
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      if (url.pathname === "/v1/pages/page_123" && shouldRateLimit()) {
        return Response.json(
          { code: "rate_limited", message: "slow down" },
          { headers: { "retry-after": "0" }, status: 429 },
        );
      }
      return fallback(...args);
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}
