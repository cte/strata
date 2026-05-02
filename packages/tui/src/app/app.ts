import process from "node:process";
import {
  getValidChatGptCredentials,
  runAgentLoopEvents,
  type AgentRunEvent,
  type ModelAdapter,
} from "@cortex/agent";
import { SessionStore, getCortexPaths } from "@cortex/core";
import type { Component, Frame, RenderContext } from "../component.js";
import { SlashCommandRegistry } from "../commands.js";
import { Editor } from "../editor.js";
import { TuiRuntime } from "../runtime.js";
import { Header, HelpOverlay, Footer, StatusLine } from "./chrome.js";
import { AuthDialog, logoutChatGpt } from "./authDialog.js";
import {
  createModelAdapter,
  defaultModel,
  inferDefaultProvider,
  loadAuthStatus,
} from "./modelFactory.js";
import { SessionSelector } from "./sessionSelector.js";
import {
  appendTranscript,
  clearTranscript,
  initialAppState,
  recordCompletion,
  recordToolResult,
  recordToolStart,
  type AppState,
  type ProviderName,
} from "./state.js";
import { Transcript } from "./transcript.js";

export interface CortexAppOptions {
  repoRoot: string;
  provider: ProviderName;
  model: string;
}

export class CortexApp implements Component {
  private readonly state: AppState;
  private readonly runtime: TuiRuntime;
  private readonly editor: Editor;
  private readonly registry: SlashCommandRegistry;
  private readonly authDialog: AuthDialog;
  private readonly sessionSelector: SessionSelector;
  private readonly help: HelpOverlay;
  private readonly repoRoot: string;
  private currentRun: AbortController | undefined;
  private exitRequested = false;
  private invalidating = false;

  constructor(
    runtime: TuiRuntime,
    options: CortexAppOptions,
    authStatus: Awaited<ReturnType<typeof loadAuthStatus>>,
  ) {
    this.runtime = runtime;
    this.repoRoot = options.repoRoot;
    this.state = initialAppState(options.provider, options.model, authStatus);
    this.registry = new SlashCommandRegistry();
    this.editor = new Editor({
      placeholder: "Ask Cortex about your wiki, or type /help",
      autocomplete: this.registry,
      onSubmit: (text) => void this.onSubmit(text),
    });
    this.authDialog = new AuthDialog(() => this.invalidate());
    this.sessionSelector = new SessionSelector();
    this.help = new HelpOverlay([]);
    this.help.onDismiss = () => this.closeOverlay();
    this.registerCommands();
    this.runtime.onInput((event) => {
      if (event.type === "key") {
        if (event.key === "ctrl+c") {
          this.handleCtrlC();
        } else if (event.key === "ctrl+l") {
          this.runtime.forceRedraw();
        } else if (event.key === "ctrl+d" && this.editor.text === "") {
          this.requestExit();
        }
      }
    });
  }

  get running(): boolean {
    return !this.exitRequested;
  }

  render(ctx: RenderContext): Frame {
    const header = new Header(this.state, this.repoRoot).render(ctx);
    const transcript = new Transcript(this.state.transcript).render(ctx);
    const status = new StatusLine(this.state).render(ctx);
    const editor = this.editor.render(ctx);
    const footer = new Footer(this.state).render(ctx);

    const lines: string[] = [
      ...header.lines,
      ...transcript.lines,
      ...status.lines,
      ...editor.lines,
      ...footer.lines,
    ];

    let cursor: Frame["cursor"] | undefined;
    if (editor.cursor !== undefined) {
      cursor = {
        row:
          header.lines.length + transcript.lines.length + status.lines.length + editor.cursor.row,
        col: editor.cursor.col,
      };
    }
    return cursor === undefined ? { lines } : { lines, cursor };
  }

  handleInput(event: import("../keys.js").InputEvent): "consumed" | "passthrough" {
    return this.editor.handleInput?.(event) ?? "passthrough";
  }

  private openOverlay(component: Component): void {
    this.runtime.setOverlay(component);
  }

  private closeOverlay(): void {
    this.runtime.setOverlay(undefined);
  }

  invalidate(): void {
    if (this.invalidating) {
      return;
    }
    this.invalidating = true;
    this.runtime.invalidate();
    this.invalidating = false;
  }

