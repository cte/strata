import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgentLoopEvents } from "@cortex/agent/agent-loop";
import type { AgentRunEvent, ModelAdapter, ModelRequest, ModelResponse } from "@cortex/agent/types";
import { FakeTerminal, TuiRuntime, stripAnsi } from "@cortex/tui";
import { CortexApp } from "@cortex/tui/internal/app";

class ScriptedModel implements ModelAdapter {
  readonly name = "scripted";
  private index = 0;
  constructor(private readonly responses: ModelResponse[]) {}
  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("ScriptedModel exhausted");
    }
    return response;
  }
}

function pump(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("tui ↔ agent loop integration", () => {
  test("agent events render tool call and assistant response in transcript", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-agentrun-"));
    await mkdir(path.join(repoRoot, "projects"), { recursive: true });
    await writeFile(path.join(repoRoot, "projects", "alpha.md"), "# Alpha\n\nNeedle.\n", "utf8");

    const terminal = new FakeTerminal(80, 24);
    const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
    const app = new CortexApp(
      runtime,
      { repoRoot, provider: "openai-compatible", model: "fake-model" },
      { codexLoggedIn: false, apiKeyConfigured: true },
    );
    runtime.setRoot(app);
    runtime.start();
    await pump();

    const model = new ScriptedModel([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          { id: "c1", name: "wiki.search", argumentsText: JSON.stringify({ query: "Needle" }) },
        ],
      },
      {
        content: "Found Needle in `projects/alpha.md`.",
        finishReason: "stop",
        toolCalls: [],
      },
    ]);

    // applyAgentEvent is internal but is the seam runAgent() uses to fold loop
    // events into transcript state. Drive it directly to keep the e2e test
    // independent of model factory wiring.
    const internal = app as unknown as { applyAgentEvent: (event: AgentRunEvent) => void };

    try {
      for await (const event of runAgentLoopEvents({
        question: "Where is Needle?",
        model,
        repoRoot,
      })) {
        internal.applyAgentEvent(event);
        runtime.invalidate();
        await pump(10);
      }
      await pump();

      const output = stripAnsi(terminal.output);
      expect(output).toContain("wiki.search");
      expect(output).toContain("Found Needle");
      expect(output).toContain("cortex");
    } finally {
      runtime.stop();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
