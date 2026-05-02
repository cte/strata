import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripAnsi } from "../packages/tui/src/ansi.js";
import { FakeTerminal } from "../packages/tui/src/terminal.js";
import { TuiRuntime } from "../packages/tui/src/runtime.js";
import { CortexApp } from "../packages/tui/src/app/app.js";

function pump(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function divider(label: string): void {
  console.log(`\n=== ${label} ===`);
}

async function main(): Promise<void> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-drive-"));
  await mkdir(path.join(repoRoot, "projects"), { recursive: true });
  await writeFile(path.join(repoRoot, "projects", "alpha.md"), "# Alpha\n\nNeedle found.\n", "utf8");
  try {
    const terminal = new FakeTerminal(80, 20);
    const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
    const app = new CortexApp(
      runtime,
      { repoRoot, provider: "openai-codex", model: "gpt-test" },
      { codexLoggedIn: false, apiKeyConfigured: false },
    );
    runtime.setRoot(app);
    runtime.start();
    await pump();

    divider("initial frame");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("/help\r");
    await pump();
    divider("after /help (overlay)");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("\r"); // dismiss help
    await pump();
    divider("after dismissing help");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("/sessions\r");
    await pump();
    divider("after /sessions");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("\x1b"); // close session selector with esc
    await pump(80);
    divider("after closing /sessions");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("/tools\r");
    await pump();
    divider("after /tools");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("/clear\r");
    await pump();
    divider("after /clear");
    console.log(stripAnsi(terminal.output));

    terminal.output = "";
    terminal.feed("/quit\r");
    await pump();
    divider("after /quit");
    console.log("running:", app.running);
  } finally {
    await rm(repoRoot, { force: true, recursive: true });
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
