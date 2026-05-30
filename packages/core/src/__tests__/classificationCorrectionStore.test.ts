import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClassificationCorrectionStore } from "../classificationCorrectionStore.js";
import { SessionStore } from "../sessionStore.js";

describe("ClassificationCorrectionStore", () => {
  test("migration applies and CRUD round-trips", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-corrections-"));
    const session = await SessionStore.open(repoRoot);
    try {
      const store = new ClassificationCorrectionStore(session.db);

      const created = store.create({
        source: "granola",
        targetSessionId: "sess_x",
        targetEventId: 42,
        rawPath: "wiki/raw/granola/x.md",
        observed: { projectPaths: [], primaryPath: "wiki/meetings/x.md", kept: true, reasons: [] },
        verdict: "unrecognized_project",
        correction: { projectLabel: "Atlas Portal", aliases: ["atlas"] },
        dedupeKey: "k1",
      });
      expect(created.id.startsWith("classification_correction_")).toBe(true);
      expect(created.status).toBe("open");

      const byKey = store.getByDedupeKey("k1");
      expect(byKey?.verdict).toBe("unrecognized_project");
      expect(byKey?.observed).toEqual({
        projectPaths: [],
        primaryPath: "wiki/meetings/x.md",
        kept: true,
        reasons: [],
      });
      expect(byKey?.correction).toEqual({ projectLabel: "Atlas Portal", aliases: ["atlas"] });
      expect(store.getByDedupeKey("missing")).toBeUndefined();

      expect(store.list()).toHaveLength(1);
      expect([...store.correctedDedupeKeys()]).toEqual(["k1"]);

      store.setStatus(created.id, "applied");
      store.setDerivedProposalPath(created.id, "proposals/p.md");
      const reread = store.getByDedupeKey("k1");
      expect(reread?.status).toBe("applied");
      expect(reread?.derivedProposalPath).toBe("proposals/p.md");
      expect(store.list({ status: "open" })).toHaveLength(0);
      expect(store.list({ status: "applied" })).toHaveLength(1);
    } finally {
      session.close();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("null correction persists as null", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-corrections-"));
    const session = await SessionStore.open(repoRoot);
    try {
      const store = new ClassificationCorrectionStore(session.db);
      store.create({
        source: "slack",
        targetSessionId: "sess_y",
        targetEventId: 7,
        rawPath: "wiki/raw/slack/y.md",
        observed: { kept: true },
        verdict: "confirm",
        dedupeKey: "k2",
      });
      const row = store.getByDedupeKey("k2");
      expect(row?.correction).toBeNull();
      expect(row?.derivedProposalPath).toBeNull();
    } finally {
      session.close();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