  private registerCommands(): void {
    this.registry.register({
      name: "help",
      description: "show keymap and command list",
      run: () => {
        this.help.active = true;
        this.openOverlay(this.help);
      },
    });
    this.registry.register({
      name: "clear",
      description: "clear visible transcript",
      run: () => {
        clearTranscript(this.state);
        this.state.status = undefined;
        this.invalidate();
      },
    });
    this.registry.register({
      name: "quit",
      description: "exit cortex tui",
      run: () => this.requestExit(),
    });
    this.registry.register({
      name: "auth",
      description: "show authentication status",
      run: async () => {
        this.state.auth = await loadAuthStatus();
        const lines: string[] = [];
        lines.push(`provider: ${this.state.provider}`);
        lines.push(`model: ${this.state.model}`);
        lines.push(
          `openai-codex: ${this.state.auth.codexLoggedIn ? `logged in (expires ${this.state.auth.codexExpiresAt !== undefined ? new Date(this.state.auth.codexExpiresAt).toISOString() : "unknown"})` : "not logged in"}`,
        );
        lines.push(
          `openai-compatible: ${this.state.auth.apiKeyConfigured ? "API key configured" : "not configured"}`,
        );
        appendTranscript(this.state, { kind: "status", content: lines.join("  ·  ") });
        this.invalidate();
      },
    });
    this.registry.register({
      name: "login",
      description: "sign in to openai-codex",
      run: () => {
        this.authDialog.start((result) => {
          this.closeOverlay();
          appendTranscript(this.state, {
            kind: result.ok ? "status" : "error",
            content: result.message,
          });
          void loadAuthStatus().then((auth) => {
            this.state.auth = auth;
            if (result.ok) {
              this.state.provider = "openai-codex";
            }
            this.invalidate();
          });
        });
        this.openOverlay(this.authDialog);
      },
    });
    this.registry.register({
      name: "logout",
      description: "remove openai-codex credentials",
      run: async () => {
        await logoutChatGpt();
        this.state.auth = await loadAuthStatus();
        appendTranscript(this.state, { kind: "status", content: "Logged out of openai-codex." });
        this.invalidate();
      },
    });
    this.registry.register({
      name: "model",
      description: "set model name (e.g. /model gpt-5.5)",
      run: (args) => {
        if (args.trim() === "") {
          appendTranscript(this.state, { kind: "status", content: `model: ${this.state.model}` });
        } else {
          this.state.model = args.trim();
          appendTranscript(this.state, {
            kind: "status",
            content: `model set to ${this.state.model}`,
          });
        }
        this.invalidate();
      },
    });
    this.registry.register({
      name: "provider",
      description: "switch provider (openai-codex|openai-compatible)",
      run: (args) => {
        const value = args.trim();
        if (value !== "openai-codex" && value !== "openai-compatible") {
          appendTranscript(this.state, {
            kind: "error",
            content: `unknown provider: ${value || "(none)"}`,
          });
        } else {
          this.state.provider = value;
          this.state.model = defaultModel(value);
          appendTranscript(this.state, {
            kind: "status",
            content: `provider set to ${value} (model ${this.state.model})`,
          });
        }
        this.invalidate();
      },
    });
    this.registry.register({
      name: "sessions",
      description: "browse recent sessions",
      run: async () => {
        const store = await SessionStore.open(this.repoRoot);
        try {
          const sessions = store.listSessions(20);
          this.sessionSelector.open(
            sessions,
            (session) => {
              appendTranscript(this.state, { kind: "status", content: `session: ${session.id}` });
              this.sessionSelector.close();
              this.closeOverlay();
            },
            () => {
              this.sessionSelector.close();
              this.closeOverlay();
            },
          );
          this.openOverlay(this.sessionSelector);
        } finally {
          store.close();
        }
      },
    });
    this.registry.register({
      name: "tools",
      description: "show registered tool names",
      run: async () => {
        const { createDefaultToolRegistry } = await import("@cortex/tools");
        const tools = createDefaultToolRegistry().list();
        appendTranscript(this.state, {
          kind: "status",
          content: `tools: ${tools.map((t) => t.name).join(", ")}`,
        });
        this.invalidate();
      },
    });
    this.help.lines = buildHelpLines(this.registry);
  }

