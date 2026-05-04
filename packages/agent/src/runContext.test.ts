import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addTodo, writeMemoryDocument } from "@cortex/core";
import { buildRunContext } from "./runContext.js";

describe("buildRunContext", () => {
  test("injects memory, active todos, and skill index", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-run-context-"));
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
      const skillDir = path.join(repoRoot, ".cortex", "skills", "query-wiki");
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

      const context = await buildRunContext({
        question: "What matters now?",
        repoRoot,
      });

      expect(context.messages).toHaveLength(3);
      expect(context.messages[0]?.content).toContain("You are Cortex");
      expect(context.messages[1]?.content).toContain("Prefers concise engineering updates");
      expect(context.messages[1]?.content).toContain("Finish learning-state tools");
      expect(context.messages[1]?.content).toContain("query-wiki");
      expect(context.messages[2]).toEqual({ role: "user", content: "What matters now?" });
      expect(context.systemContext).toMatchObject({
        activeTodos: [{ title: "Finish learning-state tools" }],
        skills: [{ name: "query-wiki" }],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
