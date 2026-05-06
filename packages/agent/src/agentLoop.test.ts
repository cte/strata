import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@cortex/core";
import { createDefaultToolRegistry } from "@cortex/tools";
import { runAgentLoop } from "./agentLoop.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

class SequenceModelAdapter implements ModelAdapter {
  readonly name = "sequence-test";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    // Drop the streaming callback before snapshotting — structuredClone
    // can't clone functions, and the test only inspects message/tool data.
    const { onAssistantDelta: _omit, ...rest } = request;
    this.requests.push(structuredClone(rest));
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No fake model response configured");
    }
    return response;
  }
}

describe("runAgentLoop", () => {
  test("runs a sequential tool loop and persists traces", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-"));
    try {
      await mkdir(path.join(repoRoot, "projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "projects", "alpha.md"),
        "# Alpha\n\nNeedle found.\n",
        "utf8",
      );

      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "wiki.search",
              argumentsText: JSON.stringify({ query: "Needle" }),
            },
          ],
        },
        {
          content: "Needle is documented in projects/alpha.md.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Where is Needle documented?",
        model,
        repoRoot,
      });

      expect(result.status).toBe("completed");
      expect(result.stoppedReason).toBe("final_answer");
      expect(result.toolCalls).toBe(1);
      expect(model.requests).toHaveLength(2);
      expect(model.requests[1]?.messages.at(-1)).toMatchObject({ role: "tool" });

      const trace = await readFile(
        path.join(repoRoot, ".cortex", "traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("message.system_context");
      expect(trace).toContain("model.response");
      expect(trace).toContain("tool.call");
      expect(trace).toContain("tool.result");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("returns tool errors to the model", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "wiki.missing",
              argumentsText: "{}",
            },
          ],
        },
        {
          content: "The requested tool is unavailable.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Use a missing tool.",
        model,
        repoRoot,
      });

      expect(result.status).toBe("completed");
      const toolMessage = model.requests[1]?.messages.at(-1);
      expect(toolMessage?.role).toBe("tool");
      expect(toolMessage?.content).toContain("unknown_tool");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("sanitizes terminal controls from generated session titles", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "Done.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "bad \x1b[99;5u title \x1b]2;owned\x07 ok",
        model,
        repoRoot,
      });

      const store = await SessionStore.open(repoRoot);
      try {
        const session = store.getSession(result.sessionId);
        expect(session?.title).toBe("bad title ok");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("returns invalid tool argument errors to the model", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "wiki.search",
              argumentsText: "[]",
            },
          ],
        },
        {
          content: "The tool arguments were invalid.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Use invalid tool args.",
        model,
        repoRoot,
      });

      expect(result.status).toBe("completed");
      const toolMessage = model.requests[1]?.messages.at(-1);
      expect(toolMessage?.role).toBe("tool");
      expect(toolMessage?.content).toContain("invalid_tool_args");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("records file-change events for write tools", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-"));
    try {
      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: "call_1",
              name: "fs.write",
              argumentsText: JSON.stringify({
                path: "notes/alpha.md",
                content: "# Alpha\n",
                createDirs: true,
              }),
            },
          ],
        },
        {
          content: "Wrote notes/alpha.md.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const result = await runAgentLoop({
        question: "Create an alpha note.",
        model,
        repoRoot,
        tools: createDefaultToolRegistry({ profile: "maintenance" }),
      });

      expect(result.status).toBe("completed");
      expect(await readFile(path.join(repoRoot, "notes", "alpha.md"), "utf8")).toBe("# Alpha\n");

      const trace = await readFile(
        path.join(repoRoot, ".cortex", "traces", `${result.sessionId}.jsonl`),
        "utf8",
      );
      expect(trace).toContain("file.changed");
      expect(trace).toContain("notes/alpha.md");
      expect(trace).toContain("sha256:");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("continueSessionId seeds prior turns into the model context", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-"));
    try {
      const firstModel = new SequenceModelAdapter([
        { content: "Hi, I'm Cortex.", finishReason: "stop", toolCalls: [] },
      ]);
      const first = await runAgentLoop({
        question: "Who are you?",
        model: firstModel,
        repoRoot,
      });
      expect(first.status).toBe("completed");

      const secondModel = new SequenceModelAdapter([
        {
          content: "I just told you: Cortex.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);
      const second = await runAgentLoop({
        question: "What did you just say?",
        model: secondModel,
        repoRoot,
        continueSessionId: first.sessionId,
      });

      expect(second.sessionId).toBe(first.sessionId);

      // The seed for the second run should include both the prior user
      // question and the prior assistant reply, plus the new user turn.
      const seeded = secondModel.requests[0]?.messages ?? [];
      const nonSystem = seeded.filter((m) => m.role !== "system");
      expect(nonSystem.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(nonSystem[0]?.content).toBe("Who are you?");
      expect(nonSystem[1]?.content).toBe("Hi, I'm Cortex.");
      expect(nonSystem[2]?.content).toBe("What did you just say?");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
