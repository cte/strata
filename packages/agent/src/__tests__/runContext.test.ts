import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addTodo, writeMemoryDocument } from "@strata/core";
import { buildRunContext } from "../runContext.js";

describe("buildRunContext", () => {
  test("injects memory, active todos, and skill index", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-run-context-"));
    try {
      await writeMemoryDocument(
        repoRoot,
        "user",
        "# User Memory\n\n- Prefers concise engineering updates.\n",
      );
      await addTodo(repoRoot, {
        title: "Finish learning-state tools",
        priority: "high",
        tags: ["roadmap"],
      });
      await writeFile(
        path.join(repoRoot, "AGENTS.md"),
        "# Project Instructions\n\nUse the repository toolchain instructions.\n",
        "utf8",
      );
      const skillDir = path.join(repoRoot, ".strata", "skills", "query-wiki");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: query-wiki",
          "description: Answer wiki questions with citations.",
          "triggers:",
          "  - wiki question",
          "---",
          "",
          "# Query Wiki",
          "",
        ].join("\n"),
        "utf8",
      );
      const agentSkillDir = path.join(repoRoot, ".agents", "skills", "review-code");
      await mkdir(agentSkillDir, { recursive: true });
      await writeFile(
        path.join(agentSkillDir, "SKILL.md"),
        [
          "---",
          "name: review-code",
          "description: Review code changes.",
          "---",
          "",
          "# Review Code",
          "",
        ].join("\n"),
        "utf8",
      );
      const manualSkillDir = path.join(repoRoot, ".agents", "skills", "manual-only");
      await mkdir(manualSkillDir, { recursive: true });
      await writeFile(
        path.join(manualSkillDir, "SKILL.md"),
        [
          "---",
          "name: manual-only",
          "description: Explicit command only.",
          "disable-model-invocation: true",
          "---",
          "",
          "# Manual Only",
          "",
        ].join("\n"),
        "utf8",
      );

      const context = await buildRunContext({
        question: "What matters now?",
        repoRoot,
      });

      expect(context.messages).toHaveLength(3);
      expect(context.messages[0]?.content).toContain("You are Strata");
      expect(context.messages[1]?.content).toContain("Use the repository toolchain instructions");
      expect(context.messages[1]?.content).toContain("Prefers concise engineering updates");
      expect(context.messages[1]?.content).toContain("Finish learning-state tools");
      expect(context.messages[1]?.content).toContain("query-wiki");
      expect(context.messages[1]?.content).toContain("review-code");
      expect(context.messages[1]?.content).not.toContain("manual-only");
      expect(context.messages[2]).toEqual({ role: "user", content: "What matters now?" });
      expect(context.systemContext).toMatchObject({
        agentInstructions: [{ path: "AGENTS.md" }],
        activeTodos: [{ title: "Finish learning-state tools" }],
        skills: [{ name: "query-wiki" }, { name: "review-code" }],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
