import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgentLoopEvents } from "./agentLoop.js";
import type { AgentRunEvent, ModelAdapter, ModelRequest, ModelResponse } from "./types.js";

class SequenceModelAdapter implements ModelAdapter {
  readonly name = "sequence-test";
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No fake model response configured");
    }
    return response;
  }
}

describe("runAgentLoopEvents", () => {
  test("emits session, model, and tool lifecycle events", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-agent-events-"));
    try {
      await mkdir(path.join(repoRoot, "projects"), { recursive: true });
      await writeFile(path.join(repoRoot, "projects", "alpha.md"), "# Alpha\n\nNeedle found.\n", "utf8");

      const model = new SequenceModelAdapter([
        {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            { id: "call_1", name: "wiki.search", argumentsText: JSON.stringify({ query: "Needle" }) },
          ],
        },
        {
          content: "Needle is documented.",
          finishReason: "stop",
          toolCalls: [],
        },
      ]);

      const events: AgentRunEvent[] = [];
      for await (const event of runAgentLoopEvents({
        question: "Where is Needle documented?",
        model,
        repoRoot,
      })) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("session.started");
      expect(types).toContain("message.user");
      expect(types).toContain("model.request");
      expect(types).toContain("model.response");
      expect(types).toContain("tool.call.started");
      expect(types).toContain("tool.call.completed");
      expect(types).toContain("agent.completed");

      const completion = events.find((e) => e.type === "agent.completed");
      expect(completion?.type === "agent.completed" && completion.result.status).toBe("completed");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
