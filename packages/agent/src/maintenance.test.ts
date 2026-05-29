import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyLearningProposal, readLearningProposal, SessionStore } from "@strata/core";
import { listMaintenanceJobs, runMaintenanceJob } from "./maintenance.js";

describe("maintenance jobs", () => {
  test("lists the initial manual maintenance jobs", () => {
    expect(listMaintenanceJobs().map((job) => job.name)).toEqual([
      "wiki.lint",
      "wiki.entities",
      "actions.review",
      "memory.review",
      "skills.inventory",
      "index.refresh",
    ]);
  });

  test("runs index refresh as an auditable maintenance session", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki", "index.md"),
        "# Index\n\n- [[Already Indexed]]\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "alpha.md"),
        "---\ntype: project\n---\n# Alpha\n",
        "utf8",
      );

      const result = await runMaintenanceJob({ jobName: "index.refresh", repoRoot });

      expect(result.status).toBe("needs_attention");
      expect(result.job).toBe("index.refresh");
      expect(result.findings).toHaveLength(1);
      expect(result.proposals).toHaveLength(1);
      expect(result.reportPath).toContain(".strata/reports/maintenance/");

      const report = await readFile(path.join(repoRoot, result.reportPath), "utf8");
      expect(report).toContain("projects/alpha.md");

      const store = await SessionStore.open(repoRoot);
      try {
        const session = store.getSession(result.sessionId);
        expect(session?.kind).toBe("maintain");
        expect(session?.status).toBe("completed");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki lint flags stale and structurally weak wiki content", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "threads"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "priorities.md"),
        "---\nlast_updated: 2000-01-01\n---\n# Priorities\n",
        "utf8",
      );
      await writeFile(path.join(repoRoot, "wiki", "threads", "old.md"), "# Old Thread\n", "utf8");

      const result = await runMaintenanceJob({ jobName: "wiki.lint", repoRoot });

      expect(result.status).toBe("needs_attention");
      expect(result.findings.some((finding) => finding.title === "Stale priorities")).toBe(true);
      expect(result.findings.some((finding) => finding.title === "Missing frontmatter")).toBe(true);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki entity audit flags duplicate and over-specific project pages", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roo-code.md"),
        "---\ntype: project\ntitle: Roo Code\n---\n# Roo Code\n",
        "utf8",
      );
      await writeFile(
        path.join(
          repoRoot,
          "wiki",
          "projects",
          "roocodeinc-roomote-release-main-20260510-deploy-marker-investigation-from-a-very-specific-slack-thread.md",
        ),
        "---\ntype: project\ntitle: RooCodeInc Roomote release/main 20260510 deploy marker investigation from a very specific Slack thread\n---\n# RooCodeInc Roomote release/main 20260510 deploy marker investigation from a very specific Slack thread\n",
        "utf8",
      );

      const result = await runMaintenanceJob({ jobName: "wiki.entities", repoRoot });

      expect(result.status).toBe("needs_attention");
      expect(result.metrics).toMatchObject({
        projectPages: 2,
        duplicateProjectTopics: 1,
        overSpecificProjectPages: 1,
        newProposals: 2,
        reusedProposals: 0,
      });
      expect(result.proposals).toHaveLength(2);
      expect(result.findings.some((finding) => finding.title === "Duplicate project topic")).toBe(
        true,
      );
      expect(
        result.findings.some((finding) => finding.title === "Over-specific project page"),
      ).toBe(true);
      expect(
        result.findings.find((finding) => finding.title === "Duplicate project topic"),
      ).toMatchObject({
        data: {
          topic: "Roo Code",
          canonicalPath: path.join("projects", "roo-code.md"),
          duplicatePaths: [
            path.join(
              "projects",
              "roocodeinc-roomote-release-main-20260510-deploy-marker-investigation-from-a-very-specific-slack-thread.md",
            ),
          ],
        },
      });

      const proposal = await readFile(path.join(repoRoot, result.proposals[0]?.path ?? ""), "utf8");
      expect(proposal).toContain("dedupe_key:");
      expect(proposal).toContain("Consolidate wiki project entity: Roo Code");
      expect(proposal).toContain("Consolidation operation plan:");
      expect(proposal).toContain('"kind": "wiki.consolidateEntity"');
      expect(proposal).toContain('"mode": "manualReview"');
      expect(proposal).toContain('"type": "supersedePage"');
      expect(proposal).toContain("bun run strata wiki search-index refresh --source all");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki entity audit emits applicable exact consolidation patches for safe project merges", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki", "index.md"),
        "# Index\n\n- wiki/projects/roocodeinc-sync.md\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roo-code.md"),
        [
          "---",
          "type: project",
          "title: Roo Code",
          "---",
          "",
          "# Roo Code",
          "",
          "## Status",
          "",
          "- Canonical project summary.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roocodeinc-sync.md"),
        [
          "---",
          "type: project",
          "title: RooCodeInc Sync",
          "---",
          "",
          "# RooCodeInc Sync",
          "",
          "## Status",
          "",
          "- Slack sync said deploy markers should stay visible in release summaries.",
          "",
          "## Decisions",
          "",
          "- [[decisions/2026-05-01-deploy-markers|Keep deploy markers visible]].",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await runMaintenanceJob({ jobName: "wiki.entities", repoRoot });

      expect(result.status).toBe("needs_attention");
      expect(result.metrics).toMatchObject({
        duplicateProjectTopics: 1,
        newProposals: 1,
        reusedProposals: 0,
      });
      expect(result.proposals).toHaveLength(1);

      const proposalText = await readFile(
        path.join(repoRoot, result.proposals[0]?.path ?? ""),
        "utf8",
      );
      expect(proposalText).toContain('"mode": "exactPatch"');
      expect(proposalText).toContain("## Consolidated Sources");
      expect(proposalText).toContain("deploy markers should stay visible");

      const detail = await readLearningProposal(repoRoot, result.proposals[0]?.id ?? "");
      expect(detail?.operationPlan).toMatchObject({
        valid: true,
        readiness: "exact",
        applySupported: true,
      });
      const previewFingerprint = detail?.apply.previewFingerprint;
      if (previewFingerprint === undefined) {
        throw new Error("Expected consolidation preview fingerprint.");
      }

      const applied = await applyLearningProposal(repoRoot, {
        selector: result.proposals[0]?.id ?? "",
        actor: "test",
        previewFingerprint,
        now: "2026-05-28T12:00:00.000Z",
      });

      expect(applied.mode).toBe("wiki.consolidateEntity");
      expect(applied.proposal.status).toBe("applied");
      expect(
        await readFile(path.join(repoRoot, "wiki", "projects", "roo-code.md"), "utf8"),
      ).toContain("Slack sync said deploy markers should stay visible in release summaries.");
      expect(
        await readFile(path.join(repoRoot, "wiki", "projects", "roocodeinc-sync.md"), "utf8"),
      ).toContain("status: superseded");
      expect(await readFile(path.join(repoRoot, "wiki", "index.md"), "utf8")).toContain(
        "wiki/projects/roo-code.md",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki entity audit ignores superseded project redirects", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing.md"),
        "---\ntype: project\ntitle: Pricing\n---\n# Pricing\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "pricing-strategy.md"),
        [
          "---",
          "type: project",
          "title: Pricing Strategy",
          "status: superseded",
          "superseded_by: projects/pricing.md",
          "---",
          "",
          "# Pricing Strategy",
          "",
          "Consolidated into [[projects/pricing|Pricing]].",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await runMaintenanceJob({ jobName: "wiki.entities", repoRoot });

      expect(result.status).toBe("ok");
      expect(result.metrics).toMatchObject({
        projectPages: 1,
        duplicateProjectTopics: 0,
        overSpecificProjectPages: 0,
      });
      expect(result.proposals).toHaveLength(0);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki entity audit reuses pending consolidation proposals on repeat runs", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roo-code.md"),
        "---\ntype: project\ntitle: Roo Code\n---\n# Roo Code\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roocodeinc-project-sync-from-slack-thread.md"),
        "---\ntype: project\ntitle: RooCodeInc project sync from Slack thread\n---\n# RooCodeInc project sync from Slack thread\n",
        "utf8",
      );

      const first = await runMaintenanceJob({ jobName: "wiki.entities", repoRoot });
      const second = await runMaintenanceJob({ jobName: "wiki.entities", repoRoot });

      expect(first.metrics).toMatchObject({ newProposals: 1, reusedProposals: 0 });
      expect(second.metrics).toMatchObject({ newProposals: 0, reusedProposals: 1 });
      expect(second.proposals[0]?.path).toBe(first.proposals[0]?.path);

      const proposalFiles = await readdir(path.join(repoRoot, ".strata", "proposals"));
      expect(proposalFiles.filter((file) => file.endsWith(".md"))).toHaveLength(1);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("skills inventory counts .agents skills without requiring Strata-specific trigger metadata", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-maintenance-"));
    try {
      const strataSkillDir = path.join(repoRoot, ".strata", "skills", "query-wiki");
      await mkdir(strataSkillDir, { recursive: true });
      await writeFile(
        path.join(strataSkillDir, "SKILL.md"),
        "---\nname: query-wiki\ndescription: Query wiki.\n---\n# Query Wiki\n",
        "utf8",
      );
      const agentSkillDir = path.join(repoRoot, ".agents", "skills", "review-code");
      await mkdir(agentSkillDir, { recursive: true });
      await writeFile(
        path.join(agentSkillDir, "SKILL.md"),
        "---\nname: review-code\ndescription: Review code.\n---\n# Review Code\n",
        "utf8",
      );

      const result = await runMaintenanceJob({ jobName: "skills.inventory", repoRoot });

      expect(result.status).toBe("ok");
      expect(result.metrics).toMatchObject({
        skills: 2,
        strataSkills: 1,
        agentSkills: 1,
      });
      expect(
        result.findings.filter((finding) => finding.title === "Skill missing triggers"),
      ).toHaveLength(1);
      expect(result.findings[0]).toMatchObject({
        path: path.join(".strata", "skills", "query-wiki", "SKILL.md"),
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
