import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listTodos, readMemoryDocument, SessionStore } from "@cortex/core";
import { ReflectionError, runReflection } from "./reflection.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

class JsonReflectionModel implements ModelAdapter {
  readonly name = "reflection-test";
  readonly requests: ModelRequest[] = [];

  constructor(private readonly payload: unknown) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const { onAssistantDelta: _omit, ...rest } = request;
    this.requests.push(structuredClone(rest));
    return {
      content: JSON.stringify(this.payload),
      finishReason: "stop",
      toolCalls: [],
    };
  }
}

describe("runReflection", () => {
  test("applies low-risk memory and todo updates and stages proposals", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-reflection-"));
    try {
      const sessionId = await createCompletedSession(repoRoot);
      const model = new JsonReflectionModel({
        memory_updates: [
          {
            target: "operations",
            entry: "Cortex reflection tests use deterministic fake model output.",
            reason: "The session established a reusable test convention.",
            evidence: ["message.user"],
            risk: "low",
          },
        ],
        todo_updates: [
          {
            action: "add",
            title: "Review staged reflection proposal",
            notes: "Check whether the proposed skill update should become durable.",
            priority: "normal",
            due: null,
            tags: ["reflection"],
            reason: "The model proposed a skill update requiring review.",
            evidence: ["model.response"],
            risk: "low",
          },
        ],
        skill_updates: [
          {
            title: "Update reflection skill",
            reason: "A reusable reflection pitfall was observed.",
            evidence: ["tool.result"],
            proposed_change: "Add a pitfall about duplicate memory entries.",
            risk: "medium",
          },
        ],
        schema_updates: [],
        wiki_followups: [],
        lint_findings: [],
        noops: [],
      });

      const first = await runReflection({ repoRoot, sessionId, model });
      expect(model.requests).toHaveLength(1);
      expect(model.requests[0]?.tools).toEqual([]);
      expect(model.requests[0]?.messages.at(-1)?.content).toContain("Session trace JSONL");
      expect(first.applied).toHaveLength(2);
      expect(first.proposals).toHaveLength(1);
      expect(first.reportPath).toBe(`.cortex/reports/reflections/${sessionId}.json`);

      const memory = await readMemoryDocument(repoRoot, "operations", Number.POSITIVE_INFINITY);
      expect(memory.content).toContain("deterministic fake model output");
      const todos = await listTodos(repoRoot, true);
      expect(todos.map((todo) => todo.title)).toEqual(["Review staged reflection proposal"]);

      const proposalPath = path.join(repoRoot, first.proposals[0]?.path ?? "");
      const proposal = await readFile(proposalPath, "utf8");
      expect(proposal).toContain("kind: skill");
      expect(proposal).toContain("Add a pitfall about duplicate memory entries.");

      const trace = await readFile(
        path.join(repoRoot, ".cortex", "traces", `${sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("reflection.started");
      expect(trace).toContain("proposal.created");
      expect(trace).toContain("reflection.completed");

      const second = await runReflection({ repoRoot, sessionId, model });
      expect(second.applied).toHaveLength(0);
      expect(second.skipped.map((item) => item.reason)).toEqual(["duplicate", "duplicate"]);
      const updatedMemory = await readMemoryDocument(
        repoRoot,
        "operations",
        Number.POSITIVE_INFINITY,
      );
      expect(countOccurrences(updatedMemory.content, "deterministic fake model output")).toBe(1);
      expect(await listTodos(repoRoot, true)).toHaveLength(1);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("rejects running sessions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-reflection-"));
    try {
      const store = await SessionStore.open(repoRoot);
      let sessionId = "";
      try {
        const session = await store.createSession({ kind: "query", title: "Still running" });
        sessionId = session.id;
      } finally {
        store.close();
      }

      const model = new JsonReflectionModel({});
      await expect(runReflection({ repoRoot, sessionId, model })).rejects.toThrow(ReflectionError);
      expect(model.requests).toHaveLength(0);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function createCompletedSession(repoRoot: string): Promise<string> {
  const store = await SessionStore.open(repoRoot);
  try {
    const session = await store.createSession({ kind: "query", title: "Reflection fixture" });
    await store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: "Capture the durable lesson from this run.",
    });
    await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "The durable lesson is in the tool output.",
    });
    await store.appendEvent(session.id, "tool.result", {
      ok: true,
      result: { lesson: "duplicate memory entries should be avoided" },
    });
    await store.endSession(session.id, "completed");
    return session.id;
  } finally {
    store.close();
  }
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}
