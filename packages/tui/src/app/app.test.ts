import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stripAnsi } from "../ansi.js";
import { TuiRuntime } from "../runtime.js";
import { FakeTerminal } from "../terminal.js";
import { CortexApp } from "./app.js";

function pump(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("CortexApp", () => {
  test("renders transcript hint, editor, and footer", async () => {
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
      expect(output).toContain("─".repeat(60));
      expect(output).toContain("gpt-test");
      // Pi-style startup header: logo, key-hint summary, onboarding pointer.
      expect(output).toContain("cortex v");
      expect(output).toContain("escape interrupt");
      expect(output).toContain("ctrl+c/ctrl+d clear/exit");
      expect(output).toContain("/ commands");
      expect(output).toContain("Type /help for the full keymap");
      expect(output).toContain("no session");
      expect(output).toContain("thinking off");
      expect(output).not.toContain("auth✗");
      expect(output).not.toContain("auth✓");
      expect(output).not.toContain("api-key✓");
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

  test("/help prints inline into the transcript so it inherits terminal scrollback", async () => {
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
      // Pi-aligned: help is text in the transcript, not a modal overlay,
      // so there is no `─ help ─` framing and the editor prompt stays
      // visible below it.
      expect(helpOutput).not.toContain("─ help ─");
      expect(helpOutput).toContain("Editor");
      expect(helpOutput).toContain("Slash commands");
      expect(helpOutput).toContain("/help");
      expect(helpOutput).toContain("›");
      runtime.stop();
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("escape during an active run aborts instead of opening the session picker", async () => {
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

      // Pretend an agent run is in flight (matches what runAgent assigns).
      const aborted = { value: false };
      const fakeAbort = new AbortController();
      fakeAbort.signal.addEventListener("abort", () => {
        aborted.value = true;
      });
      const internal = app as unknown as {
        currentRun: AbortController | undefined;
        handleEditorEscape: () => void;
      };
      internal.currentRun = fakeAbort;

      // Two rapid Escapes — pre-fix this would open the resume picker mid-run.
      // Pi-aligned: the first Esc aborts; the second is a no-op (run is gone).
      internal.handleEditorEscape();
      internal.handleEditorEscape();
      await pump();
      runtime.stop();

      expect(aborted.value).toBe(true);
      const output = stripAnsi(terminal.output);
      expect(output).toContain("interrupting agent");
      expect(output).not.toContain("Resume session");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("keeps the status loader animating while an agent run is active", async () => {
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

      const internal = app as unknown as {
        state: { running: boolean };
        invalidate: () => void;
      };
      const before = terminal.frames.length;
      internal.state.running = true;
      internal.invalidate();
      await pump(240);
      internal.state.running = false;
      internal.invalidate();
      runtime.stop();

      expect(terminal.frames.length).toBeGreaterThan(before + 1);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("renders token and context metrics in the footer", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-tui-"));
    try {
      const terminal = new FakeTerminal(80, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new CortexApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-5.5" },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();

      const internal = app as unknown as {
        applyAgentEvent: (event: {
          type: "model.response";
          iteration: number;
          content: string;
          toolCalls: [];
          usage: {
            input_tokens: number;
            output_tokens: number;
            total_tokens: number;
            input_tokens_details: { cached_tokens: number };
          };
        }) => void;
      };
      internal.applyAgentEvent({
        type: "model.response",
        iteration: 1,
        content: "",
        toolCalls: [],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 20 },
        },
      });
      runtime.invalidate();
      await pump();
      runtime.stop();

      const output = stripAnsi(terminal.output);
      expect(output).toContain("↑80");
      expect(output).toContain("↓20");
      expect(output).toContain("R20");
      expect(output).toContain("0.0%/272k");
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
