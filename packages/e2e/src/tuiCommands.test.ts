import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FakeTerminal, TuiRuntime, stripAnsi } from "@cortex/tui";
import { CortexApp } from "@cortex/tui/internal/app";

function pump(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupApp(width = 80, height = 20) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-e2e-"));
  const terminal = new FakeTerminal(width, height);
  const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
  const app = new CortexApp(
    runtime,
    { repoRoot, provider: "openai-codex", model: "gpt-test" },
    { codexLoggedIn: false, apiKeyConfigured: false },
  );
  runtime.setRoot(app);
  runtime.start();
  await pump();
  return {
    repoRoot,
    terminal,
    runtime,
    app,
    cleanup: async () => {
      runtime.stop();
      await rm(repoRoot, { force: true, recursive: true });
    },
  };
}

describe("tui slash commands", () => {
  test("/sessions opens an overlay and Esc dismisses it", async () => {
    const ctx = await setupApp();
    try {
      ctx.terminal.output = "";
      ctx.terminal.feed("/sessions\r");
      await pump();
      const opened = stripAnsi(ctx.terminal.output);
      expect(opened).toContain("─ sessions ─");
      expect(opened).toContain("No sessions yet.");

      ctx.terminal.output = "";
      ctx.terminal.feed("\x1b");
      await pump(80);
      const dismissed = stripAnsi(ctx.terminal.output);
      expect(dismissed).not.toContain("─ sessions ─");
      expect(dismissed).toContain("›");
    } finally {
      await ctx.cleanup();
    }
  });

  test("/tools lists registered tool names in the transcript", async () => {
    const ctx = await setupApp();
    try {
      ctx.terminal.output = "";
      ctx.terminal.feed("/tools\r");
      await pump(120);
      const out = stripAnsi(ctx.terminal.output);
      expect(out).toContain("fs.find");
      expect(out).toContain("shell.run");
      expect(out).toContain("wiki.readPage");
    } finally {
      await ctx.cleanup();
    }
  });
});
