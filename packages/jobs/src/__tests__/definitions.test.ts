import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchWikiSearchIndex } from "@strata/core";
import { writeConnectorConfigProfile } from "@strata/ingest/connectors";
import { createDefaultJobRegistry } from "../registry.js";
import { runJob } from "../runner.js";

describe("default job definitions", () => {
  test("registers scheduled agent prompt jobs", () => {
    const registry = createDefaultJobRegistry();
    const job = registry.get("agent.prompt");
    expect(job).toBeDefined();
    expect(job?.mode).toBe("write");
    expect(job?.inputSchema).toMatchObject({
      required: ["prompt"],
      properties: {
        prompt: { type: "string" },
        toolProfile: {
          enum: ["read-only", "maintenance", "learning", "dangerous"],
          default: "maintenance",
        },
      },
    });
  });

  test("agent.prompt validates prompt before model setup", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-agent-prompt-job-"));
    try {
      const result = await runJob({
        jobName: "agent.prompt",
        input: {},
        repoRoot,
        registry: createDefaultJobRegistry(),
      });
      expect(result.status).toBe("failed");
      expect(result.errorMessage).toBe("prompt is required");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("connector.pull resolves config profiles at run time", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-connector-profile-job-"));
    try {
      const firstFixture = path.join(repoRoot, "first-granola.json");
      const secondFixture = path.join(repoRoot, "second-granola.json");
      await writeFile(firstFixture, granolaFixture("First Sync"), "utf8");
      await writeFile(secondFixture, granolaFixture("Second Sync"), "utf8");

      await writeConnectorConfigProfile({
        connector: "granola",
        id: "default",
        label: "Granola scheduled defaults",
        config: {
          fixture: firstFixture,
          since: "2026-05-01T00:00:00.000Z",
        },
        repoRoot,
        makeDefault: true,
      });

      const first = await runJob({
        jobName: "connector.pull",
        input: {
          connector: "granola",
          operation: "dry_run",
          configProfileId: "default",
        },
        repoRoot,
        registry: createDefaultJobRegistry(),
        now: new Date("2026-05-27T12:00:00.000Z"),
      });
      expect(first.status).toBe("completed");
      expect(JSON.stringify(first.output?.details)).toContain("First Sync");
      expect(first.output?.details).toMatchObject({
        configProfile: {
          id: "default",
          label: "Granola scheduled defaults",
        },
      });

      await writeConnectorConfigProfile({
        connector: "granola",
        id: "default",
        label: "Granola scheduled defaults",
        config: {
          fixture: secondFixture,
          since: "2026-05-01T00:00:00.000Z",
        },
        repoRoot,
        makeDefault: true,
      });

      const second = await runJob({
        jobName: "connector.pull",
        input: {
          connector: "granola",
          operation: "dry_run",
          configProfileId: "default",
        },
        repoRoot,
        registry: createDefaultJobRegistry(),
        now: new Date("2026-05-27T12:00:00.000Z"),
      });
      expect(second.status).toBe("completed");
      expect(JSON.stringify(second.output?.details)).toContain("Second Sync");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki.hygiene stages entity proposals and refreshes retrieval", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-wiki-hygiene-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roo-code.md"),
        "---\ntype: project\ntitle: Roo Code\n---\n# Roo Code\n\nCanonical project page.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roocodeinc-project-sync-from-slack-thread.md"),
        "---\ntype: project\ntitle: RooCodeInc project sync from Slack thread\n---\n# RooCodeInc project sync from Slack thread\n\nDuplicate context.\n",
        "utf8",
      );

      const result = await runJob({
        jobName: "wiki.hygiene",
        repoRoot,
        registry: createDefaultJobRegistry(),
        now: new Date("2026-05-27T12:00:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("needs_attention");
      expect(result.output?.metrics).toMatchObject({
        findings: 1,
        proposals: 1,
        searchIndexed: 3,
      });
      expect(result.output?.summary).toContain("consolidation group");

      const matches = await searchWikiSearchIndex({
        repoRoot,
        query: "Roo Code",
        includeRaw: false,
      });
      expect(matches?.[0]?.kind).toBe("curated");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function granolaFixture(title: string): string {
  return JSON.stringify({
    notes: [
      {
        id: title.toLowerCase().replace(/\s+/g, "_"),
        title,
        created_at: "2026-05-04T12:00:00.000Z",
        attendees: [{ name: "Ada" }],
        transcript: `Transcript for ${title}.`,
        url: `https://granola.ai/notes/${title.toLowerCase().replace(/\s+/g, "-")}`,
      },
    ],
  });
}
