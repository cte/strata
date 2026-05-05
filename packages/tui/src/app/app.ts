import process from "node:process";
import {
  compactSession,
  getValidChatGptCredentials,
  runAgentLoopEvents,
  shouldAutoCompact,
  type AgentAttachment,
  type AgentRunEvent,
  type ModelAdapter,
} from "@cortex/agent";
import { SessionStore, getCortexPaths } from "@cortex/core";
import type { Component, Frame, RenderContext } from "../component.js";
import { SlashCommandRegistry } from "../commands.js";
import { DynamicBorder } from "../components.js";
import { Editor } from "../editor.js";
import { TuiRuntime } from "../runtime.js";
import { HelpOverlay, Footer, StatusLine } from "./chrome.js";
import { AuthDialog, logoutChatGpt } from "./authDialog.js";
import {
  createModelAdapter,
  defaultModel,
  inferDefaultProvider,
  listModels,
  loadAuthStatus,
} from "./modelFactory.js";
import path from "node:path";
import { copyToClipboard } from "./clipboard.js";
import { resetTokenUsage } from "./usage.js";
import { CombinedAutocompleteProvider } from "./combinedAutocomplete.js";
import { FileMentionProvider } from "./fileMentions.js";
import { appendHistory, loadHistory } from "./history.js";
import { ModelSelector } from "./modelSelector.js";
import { loadPreferences, savePreferences } from "./preferences.js";
import { SessionSelector } from "./sessionSelector.js";
import type { ThinkingLevel } from "@cortex/agent";
import { THINKING_LEVELS } from "@cortex/agent";
import {
  appendTranscript,
  clearTranscript,
  initialAppState,
  nextThinkingLevel,
  recordCompletion,
  recordModelUsage,
  recordToolResult,
  recordToolStart,
  setModelSelection,
  startSession,
  type AppState,
  type ProviderName,
} from "./state.js";
import { Transcript } from "./transcript.js";

export interface CortexAppOptions {
  repoRoot: string;
  provider: ProviderName;
  model: string;
  reasoningEffort?: ThinkingLevel;
}

