import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { stripAnsi } from "../../ansi.js";
import { TuiRuntime } from "../../runtime.js";
import { FakeTerminal } from "../../terminal.js";
import { buildTuiExitMessage, StrataApp } from "../app.js";

function pump(ms = 30): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
});

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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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

  test("initial --resume opens the session picker with only resumable chat/query sessions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    const store = await SessionStore.open(repoRoot);
    try {
      await store.createSession({ kind: "ingest", title: "ingest source pull" });
      await store.createSession({ kind: "maintain", title: "maintenance pass" });
      await store.createSession({ kind: "query", title: "query session" });
      await store.createSession({ kind: "chat", title: "chat session" });

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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      app.startInitialSession();
      runtime.start();
      await pump(100);
      runtime.stop();

      const output = stripAnsi(terminal.output);
      expect(output).toContain("Resume session");
      expect(output).toContain("query session");
      expect(output).toContain("chat session");
      expect(output).not.toContain("ingest source pull");
      expect(output).not.toContain("maintenance pass");
    } finally {
      store.close();
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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

  test("/model lists models across providers and selecting one switches provider", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    const originalChatGptHome = Bun.env.STRATA_CHATGPT_HOME;
    const originalRuntimeDir = Bun.env.XDG_RUNTIME_DIR;
    const originalApiKey = Bun.env.STRATA_API_KEY;
    Bun.env.STRATA_CHATGPT_HOME = path.join(repoRoot, "missing-chatgpt-home");
    Bun.env.XDG_RUNTIME_DIR = path.join(repoRoot, "missing-runtime");
    Bun.env.STRATA_API_KEY = "test-key";
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "gpt-4o-mini", owned_by: "openai" },
              { id: "gpt-4o", owned_by: "openai" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const terminal = new FakeTerminal(80, 20);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: true },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();

      terminal.output = "";
      terminal.feed("/model\r");
      await pump(120);
      const openedFrame = stripAnsi(
        app.render({ width: terminal.columns, height: terminal.rows }).lines.join("\n"),
      );
      expect(openedFrame).toContain("Select model");
      expect(openedFrame).toContain("gpt-4o");
      expect(openedFrame).toContain("[openai-compatible]");
      expect(openedFrame).not.toContain("Select provider");

      terminal.feed("\r");
      await pump();
      runtime.stop();

      const internal = app as unknown as { state: { provider: string; model: string } };
      expect(internal.state.provider).toBe("openai-compatible");
      expect(internal.state.model).toBe("gpt-4o");
      const output = stripAnsi(terminal.output);
      expect(output).toContain("model set to openai-compatible/gpt-4o");
    } finally {
      if (originalChatGptHome === undefined) {
        delete Bun.env.STRATA_CHATGPT_HOME;
      } else {
        Bun.env.STRATA_CHATGPT_HOME = originalChatGptHome;
      }
      if (originalRuntimeDir === undefined) {
        delete Bun.env.XDG_RUNTIME_DIR;
      } else {
        Bun.env.XDG_RUNTIME_DIR = originalRuntimeDir;
      }
      if (originalApiKey === undefined) {
        delete Bun.env.STRATA_API_KEY;
      } else {
        Bun.env.STRATA_API_KEY = originalApiKey;
      }
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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

  test("queues Enter as steering, Alt+Enter as follow-up, and restores queues on interrupt", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(80, 24);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);
      runtime.start();
      await pump();

      const fakeAbort = new AbortController();
      const internal = app as unknown as {
        state: {
          running: boolean;
          steeringMessages: Array<{ content: string }>;
          followUpMessages: Array<{ content: string }>;
        };
        editor: { setText: (value: string) => void; text: string };
        currentRun: AbortController | undefined;
        onSubmit: (text: string) => Promise<void>;
        handleAltEnter: () => void;
        handleEditorEscape: () => void;
      };
      internal.state.running = true;
      internal.currentRun = fakeAbort;

      await internal.onSubmit("steer now");
      internal.editor.setText("follow later");
      internal.handleAltEnter();
      internal.editor.setText("draft");
      internal.handleEditorEscape();
      await pump();
      runtime.stop();

      expect(fakeAbort.signal.aborted).toBe(true);
      expect(internal.state.steeringMessages).toHaveLength(0);
      expect(internal.state.followUpMessages).toHaveLength(0);
      expect(internal.editor.text).toBe("steer now\n\nfollow later\n\ndraft");
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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

  test("builds an exit message with token usage and resume command", () => {
    const message = buildTuiExitMessage(
      {
        currentSessionId: "sess_fb71a200-1234-4567-8901-123456789abc",
        contextWindow: 272_000,
        usage: {
          input: 80,
          output: 20,
          cacheRead: 20,
          cacheWrite: 0,
          total: 120,
          cost: 0.0123,
          latestContextTokens: 120,
        },
      },
      "strata tui",
    );

    expect(message).not.toContain("Strata TUI ended.");
    expect(message).toContain("input 80");
    expect(message).toContain("output 20");
    expect(message).toContain("cache read 20");
    expect(message).toContain("total 120");
    expect(message).toContain("cost $0.012");
    expect(message).toContain("last context 120/272,000 (0.0%)");
    expect(message).toContain("Resume: strata tui -r sess_fb71a20");
    expect(message).not.toContain("sess_fb71a200-1234");
  });

  test("builds an empty exit message without token usage or resumable session", () => {
    const message = buildTuiExitMessage({
      currentSessionId: undefined,
      contextWindow: undefined,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        cost: 0,
        latestContextTokens: undefined,
      },
    });

    expect(message).toBe("");
  });

  test("/quit shuts down the app", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const app = new StrataApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
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

  test("Ctrl+Z stops the TUI and restores it on SIGCONT", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-tui-"));
    try {
      const terminal = new FakeTerminal(60, 12);
      const runtime = new TuiRuntime({ terminal, root: { render: () => ({ lines: [] }) } });
      const startSpy = spyOn(runtime, "start");
      const stopSpy = spyOn(runtime, "stop");
      const forceRedrawSpy = spyOn(runtime, "forceRedraw");
      const app = new StrataApp(
        runtime,
        { repoRoot, provider: "openai-codex", model: "gpt-test" },
        { codexLoggedIn: false, anthropicLoggedIn: false, apiKeyConfigured: false },
      );
      runtime.setRoot(app);

      const keepAliveHandle = setTimeout(() => undefined, 0);
      clearTimeout(keepAliveHandle);
      const setIntervalSpy = spyOn(globalThis, "setInterval").mockImplementation(
        (() => keepAliveHandle) as typeof setInterval,
      );
      const clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(
        (() => undefined) as typeof clearInterval,
      );
      let sigintHandler: (() => void) | undefined;
      let sigcontHandler: (() => void) | undefined;
      const processOnSpy = spyOn(process, "on").mockImplementation(((
        event: string,
        listener: (...args: unknown[]) => void,
      ) => {
        if (event === "SIGINT") {
          sigintHandler = listener;
        }
        return process;
      }) as typeof process.on);
      const removeListenerSpy = spyOn(process, "removeListener").mockImplementation(
        (() => process) as typeof process.removeListener,
      );
      const processOnceSpy = spyOn(process, "once").mockImplementation(((
        event: string,
        listener: (...args: unknown[]) => void,
      ) => {
        if (event === "SIGCONT") {
          sigcontHandler = listener;
        }
        return process;
      }) as typeof process.once);
      const processKillSpy = spyOn(process, "kill").mockImplementation(
        (() => true) as typeof process.kill,
      );

      runtime.start();
      await pump();
      terminal.feed("\x1a");

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2 ** 30);
      expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(processOnceSpy).toHaveBeenCalledWith("SIGCONT", expect.any(Function));
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(processKillSpy).toHaveBeenCalledWith(0, "SIGTSTP");
      expect(sigintHandler).toBeDefined();
      expect(sigcontHandler).toBeDefined();

      sigcontHandler?.();

      expect(clearIntervalSpy).toHaveBeenCalledWith(keepAliveHandle);
      expect(removeListenerSpy).toHaveBeenCalledWith("SIGINT", sigintHandler);
      expect(startSpy).toHaveBeenCalledTimes(2);
      expect(forceRedrawSpy).toHaveBeenCalledTimes(1);
      expect(app.running).toBe(true);
      runtime.stop();
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
