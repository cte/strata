import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { listMaintenanceJobs, runMaintenanceJob } from "./maintenance.js";

describe("maintenance jobs", () => {
  test("lists the initial manual maintenance jobs", () => {
    expect(listMaintenanceJobs().map((job) => job.name)).toEqual([
      "wiki.lint",
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