export class CortexApp implements Component {
  private readonly state: AppState;
  private readonly runtime: TuiRuntime;
  private readonly editor: Editor;
  private readonly registry: SlashCommandRegistry;
  private readonly authDialog: AuthDialog;
  private readonly sessionSelector: SessionSelector;
  private readonly modelSelector: ModelSelector;
  private readonly statusLine: StatusLine;
  private readonly footer: Footer;
  private readonly help: HelpOverlay;
  private readonly repoRoot: string;
  private currentRun: AbortController | undefined;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
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
    if (options.reasoningEffort !== undefined) {
      this.state.reasoningEffort = options.reasoningEffort;
    }
    this.registry = new SlashCommandRegistry();
    const fileMentions = new FileMentionProvider(path.join(this.repoRoot, "wiki"));
    const autocomplete = new CombinedAutocompleteProvider([this.registry, fileMentions]);
    this.editor = new Editor({
      placeholder: "Ask Cortex about your wiki, or type /help",
      autocomplete,
      onSubmit: (text) => void this.onSubmit(text),
    });
    void this.loadEditorHistory();
    this.authDialog = new AuthDialog(() => this.invalidate());
    this.sessionSelector = new SessionSelector();
    this.modelSelector = new ModelSelector();
    this.statusLine = new StatusLine(this.state);
    this.footer = new Footer(this.state, this.repoRoot);
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
        } else if (event.key === "shift+tab") {
          this.cycleThinkingLevel();
        }
      }
    });
  }

  get running(): boolean {
    return !this.exitRequested;
  }

  render(ctx: RenderContext): Frame {
    const transcript = new Transcript(this.state.transcript).render(ctx);
    const status = this.statusLine.render(ctx);
    const editorBorder = new DynamicBorder().render(ctx);
    const editor = this.editor.render(ctx);
    const footer = this.footer.render(ctx);

    const lines: string[] = [
      ...transcript.lines,
      ...status.lines,
      ...editorBorder.lines,
      ...editor.lines,
      ...footer.lines,
    ];

    let cursor: Frame["cursor"] | undefined;
    if (editor.cursor !== undefined) {
      cursor = {
        row:
          transcript.lines.length +
          status.lines.length +
          editorBorder.lines.length +
          editor.cursor.row,
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
    this.syncAnimationLoop();
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
      description: "clear the visible transcript (keeps the live session)",
      run: () => {
        clearTranscript(this.state);
        this.state.status = undefined;
        this.invalidate();
      },
    });
    this.registry.register({
      name: "new",
      description: "start a fresh session — drops conversation continuity",
      run: () => {
        clearTranscript(this.state);
        this.state.currentSessionId = undefined;
        this.state.status = undefined;
        resetTokenUsage(this.state.usage);
        appendTranscript(this.state, {
          kind: "status",
          content: "started a new session",
        });
        this.invalidate();
      },
    });
    this.registry.register({
      name: "compact",
      description: "summarize the current session to free context window",
      run: async () => {
        const sessionId = this.state.currentSessionId;
        if (sessionId === undefined) {
          appendTranscript(this.state, {
            kind: "error",
            content: "no active session to compact (start a conversation first)",
          });
          this.invalidate();
          return;
        }
        if (this.state.running) {
          appendTranscript(this.state, {
            kind: "error",
            content: "cannot compact while the agent is running",
          });
          this.invalidate();
          return;
        }
        let model: ModelAdapter;
        try {
          model = await createModelAdapter({
            provider: this.state.provider,
            model: this.state.model,
          });
        } catch (error: unknown) {
          appendTranscript(this.state, {
            kind: "error",
            content: error instanceof Error ? error.message : String(error),
          });
          this.invalidate();
          return;
        }
        appendTranscript(this.state, { kind: "status", content: "compacting session…" });
        this.state.running = true;
        this.editor.disabled = true;
        this.invalidate();
        try {
          const result = await compactSession({
            sessionId,
            model,
            repoRoot: this.repoRoot,
          });
          appendTranscript(this.state, {
            kind: "status",
            content: `compacted ${result.messagesSummarized} messages — context reset`,
          });
          appendTranscript(this.state, {
            kind: "assistant",
            content: result.summary,
            iteration: 0,
          });
          resetTokenUsage(this.state.usage);
        } catch (error: unknown) {
          appendTranscript(this.state, {
            kind: "error",
            content: error instanceof Error ? error.message : String(error),
          });
        } finally {
          this.state.running = false;
          this.editor.disabled = false;
          this.invalidate();
        }
      },
    });
    this.registry.register({
      name: "quit",
      description: "exit cortex tui",
      run: () => this.requestExit(),
    });
    this.registry.register({
      name: "copy",
      description: "copy last assistant message to clipboard",
      run: async () => {
        const last = this.lastAssistantMessage();
        if (last === undefined) {
          appendTranscript(this.state, {
            kind: "error",
            content: "no assistant message to copy",
          });
          this.invalidate();
          return;
        }
        try {
          await copyToClipboard(last);
          appendTranscript(this.state, {
            kind: "status",
            content: `copied ${last.length} chars to clipboard`,
          });
        } catch (error: unknown) {
          appendTranscript(this.state, {
            kind: "error",
            content: error instanceof Error ? error.message : String(error),
          });
        }
        this.invalidate();
      },
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
              this.persistPreferences();
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
      description: "pick a model for the current provider",
      run: () => {
        const provider = this.state.provider;
        this.modelSelector.open(
          this.state.model,
          (model) => {
            setModelSelection(this.state, this.state.provider, model.id);
            this.persistPreferences();
            appendTranscript(this.state, {
              kind: "status",
              content: `model set to ${model.id}`,
            });
            this.modelSelector.close();
            this.closeOverlay();
          },
          () => {
            this.modelSelector.close();
            this.closeOverlay();
          },
        );
        this.openOverlay(this.modelSelector);
        void listModels(provider).then(
          (results) => {
            this.modelSelector.setModels(results);
            this.invalidate();
          },
          (error: unknown) => {
            this.modelSelector.setError(error instanceof Error ? error.message : String(error));
            this.invalidate();
          },
        );
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
          const model = defaultModel(value);
          setModelSelection(this.state, value, model);
          this.persistPreferences();
          appendTranscript(this.state, {
            kind: "status",
            content: `provider set to ${value} (model ${model})`,
          });
        }
        this.invalidate();
      },
    });
    this.registry.register({
      name: "think",
      description: "set reasoning effort (off|minimal|low|medium|high|xhigh)",
      run: (args) => {
        if (args.trim() === "") {
          this.cycleThinkingLevel();
          return;
        }
        this.setThinkingLevel(args);
      },
    });
    this.registry.register({
      name: "resume",
      description: "pick a previous session to continue",
      run: () => this.openSessionPicker("resume"),
    });
    this.registry.register({
      name: "sessions",
      description: "alias for /resume — pick a previous session",
      run: () => this.openSessionPicker("resume"),
    });
    this.registry.register({
      name: "session",
      description: "show info about the current session",
      run: () => {
        this.showCurrentSessionInfo();
      },
    });
    this.registry.register({
      name: "name",
      description: "rename the current session (e.g. /name onboarding plan)",
      run: (args) => this.renameCurrentSession(args),
    });
    this.registry.register({
      name: "clone",
      description: "duplicate the current session and switch to the copy",
      run: () => this.cloneCurrentSession(),
    });
    this.registry.register({
      name: "fork",
      description: "alias for /clone — branch from the current session",
      run: () => this.cloneCurrentSession(),
    });
    this.registry.register({
      name: "image",
      description: "attach an image to the next message (e.g. /image ~/shot.png)",
      run: (args) => this.attachImage(args),
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
    void this.persistEditorHistory(trimmed);
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

    const attachments = this.state.pendingAttachments.slice();
    this.state.pendingAttachments = [];
    if (attachments.length > 0) {
      const names = attachments
        .map((attachment) => attachment.name ?? attachment.mimeType)
        .join(", ");
      appendTranscript(this.state, {
        kind: "status",
        content: `attached ${attachments.length} image(s): ${names}`,
      });
    }
    try {
      for await (const event of runAgentLoopEvents({
        question,
        model,
        repoRoot: this.repoRoot,
        signal,
        reasoningEffort: this.state.reasoningEffort,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(this.state.currentSessionId !== undefined
          ? { continueSessionId: this.state.currentSessionId }
          : {}),
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
      void this.maybeAutoCompact();
    }
  }

  private async maybeAutoCompact(): Promise<void> {
    const sessionId = this.state.currentSessionId;
    if (sessionId === undefined) return;
    const trigger = shouldAutoCompact({
      contextWindow: this.state.contextWindow,
      latestContextTokens: this.state.usage.latestContextTokens,
    });
    if (!trigger) return;
    let model: ModelAdapter;
    try {
      model = await createModelAdapter({
        provider: this.state.provider,
        model: this.state.model,
      });
    } catch {
      return;
    }
    appendTranscript(this.state, {
      kind: "status",
      content: "context window getting full — auto-compacting…",
    });
    this.invalidate();
    try {
      const result = await compactSession({ sessionId, model, repoRoot: this.repoRoot });
      appendTranscript(this.state, {
        kind: "status",
        content: `auto-compacted ${result.messagesSummarized} messages${result.incremental ? " (incremental)" : ""}`,
      });
      resetTokenUsage(this.state.usage);
    } catch (error: unknown) {
      appendTranscript(this.state, {
        kind: "error",
        content: `auto-compact failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      this.invalidate();
    }
  }

  private applyAgentEvent(event: AgentRunEvent): void {
    switch (event.type) {
      case "session.started":
        startSession(this.state, event.sessionId);
        this.state.status = `session ${event.sessionId.slice(0, 12)} · ${event.title}`;
        return;
      case "model.request":
        this.state.status = `thinking (iter ${event.iteration})`;
        return;
      case "model.response":
        recordModelUsage(this.state, event.usage);
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
    this.stopAnimationLoop();
    this.runtime.stop();
  }

  private shouldAnimate(): boolean {
    return this.state.running || this.modelSelector.loading;
  }

  private syncAnimationLoop(): void {
    if (this.shouldAnimate()) {
      this.startAnimationLoop();
      return;
    }
    this.stopAnimationLoop();
  }

  private startAnimationLoop(): void {
    if (this.animationTimer !== undefined) {
      return;
    }
    this.animationTimer = setInterval(() => {
      if (!this.shouldAnimate()) {
        this.stopAnimationLoop();
        return;
      }
      this.runtime.invalidate();
    }, 80);
  }

  private stopAnimationLoop(): void {
    if (this.animationTimer === undefined) {
      return;
    }
    clearInterval(this.animationTimer);
    this.animationTimer = undefined;
  }

  private cycleThinkingLevel(): void {
    this.state.reasoningEffort = nextThinkingLevel(this.state.reasoningEffort);
    this.persistPreferences();
    this.invalidate();
  }

  private setThinkingLevel(value: string): void {
    const trimmed = value.trim().toLowerCase();
    if (!THINKING_LEVELS.includes(trimmed as ThinkingLevel)) {
      appendTranscript(this.state, {
        kind: "error",
        content: `unknown thinking level: ${trimmed || "(none)"} (expected ${THINKING_LEVELS.join("|")})`,
      });
      this.invalidate();
      return;
    }
    this.state.reasoningEffort = trimmed as ThinkingLevel;
    this.persistPreferences();
    this.invalidate();
  }

  private persistPreferences(): void {
    const runtimeDir = getCortexPaths(this.repoRoot).runtimeDir;
    void savePreferences(runtimeDir, {
      provider: this.state.provider,
      model: this.state.model,
      reasoningEffort: this.state.reasoningEffort,
    }).catch(() => {
      // Preferences are best-effort; silently swallow disk errors.
    });
  }

  private async openSessionPicker(action: "resume"): Promise<void> {
    const store = await SessionStore.open(this.repoRoot);
    try {
      const sessions = store.listSessions(30);
      this.sessionSelector.open(
        sessions,
        (session) => {
          this.sessionSelector.close();
          this.closeOverlay();
          if (action === "resume") {
            void this.resumeSession(session.id);
          }
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
  }

  private async resumeSession(sessionId: string): Promise<void> {
    const store = await SessionStore.open(this.repoRoot);
    try {
      const session = store.getSession(sessionId);
      if (session === undefined) {
        appendTranscript(this.state, { kind: "error", content: `session not found: ${sessionId}` });
        this.invalidate();
        return;
      }
      const messages = store.listMessages(sessionId);
      clearTranscript(this.state);
      this.state.currentSessionId = sessionId;
      // Re-derive provider/model from the session if possible. The session row
      // stores only the model name (not provider); keep the current provider.
      if (session.model !== null) {
        setModelSelection(this.state, this.state.provider, session.model);
      } else {
        resetTokenUsage(this.state.usage);
      }
      // Replay the saved messages as transcript items so the user sees the
      // history. Tool calls are surfaced as muted status lines because we
      // don't reconstruct the full tool-execution context from the message
      // log alone.
      for (const message of messages) {
        if (message.role === "user") {
          appendTranscript(this.state, { kind: "user", content: message.content });
        } else if (message.role === "assistant") {
          appendTranscript(this.state, {
            kind: "assistant",
            content: message.content,
            iteration: 0,
          });
        } else if (message.role === "tool") {
          appendTranscript(this.state, {
            kind: "status",
            content: `tool result (${message.toolCallId ?? "?"})`,
          });
        }
        // role === "system" is skipped: we always rebuild fresh system prompts.
      }
      appendTranscript(this.state, {
        kind: "status",
        content: `resumed ${session.title} (${messages.length} prior messages)`,
      });
    } finally {
      store.close();
      this.invalidate();
    }
  }

  private showCurrentSessionInfo(): void {
    const sessionId = this.state.currentSessionId;
    if (sessionId === undefined) {
      appendTranscript(this.state, {
        kind: "status",
        content: "no active session — start a conversation or run /resume",
      });
      this.invalidate();
      return;
    }
    void (async () => {
      const store = await SessionStore.open(this.repoRoot);
      try {
        const session = store.getSession(sessionId);
        if (session === undefined) {
          appendTranscript(this.state, { kind: "error", content: `session not found: ${sessionId}` });
          return;
        }
        const messages = store.listMessages(sessionId);
        const counts = messages.reduce<Record<string, number>>((acc, m) => {
          acc[m.role] = (acc[m.role] ?? 0) + 1;
          return acc;
        }, {});
        const usage = this.state.usage;
        const lines = [
          `session: ${session.id}`,
          `title:   ${session.title}`,
          `started: ${session.startedAt}`,
          `model:   ${session.model ?? "(unknown)"}`,
          `messages: total=${messages.length} user=${counts.user ?? 0} assistant=${counts.assistant ?? 0} tool=${counts.tool ?? 0}`,
          `tokens:  ↑${usage.input} ↓${usage.output} R${usage.cacheRead} W${usage.cacheWrite}${usage.cost > 0 ? ` $${usage.cost.toFixed(3)}` : ""}`,
        ];
        appendTranscript(this.state, { kind: "status", content: lines.join("\n") });
      } finally {
        store.close();
        this.invalidate();
      }
    })();
  }

  private renameCurrentSession(args: string): void {
    const sessionId = this.state.currentSessionId;
    if (sessionId === undefined) {
      appendTranscript(this.state, {
        kind: "error",
        content: "no active session to rename — start a conversation or run /resume",
      });
      this.invalidate();
      return;
    }
    const title = args.trim();
    if (title === "") {
      appendTranscript(this.state, {
        kind: "error",
        content: "usage: /name <new title>",
      });
      this.invalidate();
      return;
    }
    void (async () => {
      const store = await SessionStore.open(this.repoRoot);
      try {
        store.updateSessionTitle(sessionId, title);
        appendTranscript(this.state, {
          kind: "status",
          content: `renamed session to ${title}`,
        });
      } finally {
        store.close();
        this.invalidate();
      }
    })();
  }

  private attachImage(args: string): void {
    const requested = args.trim();
    if (requested === "") {
      appendTranscript(this.state, {
        kind: "error",
        content: "usage: /image <path-to-image>",
      });
      this.invalidate();
      return;
    }
    void (async () => {
      try {
        const { readFile } = await import("node:fs/promises");
        const os = await import("node:os");
        const pathMod = await import("node:path");
        const expanded = requested.startsWith("~")
          ? pathMod.join(os.homedir(), requested.slice(requested.startsWith("~/") ? 2 : 1))
          : requested;
        const absolute = pathMod.isAbsolute(expanded)
          ? expanded
          : pathMod.resolve(this.repoRoot, expanded);
        const bytes = await readFile(absolute);
        const mimeType = mimeTypeForPath(absolute);
        if (mimeType === undefined) {
          appendTranscript(this.state, {
            kind: "error",
            content: `unsupported image type for ${absolute} (expected .png/.jpg/.jpeg/.gif/.webp)`,
          });
          this.invalidate();
          return;
        }
        const attachment: AgentAttachment = {
          kind: "image",
          mimeType,
          dataBase64: Buffer.from(bytes).toString("base64"),
          name: pathMod.basename(absolute),
        };
        this.state.pendingAttachments.push(attachment);
        appendTranscript(this.state, {
          kind: "status",
          content: `queued image: ${attachment.name} (${formatBytes(bytes.byteLength)}). It will be sent with your next message.`,
        });
      } catch (error: unknown) {
        appendTranscript(this.state, {
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.invalidate();
      }
    })();
  }

  private cloneCurrentSession(): void {
    const sessionId = this.state.currentSessionId;
    if (sessionId === undefined) {
      appendTranscript(this.state, {
        kind: "error",
        content: "no active session to clone — start a conversation first",
      });
      this.invalidate();
      return;
    }
    if (this.state.running) {
      appendTranscript(this.state, {
        kind: "error",
        content: "cannot clone while the agent is running",
      });
      this.invalidate();
      return;
    }
    void (async () => {
      const store = await SessionStore.open(this.repoRoot);
      try {
        const cloned = await store.cloneSession(sessionId);
        this.state.currentSessionId = cloned.id;
        resetTokenUsage(this.state.usage);
        appendTranscript(this.state, {
          kind: "status",
          content: `cloned to ${cloned.title} (${cloned.id.slice(0, 12)})`,
        });
      } catch (error: unknown) {
        appendTranscript(this.state, {
          kind: "error",
          content: error instanceof Error ? error.message : String(error),
        });
      } finally {
        store.close();
        this.invalidate();
      }
    })();
  }

  private lastAssistantMessage(): string | undefined {
    for (let i = this.state.transcript.length - 1; i >= 0; i -= 1) {
      const item = this.state.transcript[i];
      if (item?.kind === "assistant" && item.content.trim() !== "") {
        return item.content;
      }
    }
    return undefined;
  }

  private async loadEditorHistory(): Promise<void> {
    try {
      const runtimeDir = getCortexPaths(this.repoRoot).runtimeDir;
      const history = await loadHistory(runtimeDir);
      if (history.length > 0) {
        // Replace in place so the editor's reference stays valid.
        this.editor.history.splice(0, this.editor.history.length, ...history);
      }
    } catch {
      // History is best-effort; silently swallow.
    }
  }

  private async persistEditorHistory(prompt: string): Promise<void> {
    try {
      const runtimeDir = getCortexPaths(this.repoRoot).runtimeDir;
      await appendHistory(runtimeDir, prompt);
    } catch {
      // History is best-effort; silently swallow.
    }
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
    "  Shift+Tab    cycle thinking level",
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
  const runtimeDir = getCortexPaths(repoRoot).runtimeDir;
  const prefs = await loadPreferences(runtimeDir);
  const provider = parseProviderEnv() ?? prefs.provider ?? (await inferDefaultProvider());
  const model =
    Bun.env.CORTEX_MODEL ?? Bun.env.OPENAI_MODEL ?? prefs.model ?? defaultModel(provider);
  const authStatus = await loadAuthStatus();
  const options: CortexAppOptions = { repoRoot, provider, model };
  if (prefs.reasoningEffort !== undefined) {
    options.reasoningEffort = prefs.reasoningEffort;
  }
  return { options, authStatus };
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

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function mimeTypeForPath(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = filePath.slice(dot).toLowerCase();
  return IMAGE_MIME_TYPES[ext];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