  private async onSubmit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === "") {
      return;
    }
    if (trimmed.startsWith("/")) {
      const parsed = this.registry.parse(trimmed);
      if (parsed === undefined) {
        appendTranscript(this.state, { kind: "error", content: `unknown command: ${trimmed}` });
        this.invalidate();
        return;
      }
      try {
        await parsed.command.run(parsed.args);
      } catch (error: unknown) {
        appendTranscript(this.state, {
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
        this.invalidate();
      }
      return;
    }
    if (this.state.running) {
      appendTranscript(this.state, { kind: "error", content: "agent is already running" });
      this.invalidate();
      return;
    }
    await this.runAgent(trimmed);
  }

  private async runAgent(question: string): Promise<void> {
    let model: ModelAdapter;
    try {
      if (this.state.provider === "openai-codex") {
        await getValidChatGptCredentials(this.repoRoot);
      }
      model = await createModelAdapter({ provider: this.state.provider, model: this.state.model });
    } catch (error: unknown) {
      appendTranscript(this.state, {
        kind: "error",
        content: error instanceof Error ? error.message : String(error),
      });
      this.invalidate();
      return;
    }

    this.state.running = true;
    this.state.status = undefined;
    appendTranscript(this.state, { kind: "user", content: question });
    this.editor.disabled = true;
    this.invalidate();

    this.currentRun = new AbortController();
    const signal = this.currentRun.signal;

    try {
      for await (const event of runAgentLoopEvents({
        question,
        model,
        repoRoot: this.repoRoot,
        signal,
      })) {
        this.applyAgentEvent(event);
        this.invalidate();
      }
    } catch (error: unknown) {
      appendTranscript(this.state, {
        kind: "error",
        content: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.editor.disabled = false;
      this.state.running = false;
      this.currentRun = undefined;
      this.invalidate();
    }
  }

  private applyAgentEvent(event: AgentRunEvent): void {
    switch (event.type) {
      case "session.started":
        this.state.currentSessionId = event.sessionId;
        this.state.status = `session ${event.sessionId.slice(0, 12)} · ${event.title}`;
        return;
      case "model.request":
        this.state.status = `thinking (iter ${event.iteration})`;
        return;
      case "model.response":
        if (event.content.trim() !== "") {
          appendTranscript(this.state, {
            kind: "assistant",
            content: event.content,
            iteration: event.iteration,
          });
        }
        return;
      case "tool.call.started":
        recordToolStart(this.state, {
          id: event.toolCallId,
          name: event.toolName,
          argumentsText: event.argumentsText,
        });
        return;
      case "tool.call.completed":
        recordToolResult(this.state, event.toolCallId, event.result);
        return;
      case "agent.completed":
        recordCompletion(this.state, event.result);
        return;
      case "agent.failed":
        appendTranscript(this.state, { kind: "error", content: event.message });
        if (event.result !== undefined) {
          recordCompletion(this.state, event.result);
        } else {
          this.state.running = false;
        }
        return;
    }
  }

  private handleCtrlC(): void {
    if (this.currentRun !== undefined) {
      this.currentRun.abort();
      appendTranscript(this.state, { kind: "status", content: "interrupting agent…" });
      this.invalidate();
      return;
    }
    if (this.editor.text !== "") {
      this.editor.reset();
      this.invalidate();
      return;
    }
    this.requestExit();
  }

  private requestExit(): void {
    this.exitRequested = true;
    this.runtime.stop();
  }
}

function buildHelpLines(registry: SlashCommandRegistry): string[] {
  return [
    "Cortex TUI",
    "",
    "Editor:",
    "  Enter        submit",
    "  Shift+Enter  newline",
    "  Tab          autocomplete /commands",
    "  Up/Down      history",
    "  Ctrl+L       redraw",
    "  Ctrl+C       cancel run / clear / exit",
    "",
    "Slash commands:",
    ...registry.list().map((cmd) => `  /${cmd.name.padEnd(10)} ${cmd.description}`),
    "",
    "Press Esc or Enter to dismiss.",
  ];
}

export async function buildAppOptions(repoRoot: string): Promise<{
  options: CortexAppOptions;
  authStatus: Awaited<ReturnType<typeof loadAuthStatus>>;
}> {
  const provider = parseProviderEnv() ?? (await inferDefaultProvider());
  const model = Bun.env.CORTEX_MODEL ?? Bun.env.OPENAI_MODEL ?? defaultModel(provider);
  const authStatus = await loadAuthStatus();
  return {
    options: { repoRoot, provider, model },
    authStatus,
  };
}

function parseProviderEnv(): ProviderName | undefined {
  const value = Bun.env.CORTEX_PROVIDER;
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "openai-codex" || value === "openai-compatible") {
    return value;
  }
  return undefined;
}

export function shutdownOnExit(runtime: TuiRuntime): void {
  const cleanup = () => {
    runtime.stop();
    process.exit(0);
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
}
