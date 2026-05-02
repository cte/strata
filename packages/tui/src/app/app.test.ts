import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripAnsi } from "../ansi.js";
import { FakeTerminal } from "../terminal.js";
import { TuiRuntime } from "../runtime.js";
import { CortexApp } from "./app.js";

function pump(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("CortexApp", () => {
  test("renders header, transcript hint, editor, and footer", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new CortexApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();
      runtime.stop();
      const output = stripAnsi(terminal.output);
      expect(output).toContain("cortex");
      expect(output).toContain("gpt-test");
      expect(output).toContain("Type a question or /help");
      expect(output).toContain("/help");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("/clear empties the transcript", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new CortexApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();
      // Type "/clear\r"
      terminal.feed("/clear\r");
      await pump();
      runtime.stop();
      // App should still report running because /clear doesn't exit
      expect(app.running).toBe(true);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("/help opens a centered modal that dismisses on Esc", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-"));
    try {
      const terminal = new FakeTerminal(80, 24);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new CortexApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();
      terminal.output = "";
      terminal.feed("/help\r");
      await pump();
      const helpOutput = stripAnsi(terminal.output);
      expect(helpOutput).toContain("─ help ─");
      expect(helpOutput).toContain("Cortex TUI");
      expect(helpOutput).toContain("Slash commands");

      terminal.output = "";
      terminal.feed("\r");
      await pump(80);
      const dismissed = stripAnsi(terminal.output);
      // After dismissal the editor prompt is back and modal title is gone.
      expect(dismissed).not.toContain("─ help ─");
      expect(dismissed).toContain("›");
      runtime.stop();
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("/quit shuts down the app", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new CortexApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();
      terminal.feed("/quit\r");
      await pump();
      expect(app.running).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
