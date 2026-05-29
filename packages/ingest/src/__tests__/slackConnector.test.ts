import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConnectorCheckpointPath } from "../connectors/checkpointStore.js";
import { slackConnector } from "../slackConnector.js";

describe("slackConnector", () => {
  test("dry-runs and pulls explicit thread snapshots from a fixture", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-slack-connector-"));
    try {
      const fixture = path.join(repoRoot, "slack-thread.json");
      await writeFile(
        fixture,
        JSON.stringify({
          channel: "C123",
          thread_ts: "1715102030.000000",
          messages: [
            {
              ts: "1715102030.000000",
              user: "U123",
              text: "Launch plan",
            },
            {
              ts: "1715102040.000000",
              user: "U456",
              text: "Ship it",
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
      const preview = await slackConnector.dryRun({ fromJson: fixture }, runtime);
      expect(preview.connector).toBe("slack");
      expect(preview.rawPath).toContain("wiki/raw/slack/");
      expect(preview.rawPath).toContain("launch-plan");
      expect(preview.written).toBe(false);

      const pulled = await slackConnector.pull({ fromJson: fixture }, runtime);
      expect(pulled.written).toBe(true);
      const content = await readFile(path.join(repoRoot, pulled.rawPath), "utf8");
      expect(content).toContain("type: raw_slack_thread");
      expect(content).toContain("Launch plan");
      expect(content).toContain("Ship it");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("syncs accessible channels and stores a checkpoint", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-slack-sync-"));
    const calls: string[] = [];
    try {
      const fetchImpl = async (input: URL | Request | string): Promise<Response> => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname.endsWith("/auth.test")) {
          return jsonResponse({
            ok: true,
            team: "Acme",
            team_id: "T123",
            url: "https://acme.slack.com",
          });
        }
        if (url.pathname.endsWith("/conversations.list")) {
          return jsonResponse({
            ok: true,
            channels: [{ id: "C123", name: "engineering", is_member: true }],
            response_metadata: { next_cursor: "" },
          });
        }
        if (url.pathname.endsWith("/conversations.history")) {
          return jsonResponse({
            ok: true,
            messages: [
              { ts: "1715102060.000000", user: "U789", text: "Solo note" },
              { ts: "1715102055.000000", bot_id: "B123", text: "bot noise" },
              {
                ts: "1715102030.000000",
                thread_ts: "1715102030.000000",
                user: "U123",
                text: "Launch plan",
                reply_count: 1,
              },
            ],
            response_metadata: { next_cursor: "" },
          });
        }
        if (url.pathname.endsWith("/conversations.replies")) {
          return jsonResponse({
            ok: true,
            messages: [
              {
                ts: "1715102030.000000",
                thread_ts: "1715102030.000000",
                user: "U123",
                text: "Launch plan",
              },
              {
                ts: "1715102040.000000",
                thread_ts: "1715102030.000000",
                user: "U456",
                text: "Ship it",
              },
            ],
            response_metadata: { next_cursor: "" },
          });
        }
        return jsonResponse({ ok: false, error: `unexpected ${url.pathname}` });
      };

      const result = await slackConnector.pull(
        {
          botToken: "xoxb-test",
          channels: "engineering",
          maxChannels: 1,
          mode: "sync",
          since: "2026-05-01",
        },
        {
          repoRoot,
          env: {},
          fetchImpl: fetchImpl as typeof fetch,
          now: new Date("2026-05-05T10:00:00.000Z"),
        },
      );

      expect(result.connector).toBe("slack");
      expect(result.items).toHaveLength(2);
      expect(result.documents).toHaveLength(2);
      expect(result.items?.some((item) => item.rawPath.includes("launch-plan"))).toBe(true);
      expect(calls).toContain("/api/conversations.replies");

      const checkpoint = JSON.parse(
        await readFile(getConnectorCheckpointPath("slack", repoRoot), "utf8"),
      ) as { data: { channels: { C123: { latestTs: string } } } };
      expect(checkpoint.data.channels.C123.latestTs).toBe("1715102060.000000");
      const firstRawPath = result.items?.[0]?.rawPath;
      expect(firstRawPath).toBeDefined();
      if (firstRawPath) {
        const content = await readFile(path.join(repoRoot, firstRawPath), "utf8");
        expect(content).toContain("type: raw_slack_thread");
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
