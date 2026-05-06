import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@cortex/core";
import { FakeTerminal, stripAnsi, TuiRuntime, visibleWidth } from "@cortex/tui";
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
  test("/sessions opens a focused picker and Esc dismisses it", async () => {
    const ctx = await setupApp();
    try {
      ctx.terminal.output = "";
      ctx.terminal.feed("/sessions\r");
      await pump();
      const opened = stripAnsi(ctx.terminal.output);
      const openedFrame = stripAnsi(
        ctx.app.render({ width: ctx.terminal.columns, height: ctx.terminal.rows }).lines.join("\n"),
      );
      expect(opened).toContain("Resume session");
      expect(opened).toContain("(no sessions yet)");
      expect(openedFrame).toContain("Resume session");
      expect(openedFrame).toContain("(no sessions yet)");
      expect(opened).not.toContain("─ sessions ─");
      expect(ctx.terminal.output).not.toContain("\x1b[2J");
      expect(ctx.terminal.output).not.toContain("\x1b[3J");

      ctx.terminal.output = "";
      ctx.terminal.feed("\x1b");
      await pump(80);
      const dismissedFrame = stripAnsi(
        ctx.app.render({ width: ctx.terminal.columns, height: ctx.terminal.rows }).lines.join("\n"),
      );
      expect(dismissedFrame).not.toContain("Resume session");
      expect(dismissedFrame).toContain("›");
    } finally {
      await ctx.cleanup();
    }
  });

  test("/sessions remains stable through repeated Down keypresses", async () => {
    const ctx = await setupApp(148, 34);
    const store = await SessionStore.open(ctx.repoRoot);
    try {
      for (let i = 0; i < 30; i += 1) {
        const session = await store.createSession({
          kind: "query",
          title: `session ${String(i).padStart(2, "0")}`,
          model: "gpt-test",
        });
        await store.endSession(session.id, "completed");
      }

      ctx.terminal.output = "";
      ctx.terminal.feed("/sessions\r");
      await pump();
      ctx.terminal.output = "";

      for (let i = 0; i < 16; i += 1) {
        ctx.terminal.feed("\x1b[B");
        await pump(30);
      }

      const rawOutput = ctx.terminal.output;
      const output = stripAnsi(rawOutput);
      const frame = stripAnsi(
        ctx.app.render({ width: ctx.terminal.columns, height: ctx.terminal.rows }).lines.join("\n"),
      );
      expect(frame).toContain("(17/30)");
      expect(frame).toContain("session");
      expect(frame).not.toContain("›");
      expect(output).not.toContain("›");
      const pickerFragments = rawOutput
        .split(/\x1b\[\d+;1H|\r\n|\r|\n/)
        .map((line) => stripAnsi(line))
        .filter((line) => /session \d{2}/.test(line));
      expect(pickerFragments.length).toBeGreaterThan(0);
      expect(pickerFragments.every((line) => visibleWidth(line) <= ctx.terminal.columns)).toBe(
        true,
      );
      expect(rawOutput).not.toContain("\x1b[1;1H");
      expect(rawOutput).not.toContain("\x1b[2J");
      expect(rawOutput).not.toContain("\x1b[3J");
    } finally {
      store.close();
      await ctx.cleanup();
    }
  });

  test("/sessions does not emit terminal controls stored in session titles", async () => {
    const ctx = await setupApp(120, 24);
    const store = await SessionStore.open(ctx.repoRoot);
    try {
      const session = await store.createSession({
        kind: "query",
        title: "bad \x1b[99;5u title \x1b]2;owned\x07 ok",
        model: "gpt-test",
      });
      await store.endSession(session.id, "completed");

      ctx.terminal.output = "";
      ctx.terminal.feed("/sessions\r");
      await pump();

      expect(ctx.terminal.output).not.toContain("\x1b[99;5u");
      expect(ctx.terminal.output).not.toContain("\x1b]2;owned\x07");
      expect(stripAnsi(ctx.terminal.output)).toContain("bad title ok");
    } finally {
      store.close();
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
