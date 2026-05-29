import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listPromptVisibleSkills, listSkills, readSkill } from "../skillStore.js";

describe("skillStore", () => {
  test("discovers .agents skills and keeps .strata skills first on name collisions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-skills-"));
    try {
      await writeSkill(
        repoRoot,
        ".agents/skills/query-wiki",
        "query-wiki",
        "Agent skill version.",
        "Agent skill body.",
      );
      await writeSkill(
        repoRoot,
        ".strata/skills/query-wiki",
        "query-wiki",
        "Strata skill version.",
        "Strata skill body.",
      );
      await writeSkill(
        repoRoot,
        ".agents/skills/review-code",
        "review-code",
        "Review code changes.",
        "Review body.",
      );

      const skills = await listSkills(repoRoot);
      expect(skills.map((skill) => skill.name)).toEqual(["query-wiki", "review-code"]);
      expect(skills.find((skill) => skill.name === "query-wiki")).toMatchObject({
        source: "strata",
        path: path.join(".strata", "skills", "query-wiki", "SKILL.md"),
      });
      expect(skills.find((skill) => skill.name === "review-code")).toMatchObject({
        source: "agents",
        path: path.join(".agents", "skills", "review-code", "SKILL.md"),
      });

      await expect(readSkill(repoRoot, "query-wiki")).resolves.toMatchObject({
        content: expect.stringContaining("Strata skill body."),
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("recurses for nested .agents skills, ignores root markdown, and hides manual-only skills from prompt index", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-skills-"));
    try {
      await mkdir(path.join(repoRoot, ".agents", "skills"), { recursive: true });
      await writeFile(
        path.join(repoRoot, ".agents", "skills", "root-skill.md"),
        "---\nname: root-skill\ndescription: ignored\n---\n",
        "utf8",
      );
      await writeSkill(
        repoRoot,
        ".agents/skills/vendor/deep-skill",
        "deep-skill",
        "Nested skill.",
        "Nested body.",
      );
      await writeSkill(
        repoRoot,
        ".agents/skills/manual-only",
        "manual-only",
        "Only via explicit command.",
        "Manual body.",
        { disableModelInvocation: true },
      );

      await expect(listSkills(repoRoot)).resolves.toMatchObject([
        { name: "deep-skill", source: "agents" },
        { name: "manual-only", disableModelInvocation: true },
      ]);
      await expect(listPromptVisibleSkills(repoRoot)).resolves.toMatchObject([
        { name: "deep-skill" },
      ]);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function writeSkill(
  repoRoot: string,
  relativeDir: string,
  name: string,
  description: string,
  body: string,
  options: { disableModelInvocation?: boolean } = {},
): Promise<void> {
  const skillDir = path.join(repoRoot, relativeDir);
  await mkdir(skillDir, { recursive: true });
  const frontmatter = [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...(options.disableModelInvocation === true ? ["disable-model-invocation: true"] : []),
    "---",
    "",
  ].join("\n");
  await writeFile(path.join(skillDir, "SKILL.md"), `${frontmatter}${body}\n`, "utf8");
}
