import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { createDefaultToolRegistry } from "../index.js";

describe("learning-state tools", () => {
  test("manages runtime todos with read and learning profiles", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-learning-tools-"));
    try {
      const readOnly = createDefaultToolRegistry({ profile: "read-only" });
      const addDenied = await readOnly.safeExecute(
        "todo.add",
        { title: "Write a plan" },
        { repoRoot },
      );
      expect(addDenied.ok).toBe(false);
      if (!addDenied.ok) {
        expect(addDenied.error.code).toBe("tool_unavailable");
      }

      const registry = createDefaultToolRegistry({ profile: "learning" });
      const added = (await registry.execute(
        "todo.add",
        { title: "Write a plan", priority: "high", tags: ["roadmap"] },
        { repoRoot },
      )) as { item: { id: string; title: string; priority: string } };
      expect(added.item).toMatchObject({
        title: "Write a plan",
        priority: "high",
      });

      await expect(registry.execute("todo.list", {}, { repoRoot })).resolves.toMatchObject({
        count: 1,
        items: [{ title: "Write a plan" }],
      });

      await registry.execute(
        "todo.update",
        { id: added.item.id, status: "done", notes: "Captured in docs." },
        { repoRoot },
      );
      await expect(registry.execute("todo.list", {}, { repoRoot })).resolves.toMatchObject({
        count: 0,
      });
      await expect(
        registry.execute("todo.list", { includeDone: true }, { repoRoot }),
      ).resolves.toMatchObject({
        count: 1,
        items: [{ status: "done", notes: "Captured in docs." }],
      });

      await registry.execute("todo.remove", { id: added.item.id }, { repoRoot });
      await expect(
        registry.execute("todo.list", { includeDone: true }, { repoRoot }),
      ).resolves.toMatchObject({
        count: 0,
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reads, writes, and appends bounded memory documents", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-learning-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "learning" });

      await expect(registry.execute("memory.read", {}, { repoRoot })).resolves.toMatchObject({
        count: 2,
        documents: [
          { target: "user", exists: false, content: "" },
          { target: "operations", exists: false, content: "" },
        ],
      });

      await registry.execute(
        "memory.write",
        { target: "user", content: "# User Memory\n\n- Prefers concise engineering updates.\n" },
        { repoRoot },
      );
      await expect(
        registry.execute("memory.read", { target: "user" }, { repoRoot }),
      ).resolves.toMatchObject({
        documents: [{ target: "user", exists: true, content: expect.stringContaining("concise") }],
      });

      await registry.execute(
        "memory.append",
        { target: "operations", heading: "Repo", entry: "Use Bun workspace commands." },
        { repoRoot },
      );
      expect(
        await readFile(path.join(repoRoot, ".strata", "memory", "OPERATIONS.md"), "utf8"),
      ).toBe("# Operations Memory\n\n## Repo\n\n- Use Bun workspace commands.\n");

      const tooLarge = await registry.safeExecute(
        "memory.append",
        { target: "operations", entry: "This should not fit.", maxChars: 20 },
        { repoRoot },
      );
      expect(tooLarge.ok).toBe(false);
      if (!tooLarge.ok) {
        expect(tooLarge.error.code).toBe("memory_too_large");
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("exposes session recall tools", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-learning-tools-"));
    try {
      const store = await SessionStore.open(repoRoot);
      let currentSessionId = "";
      try {
        const alpha = await store.createSession({ kind: "query", title: "Alpha research" });
        await store.appendMessage({
          sessionId: alpha.id,
          role: "user",
          content: "Find the durable Alpha decision.",
        });
        await store.endSession(alpha.id, "completed");

        const current = await store.createSession({ kind: "query", title: "Current session" });
        currentSessionId = current.id;
        await store.appendMessage({
          sessionId: current.id,
          role: "user",
          content: "Alpha appears here too, but current sessions are excluded by default.",
        });
      } finally {
        store.close();
      }

      const registry = createDefaultToolRegistry();
      await expect(
        registry.execute(
          "sessions.search",
          { query: "Alpha", limit: 10 },
          { repoRoot, sessionId: currentSessionId },
        ),
      ).resolves.toMatchObject({
        count: 1,
        sessions: [{ title: "Alpha research" }],
      });
      await expect(
        registry.execute(
          "sessions.recent",
          { limit: 1 },
          { repoRoot, sessionId: currentSessionId },
        ),
      ).resolves.toMatchObject({
        count: 1,
        sessions: [{ title: "Alpha research" }],
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists and reads procedural skills", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-learning-tools-"));
    try {
      const skillDir = path.join(repoRoot, ".strata", "skills", "query-wiki");
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        path.join(skillDir, "SKILL.md"),
        [
          "---",
          "name: query-wiki",
          "description: Answer wiki questions with citations.",
          "status: active",
          "triggers:",
          "  - wiki question",
          "---",
          "",
          "# Query Wiki",
          "",
          "Use wiki.search before wiki.readPage.",
          "",
        ].join("\n"),
        "utf8",
      );

      const registry = createDefaultToolRegistry();
      await expect(registry.execute("skills.list", {}, { repoRoot })).resolves.toMatchObject({
        count: 1,
        skills: [
          {
            name: "query-wiki",
            description: "Answer wiki questions with citations.",
            triggers: ["wiki question"],
          },
        ],
      });
      await expect(
        registry.execute("skills.read", { name: "query-wiki", maxChars: 40 }, { repoRoot }),
      ).resolves.toMatchObject({
        skill: {
          metadata: { name: "query-wiki" },
          truncated: true,
          content: expect.stringContaining("query-wiki"),
        },
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
