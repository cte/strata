import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripAnsi } from "../packages/tui/src/ansi.js";
import { FakeTerminal } from "../packages/tui/src/terminal.js";
import { TuiRuntime } from "../packages/tui/src/runtime.js";
import { CortexApp } from "../packages/tui/src/app/app.js";
import type { ModelAdapter, ModelRequest, ModelResponse } from "../packages/agent/src/types.js";

class ScriptedModel implements ModelAdapter {
  readonly name = "scripted";
  private index = 0;
  constructor(private readonly responses: ModelResponse[]) {}
  async complete(_request: ModelRequest): Promise<ModelResponse> {
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No more scripted responses");
    }
    return response;
  }
}

function pump(ms = 80): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-agentrun-"));
  await mkdir(path.join(repoRoot, "projects"), { recursive: true });
  await writeFile(path.join(repoRoot, "projects", "alpha.md"), "# Alpha\n\nNeedle.\n", "utf8");

  try {
    const terminal = new FakeTerminal(80, 20);
    const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
    const app = new CortexApp(
      runtime,
      { repoRoot, provider: "openai-compatible", model: "fake-model" },
      { codexLoggedIn: false, apiKeyConfigured: true },
    );

    // Inject scripted model factory by overriding behavior
    // (We simply call onSubmit with text and route through runAgent which calls createModelAdapter.
    // For this drive, we patch the controller to use a scripted model.)
    const scripted = new ScriptedModel([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "c1", name: "wiki.search", argumentsText: JSON.stringify({ query: "Needle" }) }],
      },
      { content: "Found Needle in `projects/alpha.md`.", finishReason: "stop", toolCalls: [] },
    ]);

    // Monkey-patch createModelAdapter on the imported module is brittle; instead drive runAgentLoopEvents
    // directly through the app's applyAgentEvent by simulating events. Use the public agent loop:
    const { runAgentLoopEvents } = await import("../packages/agent/src/agentLoop.js");

    runtime.setRoot(app);
    runtime.start();
    await pump();
    console.log("=== initial frame ===");
    console.log(stripAnsi(terminal.output));

    // Drive events directly to validate transcript rendering
    const events = runAgentLoopEvents({
      question: "Where is Needle?",
      model: scripted,
      repoRoot,
    });
    terminal.output = "";
    // Mark the user message manually by feeding the editor and submitting:
    // Easier: directly push into transcript via the public agent stream.
    type AnyApp = CortexApp & { applyAgentEvent: (e: unknown) => void; state: unknown };
    const internal = app as unknown as AnyApp;
    // appendTranscript user
    (internal as unknown as { state: { transcript: unknown[] } }).state.transcript.push({
      kind: "user",
      content: "Where is Needle?",
    });
    runtime.invalidate();
    await pump();
    console.log("\n=== user message in transcript ===");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    for await (const event of events) {
      internal.applyAgentEvent(event);
      runtime.invalidate();
      await pump(10);
    }
    await pump();
    console.log("\n=== after agent run ===");
    console.log(stripAnsi(terminal.output));

    runtime.stop();
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
