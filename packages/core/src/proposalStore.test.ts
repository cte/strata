import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyLearningProposal,
  findPendingLearningProposalByDedupeKey,
  listLearningProposals,
  readLearningProposal,
  updateLearningProposalStatus,
  writeLearningProposal,
  writeOrReuseLearningProposal,
} from "./proposalStore.js";
import { searchWikiSearchIndex } from "./wikiSearchIndex.js";

describe("proposal store", () => {
  test("reuses pending proposals with the same dedupe key", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      const input = {
        kind: "wiki" as const,
        sessionId: "sess_first",
        title: "Consolidate Roo Code",
        reason: "Duplicate project pages.",
        evidence: ["wiki/projects/roo-code.md"],
        proposedChange: "Merge duplicates into the canonical page.",
        risk: "medium",
        dedupeKey: "wiki.entities:project-topic:roo-code",
      };

      const first = await writeOrReuseLearningProposal(repoRoot, input);
      const second = await writeOrReuseLearningProposal(repoRoot, {
        ...input,
        sessionId: "sess_second",
      });
      const found = await findPendingLearningProposalByDedupeKey(
        repoRoot,
        "wiki",
        "wiki.entities:project-topic:roo-code",
      );

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.proposal.path).toBe(first.proposal.path);
      expect(found?.path).toBe(first.proposal.path);
      expect(found?.dedupeKey).toBe("wiki.entities:project-topic:roo-code");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists, reads, and records proposal status transitions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "skill",
        sessionId: "sess_review",
        title: "Add a debugging pitfall",
        reason: "The same issue recurred.",
        evidence: ["trace sess_review"],
        proposedChange: "Update a skill after review.",
        risk: "low",
        dedupeKey: "skills:debugging-pitfall",
      });

      const listed = await listLearningProposals(repoRoot, { status: "pending" });
      expect(listed.map((item) => item.id)).toEqual([proposal.id]);

      const detail = await readLearningProposal(repoRoot, proposal.id);
      expect(detail?.proposal.title).toBe("Add a debugging pitfall");
      expect(detail?.sections.Reason).toContain("same issue");
      expect(detail?.apply.supported).toBe(false);

      const deferred = await updateLearningProposalStatus(repoRoot, {
        selector: proposal.id,
        status: "deferred",
        actor: "test",
        reason: "wait for another run",
        now: "2026-05-27T12:00:00.000Z",
      });
      expect(deferred.status).toBe("deferred");
      expect(deferred.deferredAt).toBe("2026-05-27T12:00:00.000Z");

      const active = await findPendingLearningProposalByDedupeKey(
        repoRoot,
        "skill",
        "skills:debugging-pitfall",
      );
      expect(active?.id).toBe(proposal.id);

      const rejected = await updateLearningProposalStatus(repoRoot, {
        selector: proposal.path,
        status: "rejected",
        actor: "test",
        now: "2026-05-27T12:01:00.000Z",
      });
      expect(rejected.status).toBe("rejected");
      const after = await readFile(path.join(repoRoot, proposal.path), "utf8");
      expect(after).toContain("status: rejected");
      expect(after).toContain("## Review History");
      expect(after).toContain("marked deferred by test");
      expect(after).toContain("marked rejected by test");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("auto-applies explicit wiki page creation proposals", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_apply",
        title: "Create meeting page for 2026-05-27 Sync",
        reason: "Granola proposal generated a concrete meeting page.",
        evidence: ["wiki/raw/granola/2026-05-27-sync.md"],
        proposedChange: [
          "Proposed meeting page: `wiki/meetings/2026-05-27-sync.md`",
          "",
          "```markdown",
          "---",
          "type: meeting",
          "date: 2026-05-27",
          "title: Sync",
          "---",
          "",
          "# Sync",
          "",
          "## Summary",
          "",
          "- Review notes.",
          "```",
        ].join("\n"),
        risk: "low",
      });

      const preview = await readLearningProposal(repoRoot, proposal.id);
      expect(preview?.apply).toMatchObject({
        supported: true,
        mode: "wiki.createPage",
        targetPath: "wiki/meetings/2026-05-27-sync.md",
      });

      const result = await applyLearningProposal(repoRoot, {
        selector: proposal.id,
        actor: "test",
        now: "2026-05-27T12:00:00.000Z",
      });
      expect(result.writtenPaths).toEqual(["wiki/meetings/2026-05-27-sync.md"]);
      expect(result.proposal.status).toBe("applied");
      expect(
        await readFile(path.join(repoRoot, "wiki/meetings/2026-05-27-sync.md"), "utf8"),
      ).toContain("# Sync");
      expect(await readFile(path.join(repoRoot, "wiki/log.md"), "utf8")).toContain(
        "proposal.apply | Create meeting page for 2026-05-27 Sync",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("auto-applies explicit wiki page patch proposals", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/projects/pricing.md"),
        [
          "---",
          "type: project",
          "title: Pricing",
          "---",
          "",
          "# Pricing",
          "",
          "## Status",
          "",
          "- Old pricing note.",
          "",
        ].join("\n"),
        "utf8",
      );
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_patch",
        title: "Patch pricing status",
        reason: "The project page needs one explicit update.",
        evidence: ["wiki/meetings/2026-05-28-pricing.md"],
        proposedChange: [
          "Patch wiki page: `wiki/projects/pricing.md`",
          "",
          "Expected old text:",
          "",
          "```markdown",
          "## Status",
          "",
          "- Old pricing note.",
          "```",
          "",
          "Replacement text:",
          "",
          "```markdown",
          "## Status",
          "",
          "- Updated pricing note.",
          "```",
        ].join("\n"),
        risk: "low",
      });

      const preview = await readLearningProposal(repoRoot, proposal.id);
      expect(preview?.apply).toMatchObject({
        supported: true,
        mode: "wiki.patchPage",
        targetPath: "wiki/projects/pricing.md",
      });

      const result = await applyLearningProposal(repoRoot, {
        selector: proposal.id,
        actor: "test",
        now: "2026-05-28T12:00:00.000Z",
      });
      expect(result.mode).toBe("wiki.patchPage");
      expect(result.writtenPaths).toEqual(["wiki/projects/pricing.md"]);
      expect(result.proposal.status).toBe("applied");
      expect(await readFile(path.join(repoRoot, "wiki/projects/pricing.md"), "utf8")).toContain(
        "- Updated pricing note.",
      );
      expect(await readFile(path.join(repoRoot, "wiki/log.md"), "utf8")).toContain(
        "proposal.apply | Patch pricing status",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("refuses ambiguous wiki page patch proposals", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/projects/pricing.md"),
        ["# Pricing", "", "- Duplicate note.", "- Duplicate note.", ""].join("\n"),
        "utf8",
      );
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_patch",
        title: "Ambiguous pricing patch",
        reason: "The old text appears twice.",
        evidence: ["wiki/projects/pricing.md"],
        proposedChange: [
          "Patch wiki page: `wiki/projects/pricing.md`",
          "",
          "Expected old text:",
          "",
          "```markdown",
          "- Duplicate note.",
          "```",
          "",
          "Replacement text:",
          "",
          "```markdown",
          "- Replacement note.",
          "```",
        ].join("\n"),
        risk: "medium",
      });

      await expect(
        applyLearningProposal(repoRoot, {
          selector: proposal.id,
          actor: "test",
          now: "2026-05-28T12:00:00.000Z",
        }),
      ).rejects.toThrow("Expected old text matched 2 times");
      expect(await readFile(path.join(repoRoot, "wiki/projects/pricing.md"), "utf8")).toContain(
        "- Duplicate note.\n- Duplicate note.",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("does not preview unsafe wiki patch proposals as supported", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_patch",
        title: "Unsafe patch",
        reason: "The target escapes the writable wiki page scope.",
        evidence: ["wiki/projects/pricing.md"],
        proposedChange: [
          "Patch wiki page: `wiki/projects/../../outside.md`",
          "",
          "Expected old text:",
          "",
          "```markdown",
          "old",
          "```",
          "",
          "Replacement text:",
          "",
          "```markdown",
          "new",
          "```",
        ].join("\n"),
        risk: "high",
      });

      const preview = await readLearningProposal(repoRoot, proposal.id);
      expect(preview?.apply).toMatchObject({
        supported: false,
        mode: "manual",
      });
      await expect(
        applyLearningProposal(repoRoot, {
          selector: proposal.id,
          actor: "test",
          now: "2026-05-28T12:00:00.000Z",
        }),
      ).rejects.toThrow("Refusing to apply proposal outside writable wiki pages");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("previews explicit consolidation operation plans without enabling apply", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await writeProjectPage(repoRoot, "wiki/projects/pricing.md", "Pricing");
      await writeProjectPage(repoRoot, "wiki/projects/pricing-strategy.md", "Pricing Strategy");
      await writeProjectPage(
        repoRoot,
        "wiki/projects/compute-cost-analysis.md",
        "Compute Cost Analysis",
      );
      await writeFile(
        path.join(repoRoot, "wiki/index.md"),
        [
          "# Index",
          "",
          "- Old repo path: wiki/projects/pricing-strategy.md",
          "- Old wiki path: projects/compute-cost-analysis.md",
          "- Embedded path-like token should stay: wiki/projects/pricing-strategy.md.backup",
          "- Raw source should not be scanned: wiki/raw/slack/thread.md",
          "",
        ].join("\n"),
        "utf8",
      );
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/thread.md"),
        "wiki/projects/pricing-strategy.md should not be rewritten in raw.",
        "utf8",
      );

      const operationPlan = {
        kind: "wiki.consolidateEntity",
        entityType: "project",
        topic: "Pricing",
        canonicalPath: "wiki/projects/pricing.md",
        sourcePaths: [
          "wiki/projects/pricing-strategy.md",
          "wiki/projects/compute-cost-analysis.md",
        ],
        operations: [
          {
            type: "mergeIntoCanonical",
            targetPath: "wiki/projects/pricing.md",
            sourcePaths: [
              "wiki/projects/pricing-strategy.md",
              "wiki/projects/compute-cost-analysis.md",
            ],
            mode: "manualReview",
          },
          {
            type: "supersedePage",
            sourcePath: "wiki/projects/pricing-strategy.md",
            canonicalPath: "wiki/projects/pricing.md",
            replacementContent: "# Pricing Strategy\n\nSuperseded by [[Pricing]].\n",
            preserveEvidenceLinks: true,
          },
          {
            type: "supersedePage",
            sourcePath: "wiki/projects/compute-cost-analysis.md",
            canonicalPath: "wiki/projects/pricing.md",
            replacementContent: "# Compute Cost Analysis\n\nSuperseded by [[Pricing]].\n",
            preserveEvidenceLinks: true,
          },
          {
            type: "rewriteBacklinks",
            fromPath: "wiki/projects/pricing-strategy.md",
            toPath: "wiki/projects/pricing.md",
          },
          {
            type: "rewriteBacklinks",
            fromPath: "wiki/projects/compute-cost-analysis.md",
            toPath: "wiki/projects/pricing.md",
          },
          {
            type: "refreshSearchIndex",
            source: "all",
          },
        ],
        evidenceLinks: [
          "wiki/projects/pricing.md",
          "wiki/projects/pricing-strategy.md",
          "wiki/projects/compute-cost-analysis.md",
        ],
      };
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_consolidate",
        title: "Consolidate wiki project entity: Pricing",
        reason: "Maintenance found duplicate project pages.",
        evidence: [
          "Canonical candidate: projects/pricing.md",
          "Duplicate candidate: projects/pricing-strategy.md",
          "Duplicate candidate: projects/compute-cost-analysis.md",
        ],
        proposedChange: [
          "Keep projects/pricing.md as canonical.",
          "",
          "Consolidation operation plan:",
          "",
          "```json",
          JSON.stringify(operationPlan, null, 2),
          "```",
        ].join("\n"),
        risk: "medium",
        dedupeKey: "wiki.entities:project-topic:pricing",
      });

      const detail = await readLearningProposal(repoRoot, proposal.id);
      expect(detail?.apply.supported).toBe(false);
      expect(detail?.operationPlan).toMatchObject({
        mode: "wiki.consolidateEntity",
        source: "explicitJson",
        valid: true,
        applySupported: false,
        readiness: "manualReview",
        summary: "Consolidate 2 project page(s) into wiki/projects/pricing.md.",
      });
      expect(detail?.operationPlan?.plan?.operations).toHaveLength(6);
      expect(detail?.operationPlan?.warnings.join("\n")).toContain("Canonical page merge");
      expect(detail?.operationPlan?.diffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "supersedePage",
            status: "ready",
            targetPath: "wiki/projects/pricing-strategy.md",
            replacementCount: 1,
            diff: expect.stringContaining("+Superseded by [[Pricing]]."),
          }),
          expect.objectContaining({
            operation: "rewriteBacklinks",
            status: "ready",
            targetPath: "wiki/index.md",
            fromPath: "wiki/projects/pricing-strategy.md",
            toPath: "wiki/projects/pricing.md",
            replacementCount: 1,
            diff: expect.stringContaining("+- Old repo path: wiki/projects/pricing.md"),
          }),
          expect.objectContaining({
            operation: "rewriteBacklinks",
            status: "ready",
            targetPath: "wiki/index.md",
            fromPath: "wiki/projects/compute-cost-analysis.md",
            toPath: "wiki/projects/pricing.md",
            replacementCount: 1,
            diff: expect.stringContaining("+- Old wiki path: projects/pricing.md"),
          }),
        ]),
      );
      expect(detail?.operationPlan?.diffs.some((diff) => diff.targetPath.includes("raw/"))).toBe(
        false,
      );
      await expect(
        applyLearningProposal(repoRoot, {
          selector: proposal.id,
          actor: "test",
          now: "2026-05-28T12:00:00.000Z",
        }),
      ).rejects.toThrow("Proposal cannot be auto-applied");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("auto-applies exact consolidation operation plans after preview revalidation", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await writeProjectPage(repoRoot, "wiki/projects/pricing.md", "Pricing");
      await writeProjectPage(repoRoot, "wiki/projects/pricing-strategy.md", "Pricing Strategy");
      await writeFile(
        path.join(repoRoot, "wiki/projects/pricing.md"),
        [
          "---",
          "type: project",
          "title: Pricing",
          "---",
          "",
          "# Pricing",
          "",
          "## Status",
          "",
          "- Old canonical summary.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/index.md"),
        [
          "# Index",
          "",
          "- Old repo path: wiki/projects/pricing-strategy.md",
          "- Embedded path-like token should stay: wiki/projects/pricing-strategy.md.backup",
          "",
        ].join("\n"),
        "utf8",
      );
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/raw/slack/thread.md"),
        "wiki/projects/pricing-strategy.md should not be rewritten in raw.",
        "utf8",
      );

      const operationPlan = {
        kind: "wiki.consolidateEntity",
        entityType: "project",
        topic: "Pricing",
        canonicalPath: "wiki/projects/pricing.md",
        sourcePaths: ["wiki/projects/pricing-strategy.md"],
        operations: [
          {
            type: "mergeIntoCanonical",
            targetPath: "wiki/projects/pricing.md",
            sourcePaths: ["wiki/projects/pricing-strategy.md"],
            mode: "exactPatch",
            patches: [
              {
                expectedOldText: "## Status\n\n- Old canonical summary.",
                replacementText:
                  "## Status\n\n- Old canonical summary.\n- Merged source evidence from [[Pricing Strategy]].",
              },
            ],
          },
          {
            type: "supersedePage",
            sourcePath: "wiki/projects/pricing-strategy.md",
            canonicalPath: "wiki/projects/pricing.md",
            replacementContent: "# Pricing Strategy\n\nSuperseded by [[Pricing]].\n",
            preserveEvidenceLinks: true,
          },
          {
            type: "rewriteBacklinks",
            fromPath: "wiki/projects/pricing-strategy.md",
            toPath: "wiki/projects/pricing.md",
          },
          {
            type: "refreshSearchIndex",
            source: "all",
          },
        ],
        evidenceLinks: ["wiki/projects/pricing.md", "wiki/projects/pricing-strategy.md"],
      };
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_consolidate",
        title: "Consolidate wiki project entity: Pricing",
        reason: "Maintenance found duplicate project pages.",
        evidence: [
          "Canonical candidate: projects/pricing.md",
          "Duplicate candidate: projects/pricing-strategy.md",
        ],
        proposedChange: [
          "Keep projects/pricing.md as canonical.",
          "",
          "Consolidation operation plan:",
          "",
          "```json",
          JSON.stringify(operationPlan, null, 2),
          "```",
        ].join("\n"),
        risk: "medium",
      });

      const detail = await readLearningProposal(repoRoot, proposal.id);
      expect(detail?.apply).toMatchObject({
        supported: true,
        mode: "wiki.consolidateEntity",
        targetPath: "wiki/projects/pricing.md",
      });
      const previewFingerprint = detail?.apply.previewFingerprint;
      expect(typeof previewFingerprint).toBe("string");
      if (previewFingerprint === undefined) {
        throw new Error("Expected consolidation preview fingerprint.");
      }
      expect(detail?.operationPlan).toMatchObject({
        source: "explicitJson",
        valid: true,
        readiness: "exact",
        applySupported: true,
      });
      expect(detail?.operationPlan?.warnings.join("\n")).toContain(
        "Exact consolidation diffs are available for guarded apply",
      );
      expect(detail?.operationPlan?.diffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "mergeIntoCanonical",
            status: "ready",
            targetPath: "wiki/projects/pricing.md",
            replacementCount: 1,
            patchCount: 1,
            diff: expect.stringContaining("+- Merged source evidence from [[Pricing Strategy]]."),
          }),
          expect.objectContaining({
            operation: "rewriteBacklinks",
            status: "ready",
            targetPath: "wiki/index.md",
            fromPath: "wiki/projects/pricing-strategy.md",
            toPath: "wiki/projects/pricing.md",
            replacementCount: 1,
          }),
        ]),
      );

      const result = await applyLearningProposal(repoRoot, {
        selector: proposal.id,
        actor: "test",
        previewFingerprint,
        now: "2026-05-28T12:00:00.000Z",
      });

      expect(result.mode).toBe("wiki.consolidateEntity");
      expect(result.proposal.status).toBe("applied");
      expect(result.writtenPaths).toEqual([
        "wiki/projects/pricing.md",
        "wiki/projects/pricing-strategy.md",
        "wiki/index.md",
      ]);
      expect(await readFile(path.join(repoRoot, "wiki/projects/pricing.md"), "utf8")).toContain(
        "- Merged source evidence from [[Pricing Strategy]].",
      );
      expect(
        await readFile(path.join(repoRoot, "wiki/projects/pricing-strategy.md"), "utf8"),
      ).toContain("Superseded by [[Pricing]].");
      expect(await readFile(path.join(repoRoot, "wiki/index.md"), "utf8")).toContain(
        "wiki/projects/pricing.md",
      );
      expect(await readFile(path.join(repoRoot, "wiki/raw/slack/thread.md"), "utf8")).toContain(
        "wiki/projects/pricing-strategy.md should not be rewritten in raw.",
      );
      const searchMatches = await searchWikiSearchIndex({
        repoRoot,
        query: "Merged source evidence",
        limit: 5,
      });
      expect(searchMatches?.map((match) => match.path)).toContain("projects/pricing.md");
      const log = await readFile(path.join(repoRoot, "wiki/log.md"), "utf8");
      expect(log).toContain("proposal.apply | Consolidate wiki project entity: Pricing");
      expect(log).toContain("- Wrote: wiki/projects/pricing.md");
      expect(log).toContain("- Wrote: wiki/index.md");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("refuses stale reviewed consolidation previews", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await writeProjectPage(repoRoot, "wiki/projects/pricing-strategy.md", "Pricing Strategy");
      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/projects/pricing.md"),
        ["# Pricing", "", "## Status", "", "- Old canonical summary.", ""].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki/index.md"),
        "# Index\n\n- wiki/projects/pricing-strategy.md\n",
        "utf8",
      );

      const operationPlan = {
        kind: "wiki.consolidateEntity",
        entityType: "project",
        topic: "Pricing",
        canonicalPath: "wiki/projects/pricing.md",
        sourcePaths: ["wiki/projects/pricing-strategy.md"],
        operations: [
          {
            type: "mergeIntoCanonical",
            targetPath: "wiki/projects/pricing.md",
            sourcePaths: ["wiki/projects/pricing-strategy.md"],
            mode: "exactPatch",
            patches: [
              {
                expectedOldText: "## Status\n\n- Old canonical summary.",
                replacementText:
                  "## Status\n\n- Old canonical summary.\n- Merged source evidence from [[Pricing Strategy]].",
              },
            ],
          },
          {
            type: "supersedePage",
            sourcePath: "wiki/projects/pricing-strategy.md",
            canonicalPath: "wiki/projects/pricing.md",
            replacementContent: "# Pricing Strategy\n\nSuperseded by [[Pricing]].\n",
            preserveEvidenceLinks: true,
          },
          {
            type: "rewriteBacklinks",
            fromPath: "wiki/projects/pricing-strategy.md",
            toPath: "wiki/projects/pricing.md",
          },
          {
            type: "refreshSearchIndex",
            source: "all",
          },
        ],
        evidenceLinks: ["wiki/projects/pricing.md", "wiki/projects/pricing-strategy.md"],
      };
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_consolidate",
        title: "Consolidate wiki project entity: Pricing",
        reason: "Maintenance found duplicate project pages.",
        evidence: ["Duplicate candidate: projects/pricing-strategy.md"],
        proposedChange: ["```json", JSON.stringify(operationPlan, null, 2), "```"].join("\n"),
        risk: "medium",
      });

      const detail = await readLearningProposal(repoRoot, proposal.id);
      const previewFingerprint = detail?.apply.previewFingerprint;
      if (previewFingerprint === undefined) {
        throw new Error("Expected consolidation preview fingerprint.");
      }
      await writeFile(
        path.join(repoRoot, "wiki/index.md"),
        [
          "# Index",
          "",
          "- wiki/projects/pricing-strategy.md",
          "- wiki/projects/pricing-strategy.md second current reference",
          "",
        ].join("\n"),
        "utf8",
      );

      await expect(
        applyLearningProposal(repoRoot, {
          selector: proposal.id,
          actor: "test",
          previewFingerprint,
          now: "2026-05-28T12:00:00.000Z",
        }),
      ).rejects.toThrow("Proposal preview changed");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("flags ambiguous exact canonical merge patches", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await writeProjectPage(repoRoot, "wiki/projects/pricing-strategy.md", "Pricing Strategy");
      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/projects/pricing.md"),
        ["# Pricing", "", "- Duplicate note.", "- Duplicate note.", ""].join("\n"),
        "utf8",
      );

      const operationPlan = {
        kind: "wiki.consolidateEntity",
        entityType: "project",
        topic: "Pricing",
        canonicalPath: "wiki/projects/pricing.md",
        sourcePaths: ["wiki/projects/pricing-strategy.md"],
        operations: [
          {
            type: "mergeIntoCanonical",
            targetPath: "wiki/projects/pricing.md",
            sourcePaths: ["wiki/projects/pricing-strategy.md"],
            mode: "exactPatch",
            patches: [
              {
                expectedOldText: "- Duplicate note.",
                replacementText: "- Merged note.",
              },
            ],
          },
          {
            type: "supersedePage",
            sourcePath: "wiki/projects/pricing-strategy.md",
            canonicalPath: "wiki/projects/pricing.md",
            replacementContent: "# Pricing Strategy\n\nSuperseded by [[Pricing]].\n",
            preserveEvidenceLinks: true,
          },
          {
            type: "rewriteBacklinks",
            fromPath: "wiki/projects/pricing-strategy.md",
            toPath: "wiki/projects/pricing.md",
          },
          {
            type: "refreshSearchIndex",
            source: "all",
          },
        ],
        evidenceLinks: ["wiki/projects/pricing.md", "wiki/projects/pricing-strategy.md"],
      };
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_consolidate",
        title: "Consolidate wiki project entity: Pricing",
        reason: "Maintenance found duplicate project pages.",
        evidence: [
          "Canonical candidate: projects/pricing.md",
          "Duplicate candidate: projects/pricing-strategy.md",
        ],
        proposedChange: [
          "Consolidation operation plan:",
          "",
          "```json",
          JSON.stringify(operationPlan, null, 2),
          "```",
        ].join("\n"),
        risk: "medium",
      });

      const detail = await readLearningProposal(repoRoot, proposal.id);
      expect(detail?.operationPlan).toMatchObject({
        source: "explicitJson",
        valid: false,
        readiness: "invalid",
      });
      expect(detail?.operationPlan?.issues.join("\n")).toContain("ambiguous");
      expect(detail?.operationPlan?.diffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "mergeIntoCanonical",
            status: "ambiguous",
            targetPath: "wiki/projects/pricing.md",
          }),
        ]),
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("infers legacy consolidation proposal plans from current prose shape", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await writeProjectPage(repoRoot, "wiki/projects/pricing.md", "Pricing");
      await writeProjectPage(repoRoot, "wiki/projects/pricing-strategy.md", "Pricing Strategy");

      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_consolidate",
        title: "Consolidate wiki project entity: Pricing",
        reason:
          "Maintenance found multiple project pages that appear to describe the same canonical topic.",
        evidence: [
          "Canonical candidate: projects/pricing.md",
          "Duplicate candidate: projects/pricing-strategy.md",
        ],
        proposedChange: [
          "Keep projects/pricing.md as the canonical Pricing project page unless review finds a better target.",
          "",
          "Merge durable context, decisions, active threads, and source evidence links from:",
          "",
          "- projects/pricing-strategy.md",
          "",
          "After merging, replace duplicate pages with short superseded notes that link to the canonical page and preserve source evidence links. Do not delete decision pages or raw/source pages.",
        ].join("\n"),
        risk: "medium",
        dedupeKey: "wiki.entities:project-topic:pricing",
      });

      const detail = await readLearningProposal(repoRoot, proposal.id);
      expect(detail?.operationPlan).toMatchObject({
        mode: "wiki.consolidateEntity",
        source: "legacyProse",
        valid: true,
        readiness: "manualReview",
        plan: {
          canonicalPath: "wiki/projects/pricing.md",
          sourcePaths: ["wiki/projects/pricing-strategy.md"],
        },
      });
      expect(detail?.operationPlan?.diffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "supersedePage",
            status: "ready",
            targetPath: "wiki/projects/pricing-strategy.md",
          }),
          expect.objectContaining({
            operation: "rewriteBacklinks",
            status: "noMatches",
            fromPath: "wiki/projects/pricing-strategy.md",
          }),
        ]),
      );
      expect(detail?.operationPlan?.warnings.join("\n")).toContain("inferred from legacy prose");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("flags invalid consolidation plans before apply support exists", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-proposals-"));
    try {
      await writeProjectPage(repoRoot, "wiki/projects/pricing.md", "Pricing");
      await writeProjectPage(repoRoot, "wiki/projects/pricing-strategy.md", "Pricing Strategy");
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_consolidate",
        title: "Consolidate wiki project entity: Pricing",
        reason: "Maintenance found duplicate project pages.",
        evidence: ["Canonical candidate: projects/pricing.md"],
        proposedChange: [
          "Consolidation operation plan:",
          "",
          "```json",
          JSON.stringify(
            {
              kind: "wiki.consolidateEntity",
              entityType: "project",
              topic: "Pricing",
              canonicalPath: "wiki/projects/pricing.md",
              sourcePaths: ["wiki/projects/pricing-strategy.md"],
              operations: [
                {
                  type: "mergeIntoCanonical",
                  targetPath: "wiki/projects/pricing.md",
                  sourcePaths: ["wiki/projects/pricing-strategy.md"],
                  mode: "manualReview",
                },
                {
                  type: "refreshSearchIndex",
                  source: "all",
                },
              ],
            },
            null,
            2,
          ),
          "```",
        ].join("\n"),
        risk: "medium",
      });

      const detail = await readLearningProposal(repoRoot, proposal.id);
      expect(detail?.operationPlan).toMatchObject({
        source: "explicitJson",
        valid: false,
        readiness: "invalid",
      });
      expect(detail?.operationPlan?.issues.join("\n")).toContain("Missing supersedePage");
      expect(detail?.operationPlan?.issues.join("\n")).toContain("Missing rewriteBacklinks");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function writeProjectPage(
  repoRoot: string,
  relativePath: string,
  title: string,
): Promise<void> {
  const absolutePath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    ["---", "type: project", `title: ${title}`, "---", "", `# ${title}`, ""].join("\n"),
    "utf8",
  );
}
