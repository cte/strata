import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createWebApiHandler } from "./server.js";
import type { AppRouter } from "./trpc.js";

describe("web api", () => {
  test("lists connector setup state without exposing secrets", async () => {
    const handler = createWebApiHandler({
      repoRoot: "/tmp/strata",
      env: { NOTION_TOKEN: "secret_should_not_render" },
    });

    const response = await handler(new Request("http://127.0.0.1/api/connectors"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("notion");
    expect(text).toContain("Token configured");
    expect(text).not.toContain("secret_should_not_render");
  });

  test("dry-runs Notion through a trace-backed session", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: { NOTION_TOKEN: "secret" },
        fetchImpl: fakeNotionFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);

      try {
        const body = await client.connectors.notion.dryRun.mutate({ pageId: "page_123" });
        expect(body.connector).toBe("notion");
        expect(body.rawPath).toBe("wiki/raw/notion/2026-05-04-strategy-doc.md");
        expect(body.dryRun).toBe(true);
        expect(typeof body.sessionId).toBe("string");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function createTestClient(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler,
  });
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${server.hostname}:${server.port}/api/trpc`,
      }),
    ],
  });
  return {
    client,
    close: () => server.stop(true),
  };
}

function fakeNotionFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
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
              paragraph: { rich_text: [{ plain_text: "API preview." }] },
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
