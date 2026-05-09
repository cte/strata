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
} from "./granolaConnector.js";

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
});

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
