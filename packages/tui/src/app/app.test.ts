import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { stripAnsi } from "../ansi.js";
import { TuiRuntime } from "../runtime.js";
import { FakeTerminal } from "../terminal.js";
import { StrataApp } from "./app.js";

function pump(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("StrataApp", () => {
  test("initial --continue resumes the most recent session", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    const store = await SessionStore.open(repoRoot);
    try {
      const oldSession = await store.createSession({ kind: "query", title: "old session" });
      await store.appendMessage({
        sessionId: oldSession.id,
        role: "user",
        content: "old prompt",
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const recentSession = await store.createSession({ kind: "query", title: "recent session" });
      await store.appendMessage({
        sessionId: recentSession.id,
        role: "user",
        content: "recent prompt",
      });

      const terminal = new FakeTerminal(80, 20);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        {
          repoRoot,
          provider: "openai-codex",
          model: "gpt-test",
          initialSession: { type: "continue" },
        },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      app.startInitialSession();
      runtime.start();
      await pump(100);
      runtime.stop();

      const output = stripAnsi(terminal.output);
      expect(output).toContain("recent prompt");
      expect(output).toContain("resumed recent session");
      expect(output).not.toContain("old prompt");
    } finally {
      store.close();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("initial --session resumes a session by unique id prefix", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    const store = await SessionStore.open(repoRoot);
    try {
      const session = await store.createSession({ kind: "query", title: "prefix session" });
      await store.appendMessage({
        sessionId: session.id,
        role: "user",
        content: "prefix prompt",
      });

      const terminal = new FakeTerminal(80, 20);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        {
          repoRoot,
          provider: "openai-codex",
          model: "gpt-test",
          initialSession: { type: "session", selector: session.id.slice(0, 12) },
        },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      app.startInitialSession();
      runtime.start();
      await pump(100);
      runtime.stop();

      const output = stripAnsi(terminal.output);
      expect(output).toContain("prefix prompt");
      expect(output).toContain("resumed prefix session");
    } finally {
      store.close();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("initial --session normalizes provider-prefixed stored model names", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    const store = await SessionStore.open(repoRoot);
    try {
      const session = await store.createSession({
        kind: "query",
        title: "prefixed model session",
        model: "openai-codex:gpt-5.5",
      });
      await store.appendMessage({
        sessionId: session.id,
        role: "user",
        content: "prefixed model prompt",
      });

      const terminal = new FakeTerminal(80, 20);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        {
          repoRoot,
          provider: "openai-codex",
          model: "current-good-model",
          initialSession: { type: "session", selector: session.id.slice(0, 12) },
        },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      app.startInitialSession();
      runtime.start();
      await pump(100);
      runtime.stop();

      const internal = app as unknown as {
        state: { provider: string; model: string; currentSessionId: string | undefined };
      };
      expect(internal.state.currentSessionId).toBe(session.id);
      expect(internal.state.provider).toBe("openai-codex");
      expect(internal.state.model).toBe("gpt-5.5");
      expect(internal.state.model).not.toBe("openai-codex:gpt-5.5");
    } finally {
      store.close();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("initial --resume opens the session picker", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(80, 20);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        {
          repoRoot,
          provider: "openai-codex",
          model: "gpt-test",
          initialSession: { type: "resume" },
        },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      app.startInitialSession();
      runtime.start();
      await pump(100);
      runtime.stop();

      const output = stripAnsi(terminal.output);
      expect(output).toContain("Resume session");
      expect(output).toContain("(no sessions yet)");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("initial --fork clones a session by unique id prefix and resumes the clone", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    const store = await SessionStore.open(repoRoot);
    try {
      const source = await store.createSession({ kind: "query", title: "source session" });
      await store.appendMessage({
        sessionId: source.id,
        role: "user",
        content: "source prompt",
      });

      const terminal = new FakeTerminal(80, 20);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        {
          repoRoot,
          provider: "openai-codex",
          model: "gpt-test",
          initialSession: { type: "fork", selector: source.id.slice(0, 12) },
        },
        { codexLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      app.startInitialSession();
      runtime.start();
      await pump(120);
      runtime.stop();

      const internal = app as unknown as { state: { currentSessionId: string | undefined } };
      expect(internal.state.currentSessionId).not.toBe(source.id);
      expect(internal.state.currentSessionId).toBeDefined();
      const clone = store.getSession(internal.state.currentSessionId ?? "");
      expect(clone?.title).toBe("Fork of source session");
      expect(store.listMessages(clone?.id ?? "").map((message) => message.content)).toContain(
        "source prompt",
      );
      const output = stripAnsi(terminal.output);
      expect(output).toContain("source prompt");
      expect(output).toContain("forked from");
    } finally {
      store.close();
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("renders transcript hint, editor, and footer", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
      expect(output).toContain("strata v");
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(80, 24);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(80, 24);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(80, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
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
