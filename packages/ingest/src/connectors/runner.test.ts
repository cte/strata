import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runConnectorOperation } from "../connectors.js";

describe("connector runner", () => {
  test("runs a connector in a trace-backed session and redacts secret config", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-connector-runner-"));
    try {
      const result = await runConnectorOperation({
        name: "notion",
        operation: "dry_run",
        config: {
          pageId: "page_123",
          token: "secret_should_not_render",
        },
        repoRoot,
        env: {},
        fetchImpl: fakeNotionFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      });

      expect(result.connector).toBe("notion");
      expect(result.sessionId).toBeString();
      expect(result.rawPath).toBe("wiki/raw/notion/2026-05-04-strategy-doc.md");

      const trace = await readFile(
        path.join(repoRoot, ".strata", "traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("connector.notion.dry_run.started");
      expect(trace).toContain("connector.notion.dry_run.item");
      expect(trace).toContain("[redacted]");
      expect(trace).not.toContain("secret_should_not_render");
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
      expect(headers.get("authorization")).toBe("Bearer secret_should_not_render");

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
