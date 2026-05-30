import path from "node:path";
import process from "node:process";
import type { ThinkingLevel } from "@strata/agent";
import {
  type AgentAttachment,
  type AgentRunEvent,
  compactSession,
  getValidChatGptCredentials,
  type ModelAdapter,
  runAgentLoopEvents,
  THINKING_LEVELS,
} from "@strata/agent";
import {
  getStrataPaths,
  listSkills,
  readSkill,
  type SessionKind,
  type SessionRecord,
  SessionStore,
} from "@strata/core";
import { createConfiguredMcpToolPack } from "@strata/integration-mcp/exa";

import { createToolRegistryWithPacks, type ToolPack } from "@strata/tools";
import { sanitizeTerminalText } from "../ansi.js";

import { SlashCommandRegistry } from "../commands.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { DynamicBorder } from "../components.js";
import { Editor } from "../editor.js";
import { TuiRuntime } from "../runtime.js";
import { AuthDialog, logoutAnthropic, logoutChatGpt } from "./authDialog.js";

import { Footer, StatusLine } from "./chrome.js";
import { copyToClipboard } from "./clipboard.js";
import { CombinedAutocompleteProvider } from "./combinedAutocomplete.js";
import { FileMentionProvider } from "./fileMentions.js";
import { buildHelpNotice, buildStartupHeader } from "./header.js";
import { appendHistory, loadHistory } from "./history.js";
import {
  createModelAdapter,
  defaultModel,
  inferDefaultProvider,
  listModels,
  loadAuthStatus,
} from "./modelFactory.js";
import { type ModelOption, ModelSelector } from "./modelSelector.js";
import { loadPreferences, savePreferences } from "./preferences.js";

import { SessionSelector, sessionDisplayTitle } from "./sessionSelector.js";
import {
  type AppState,
  appendAssistantDelta,
  appendTranscript,
  clearTranscript,
  finalizeAssistantStream,
  initialAppState,
  nextThinkingLevel,
  type ProviderName,
  recordCompletion,
  recordModelUsage,
  recordToolResult,
  recordToolStart,
  setModelSelection,
  startSession,
} from "./state.js";
import { Transcript } from "./transcript.js";
import { resetTokenUsage, supportedThinkingLevels, type TokenUsageTotals } from "./usage.js";

export interface StrataAppOptions {
  repoRoot: string;
  provider: ProviderName;
  model: string;
  reasoningEffort?: ThinkingLevel;
  initialSession?: InitialSessionAction;
}

export type InitialSessionAction =
  | { type: "continue" }
  | { type: "resume" }
  | { type: "session"; selector: string }
  | { type: "fork"; selector: string };

interface InitialSessionResolution {
  sessionId: string;
  forkedFrom?: string;
}

interface RetryCountdown {
  nextAttempt: number;
  maxAttempts: number;
  deadlineMs: number;
}

const RESUMABLE_SESSION_KINDS: readonly SessionKind[] = ["chat", "query"];

const MODEL_PROVIDERS: readonly ProviderName[] = [
  "openai-codex",
  "openai-compatible",
  "anthropic-claude",
];

export class StrataApp implements Component {
  private readonly state: AppState;
  private readonly runtime: TuiRuntime;
  private readonly editor: Editor;
  private readonly registry: SlashCommandRegistry;
  private readonly authDialog: AuthDialog;
  private readonly sessionSelector: SessionSelector;
  private readonly modelSelector: ModelSelector;
  private readonly statusLine: StatusLine;
  private readonly footer: Footer;
  private readonly repoRoot: string;
  private readonly initialSession: InitialSessionAction | undefined;
  private currentRun: AbortController | undefined;
  private retryCountdown: RetryCountdown | undefined;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private exitRequested = false;
  private invalidating = false;
  private initialSessionStarted = false;

  constructor(
    runtime: TuiRuntime,
    options: StrataAppOptions,
    authStatus: Awaited<ReturnType<typeof loadAuthStatus>>,
  ) {
    this.runtime = runtime;
    this.repoRoot = options.repoRoot;
    this.initialSession = options.initialSession;
    this.state = initialAppState(options.provider, options.model, authStatus);
    if (options.reasoningEffort !== undefined) {
      this.state.reasoningEffort = options.reasoningEffort;
    }
    this.registry = new SlashCommandRegistry();
    const fileMentions = new FileMentionProvider(this.repoRoot);
    const autocomplete = new CombinedAutocompleteProvider([this.registry, fileMentions]);
    this.editor = new Editor({
      placeholder: "Ask Strata about your wiki, or type /help",
      autocomplete,
      onSubmit: (text) => void this.onSubmit(text),
      onCancel: () => this.handleEditorEscape(),
    });
    void this.loadEditorHistory();
    this.authDialog = new AuthDialog(() => this.invalidate());
    this.sessionSelector = new SessionSelector(() => this.invalidate());
    this.modelSelector = new ModelSelector();
    this.statusLine = new StatusLine(this.state);
    this.footer = new Footer(this.state, this.repoRoot);
    this.registerCommands();
    void this.registerSkillCommands();
    appendTranscript(this.state, { kind: "header", lines: buildStartupHeader() });
    this.runtime.onInput((event) => {
      if (event.type === "key") {
        if (event.key === "ctrl+c") {
          this.handleCtrlC();
        } else if (event.key === "ctrl+l") {
          this.runtime.forceRedraw();
        } else if (event.key === "ctrl+d" && this.editor.text === "") {
          this.requestExit();
        } else if (event.key === "ctrl+z") {
          this.handleCtrlZ();
        } else if (event.key === "shift+tab") {
          this.cycleThinkingLevel();
        } else if (event.key === "alt+enter") {
          this.handleAltEnter();
        }
      }
    });
  }

  get running(): boolean {
    return !this.exitRequested;
  }

  exitMessage(commandBase = "bun run strata tui"): string {
    return buildTuiExitMessage(
      {
        currentSessionId: this.state.currentSessionId,
        usage: this.state.usage,
        contextWindow: this.state.contextWindow,
      },
      commandBase,
    );
  }

  startInitialSession(): void {
    if (this.initialSessionStarted) {
      return;
    }
    this.initialSessionStarted = true;
    if (this.initialSession === undefined) {
      return;
    }
    void this.applyInitialSession(this.initialSession);
  }

  render(ctx: RenderContext): Frame {
    const transcript = new Transcript(this.state.transcript).render(ctx);
    const status = this.statusLine.render(ctx);
    const editorBorder = new DynamicBorder().render(ctx);
    const editorReplacement = this.activeBlockingOverlay();
    const editorFrame = (editorReplacement ?? this.editor).render(ctx);
    const footer = this.footer.render(ctx);

    const lines: string[] = [
      ...transcript.lines,
      ...status.lines,
      ...editorBorder.lines,
      ...editorFrame.lines,
      ...footer.lines,
    ];

    let cursor: Frame["cursor"] | undefined;
    if (editorFrame.cursor !== undefined) {
      cursor = {
        row:
          transcript.lines.length +
          status.lines.length +
          editorBorder.lines.length +
          editorFrame.cursor.row,
        col: editorFrame.cursor.col,
      };
    }
    return cursor === undefined ? { lines } : { lines, cursor };
  }

  handleInput(event: import("../keys.js").InputEvent): "consumed" | "passthrough" {
    const overlay = this.activeBlockingOverlay();
    if (overlay !== undefined) {
      return overlay.handleInput?.(event) ?? "consumed";
    }
    return this.editor.handleInput?.(event) ?? "passthrough";
  }

  private activeBlockingOverlay(): Component | undefined {
    if (this.sessionSelector.active) return this.sessionSelector;
    if (this.modelSelector.active) return this.modelSelector;

    if (this.authDialog.active) return this.authDialog;
    return undefined;
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
        // Pi-aligned: print into the transcript (which inherits terminal
        // scrollback) instead of a height-bounded modal — `/help` content
        // can grow with the slash-command list and would otherwise be
        // silently truncated on short terminals.
        const commands = this.registry
          .list()
          .map((cmd) => ({ name: cmd.name, description: cmd.description }));
        appendTranscript(this.state, { kind: "notice", lines: buildHelpNotice(commands) });
        this.invalidate();
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
      description: "exit strata tui",
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
          `anthropic-claude: ${this.state.auth.anthropicLoggedIn ? `logged in (expires ${this.state.auth.anthropicExpiresAt !== undefined ? new Date(this.state.auth.anthropicExpiresAt).toISOString() : "unknown"})` : "not logged in"}`,
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
      description: "sign in to openai-codex or anthropic-claude",
      run: (args) => {
        const provider = args.trim() === "anthropic-claude" ? "anthropic-claude" : "openai-codex";
        this.authDialog.start((result) => {
          appendTranscript(this.state, {
            kind: result.ok ? "status" : "error",
            content: result.message,
          });
          void loadAuthStatus().then((auth) => {
            this.state.auth = auth;
            if (result.ok) {
              setModelSelection(this.state, provider, defaultModel(provider));
              this.persistPreferences();
            }
            this.invalidate();
          });
        }, provider);
        this.invalidate();
      },
    });
    this.registry.register({
      name: "logout",
      description: "remove openai-codex or anthropic-claude credentials",
      run: async (args) => {
        const provider = args.trim() === "anthropic-claude" ? "anthropic-claude" : "openai-codex";
        if (provider === "anthropic-claude") {
          await logoutAnthropic();
        } else {
          await logoutChatGpt();
        }
        this.state.auth = await loadAuthStatus();
        appendTranscript(this.state, { kind: "status", content: `Logged out of ${provider}.` });
        this.invalidate();
      },
    });

    this.registry.register({
      name: "model",
      description: "pick a model from any provider",
      run: () => {
        this.modelSelector.open(
          this.state.provider,
          this.state.model,
          (model) => {
            setModelSelection(this.state, model.provider, model.id);
            this.persistPreferences();
            appendTranscript(this.state, {
              kind: "status",
              content: `model set to ${model.provider}/${model.id}`,
            });
            this.modelSelector.close();
            this.invalidate();
          },
          () => {
            this.modelSelector.close();
            this.invalidate();
          },
        );
        this.invalidate();
        void listAllModelOptions(this.repoRoot).then(
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
        const { createDefaultToolRegistry } = await import("@strata/tools");
        const tools = createDefaultToolRegistry().list();
        appendTranscript(this.state, {
          kind: "status",
          content: `tools: ${tools.map((t) => t.name).join(", ")}`,
        });
        this.invalidate();
      },
    });
  }

  // Pi-style: each discovered `.strata/skills` or `.agents/skills` skill is
  // exposed as a `/skill:<name>` slash command. Invoking it expands SKILL.md
  // into a skill block. Args after the name are appended.
  private async registerSkillCommands(): Promise<void> {
    let skills: Awaited<ReturnType<typeof listSkills>>;
    try {
      skills = await listSkills(this.repoRoot);
    } catch {
      return;
    }
    for (const skill of skills) {
      const commandName = `skill:${skill.name}`;
      this.registry.register({
        name: commandName,
        description: skill.description === "" ? `run skill ${skill.name}` : skill.description,
        run: (args) => this.invokeSkill(skill.name, args),
      });
    }
  }

  private async invokeSkill(name: string, args: string): Promise<void> {
    let document: Awaited<ReturnType<typeof readSkill>>;
    try {
      document = await readSkill(this.repoRoot, name);
    } catch (error: unknown) {
      appendTranscript(this.state, {
        kind: "error",
        content: `failed to load skill ${name}: ${error instanceof Error ? error.message : String(error)}`,
      });
      this.invalidate();
      return;
    }
    const trimmedArgs = args.trim();
    const location = path.resolve(this.repoRoot, document.metadata.path);
    const skillBlock = [
      `<skill name="${escapeXmlAttribute(document.metadata.name)}" location="${escapeXmlAttribute(location)}">`,
      `References are relative to ${path.dirname(location)}.`,
      "",
      stripFrontmatter(document.content).trim(),
      "</skill>",
    ].join("\n");
    const prompt = trimmedArgs === "" ? skillBlock : `${skillBlock}\n\n${trimmedArgs}`;
    await this.onSubmit(prompt);
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
      // Queue the message to be sent after the current run finishes — same
      // behavior as alt+enter while streaming. Pi treats Enter and Alt+Enter
      // identically when streaming.
      this.state.queuedMessages.push(trimmed);
      const preview = trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
      appendTranscript(this.state, {
        kind: "status",
        content: `queued (${this.state.queuedMessages.length}): ${preview}`,
      });
      this.invalidate();
      return;
    }
    await this.runAgent(trimmed);
  }

  private async createToolRegistry(signal: AbortSignal) {
    const packs: ToolPack[] = [createConfiguredMcpToolPack()];

    return createToolRegistryWithPacks({
      context: {
        repoRoot: this.repoRoot,
        env: Bun.env,
        signal,
      },
      packs,
    });
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
    // Note: we do NOT disable the editor while the agent is running. The user
    // can keep typing, browse history with up/down, and submit via Enter or
    // alt+enter — both paths queue the message until the current run finishes.
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
        tools: await this.createToolRegistry(signal),
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
      this.clearRetryCountdown();
      this.state.running = false;
      this.currentRun = undefined;
      this.invalidate();
      void this.afterRun();
    }
  }

  private async afterRun(): Promise<void> {
    await this.drainQueuedMessages();
  }

  // Pi-style alt+enter: when the agent is running, queue the editor's text
  // to be sent after the current run finishes. When the agent isn't running,
  // alt+enter behaves like enter. Plain enter while running also queues now,
  // so this path is mostly redundant — but kept so users with both habits get
  // the same result either way.
  private handleAltEnter(): void {
    const text = this.editor.text;
    if (text.trim() === "") {
      return;
    }
    this.editor.history.push(text);
    this.editor.historyIndex = undefined;
    this.editor.text = "";
    this.editor.cursor = 0;
    void this.onSubmit(text);
  }

  private async drainQueuedMessages(): Promise<void> {
    if (this.state.queuedMessages.length === 0 || this.state.running) {
      return;
    }
    const next = this.state.queuedMessages.shift();
    if (next === undefined) return;
    appendTranscript(this.state, {
      kind: "status",
      content: `▸ sending queued message`,
    });
    this.invalidate();
    await this.onSubmit(next);
  }

  private applyAgentEvent(event: AgentRunEvent): void {
    switch (event.type) {
      case "session.started":
        startSession(this.state, event.sessionId);
        this.state.status = `session ${event.sessionId.slice(0, 12)} · ${sanitizeDisplayText(event.title)}`;
        return;
      case "model.request":
        this.clearRetryCountdown();
        this.state.status = `thinking (iter ${event.iteration})`;
        return;
      case "model.retry":
        this.retryCountdown = {
          nextAttempt: event.nextAttempt,
          maxAttempts: event.maxAttempts,
          deadlineMs: Date.now() + event.delayMs,
        };
        this.refreshRetryStatus();
        return;
      case "assistant.delta":
        this.clearRetryCountdown();
        appendAssistantDelta(this.state, event.iteration, event.contentDelta);
        return;
      case "model.response":
        this.clearRetryCountdown();
        recordModelUsage(this.state, event.usage);
        finalizeAssistantStream(this.state, event.iteration, event.content);
        return;
      case "compaction.started":
        appendTranscript(this.state, {
          kind: "status",
          content: "context window getting full — auto-compacting…",
        });
        return;
      case "compaction.completed":
        appendTranscript(this.state, {
          kind: "status",
          content: `auto-compacted ${event.messagesSummarized} messages${event.incremental ? " (incremental)" : ""}`,
        });
        resetTokenUsage(this.state.usage);
        return;
      case "compaction.failed":
        appendTranscript(this.state, {
          kind: "error",
          content: `auto-compact failed: ${event.message}`,
        });
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
        this.clearRetryCountdown();
        recordCompletion(this.state, event.result);
        return;
      case "agent.failed":
        this.clearRetryCountdown();
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
      this.interruptCurrentRun();
      return;
    }
    if (this.editor.text !== "") {
      this.editor.reset();
      this.invalidate();
      return;
    }
    this.requestExit();
  }

  private interruptCurrentRun(): void {
    const currentRun = this.currentRun;
    if (currentRun === undefined) {
      return;
    }
    const retrying = this.retryCountdown !== undefined;
    this.clearRetryCountdown();
    if (!currentRun.signal.aborted) {
      currentRun.abort({
        source: "tui.interrupt",
        message: retrying ? "user cancelled model retry" : "user interrupted agent run",
      });
    }
    this.state.status = retrying ? "cancelling retry…" : "interrupting agent…";
    appendTranscript(this.state, {
      kind: "status",
      content: retrying ? "cancelling retry…" : "interrupting agent…",
    });
    this.invalidate();
  }

  private requestExit(): void {
    this.exitRequested = true;
    this.stopAnimationLoop();
    this.runtime.stop();
  }

  private handleCtrlZ(): void {
    if (process.platform === "win32") {
      appendTranscript(this.state, {
        kind: "status",
        content: "Suspend to background is not supported on Windows",
      });
      this.invalidate();
      return;
    }

    // Mirrors Pi: restore the terminal before stopping the process group, then
    // rebuild the TUI when the shell resumes us with `fg`.
    const suspendKeepAlive = setInterval(() => {}, 2 ** 30);
    const ignoreSigint = () => {};
    process.on("SIGINT", ignoreSigint);
    process.once("SIGCONT", () => {
      clearInterval(suspendKeepAlive);
      process.removeListener("SIGINT", ignoreSigint);
      this.runtime.start();
      this.runtime.forceRedraw();
    });

    try {
      this.runtime.stop();
      process.kill(0, "SIGTSTP");
    } catch (error: unknown) {
      clearInterval(suspendKeepAlive);
      process.removeListener("SIGINT", ignoreSigint);
      throw error;
    }
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
      this.refreshRetryStatus();
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

  private clearRetryCountdown(): void {
    this.retryCountdown = undefined;
  }

  private refreshRetryStatus(): void {
    const countdown = this.retryCountdown;
    if (countdown === undefined) {
      return;
    }
    const remainingMs = Math.max(0, countdown.deadlineMs - Date.now());
    const timing = remainingMs === 0 ? "now" : `in ${formatRetryCountdown(remainingMs)}`;
    this.state.status = `model unavailable; retry ${countdown.nextAttempt}/${countdown.maxAttempts} ${timing} (Ctrl+C/Esc to cancel)`;
  }

  // Pi-aligned escape handler. Mirrors `interactive-mode.ts:onEscape`:
  // a single Esc during an active run aborts the run (and queued messages);
  // double-Esc on an empty/idle editor opens the resume picker. Esc with
  // text in the editor is a no-op (the editor itself handled completion
  // dismissal before reaching us). We only get called when the editor has
  // no completion list to close.
  private lastEscapeAt = 0;
  private static readonly DOUBLE_ESCAPE_MS = 500;

  private handleEditorEscape(): void {
    // Pi's first branch: streaming → abort the run. Strata's equivalent is
    // an in-flight `currentRun`. Resetting `lastEscapeAt` here ensures the
    // user can't accidentally chain Esc-Esc-Esc into "abort + open picker"
    // — which is what made double-Esc look "screwed up" when a run was
    // mid-stream.
    if (this.currentRun !== undefined) {
      this.interruptCurrentRun();
      this.lastEscapeAt = 0;
      return;
    }
    if (this.editor.text.trim() !== "") {
      this.lastEscapeAt = 0;
      return;
    }
    const now = Date.now();
    if (now - this.lastEscapeAt < StrataApp.DOUBLE_ESCAPE_MS) {
      this.lastEscapeAt = 0;
      void this.openSessionPicker("resume");
      return;
    }
    this.lastEscapeAt = now;
  }

  private cycleThinkingLevel(): void {
    this.state.reasoningEffort = nextThinkingLevel(
      this.state.reasoningEffort,
      supportedThinkingLevels(this.state.provider, this.state.model),
    );
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
    const runtimeDir = getStrataPaths(this.repoRoot).runtimeDir;
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
      const sessions = store.listSessions(30, RESUMABLE_SESSION_KINDS);
      this.sessionSelector.open(
        sessions,
        (session) => {
          this.sessionSelector.close();
          this.invalidate();
          if (action === "resume") {
            void this.resumeSession(session.id);
          }
        },
        () => {
          this.sessionSelector.close();
          this.invalidate();
        },
        async (session) => {
          const deleteStore = await SessionStore.open(this.repoRoot);
          try {
            return await deleteStore.deleteSession(session.id);
          } finally {
            deleteStore.close();
          }
        },
        this.state.currentSessionId,
      );
      this.invalidate();
    } finally {
      store.close();
    }
  }

  private async applyInitialSession(action: InitialSessionAction): Promise<void> {
    try {
      if (action.type === "resume") {
        await this.openSessionPicker("resume");
        return;
      }

      const resolution = await this.resolveInitialSession(action);
      if (resolution === undefined) {
        return;
      }
      await this.resumeSession(resolution.sessionId);
      if (resolution.forkedFrom !== undefined) {
        appendTranscript(this.state, {
          kind: "status",
          content: `forked from ${resolution.forkedFrom.slice(0, 12)}`,
        });
        this.invalidate();
      }
    } catch (error: unknown) {
      appendTranscript(this.state, {
        kind: "error",
        content: error instanceof Error ? error.message : String(error),
      });
      this.invalidate();
    }
  }

  private async resolveInitialSession(
    action: Exclude<InitialSessionAction, { type: "resume" }>,
  ): Promise<InitialSessionResolution | undefined> {
    const store = await SessionStore.open(this.repoRoot);
    try {
      if (action.type === "continue") {
        const session = store.listSessions(1, RESUMABLE_SESSION_KINDS)[0];
        if (session === undefined) {
          throw new Error("No sessions found to continue");
        }
        return { sessionId: session.id };
      }

      const session = this.resolveSessionSelector(store, action.selector);
      if (action.type === "session") {
        return { sessionId: session.id };
      }

      const cloned = await store.cloneSession(session.id);
      return { sessionId: cloned.id, forkedFrom: session.id };
    } finally {
      store.close();
    }
  }

  private resolveSessionSelector(store: SessionStore, selector: string): SessionRecord {
    const exact = store.getSession(selector);
    if (exact !== undefined) {
      if (!isResumableSessionKind(exact.kind)) {
        throw new Error(`Session is not resumable in the TUI: ${selector}`);
      }
      return exact;
    }

    const matches = store
      .findSessionsByIdPrefix(selector, 20)
      .filter((session) => isResumableSessionKind(session.kind));
    if (matches.length === 0) {
      throw new Error(`No session found matching '${selector}'`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Session id prefix is ambiguous: ${selector} (${matches.map((session) => session.id).join(", ")})`,
      );
    }
    const match = matches[0];
    if (match === undefined) {
      throw new Error(`No session found matching '${selector}'`);
    }
    return match;
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
      // historically stored adapter names like `openai-codex:gpt-5.5`;
      // split known provider prefixes so the backend receives the raw model id.
      if (session.model !== null) {
        const selection = modelSelectionFromStoredModel(session.model, this.state.provider);
        setModelSelection(this.state, selection.provider, selection.model);
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
        content: `resumed ${sessionDisplayTitle(session)} (${messages.length} prior messages)`,
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
          appendTranscript(this.state, {
            kind: "error",
            content: `session not found: ${sessionId}`,
          });
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
          `title:   ${sessionDisplayTitle(session)}`,
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
    const title = sanitizeDisplayText(args.trim());
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
          content: `renamed session to ${sanitizeDisplayText(title)}`,
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
        appendTranscript(this.state, { kind: "image", attachment });
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
          content: `cloned to ${sessionDisplayTitle(cloned)} (${cloned.id.slice(0, 12)})`,
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
      const runtimeDir = getStrataPaths(this.repoRoot).runtimeDir;
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
      const runtimeDir = getStrataPaths(this.repoRoot).runtimeDir;
      await appendHistory(runtimeDir, prompt);
    } catch {
      // History is best-effort; silently swallow.
    }
  }
}

function sanitizeDisplayText(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

function isResumableSessionKind(kind: SessionKind): boolean {
  return RESUMABLE_SESSION_KINDS.includes(kind);
}

function modelSelectionFromStoredModel(
  storedModel: string,
  fallbackProvider: ProviderName,
): { provider: ProviderName; model: string } {
  const separator = storedModel.indexOf(":");
  if (separator > 0) {
    const provider = parseProviderName(storedModel.slice(0, separator));
    const model = storedModel.slice(separator + 1);
    if (provider !== undefined && model.trim() !== "") {
      return { provider, model };
    }
  }
  return { provider: fallbackProvider, model: storedModel };
}

function formatRetryCountdown(delayMs: number): string {
  return `${Math.max(1, Math.ceil(delayMs / 1000))}s`;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return content;
  }
  return content.slice(end + "\n---".length);
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function buildAppOptions(repoRoot: string): Promise<{
  options: StrataAppOptions;
  authStatus: Awaited<ReturnType<typeof loadAuthStatus>>;
}> {
  const runtimeDir = getStrataPaths(repoRoot).runtimeDir;
  const prefs = await loadPreferences(runtimeDir);
  const provider = parseProviderEnv() ?? prefs.provider ?? (await inferDefaultProvider());
  const model =
    Bun.env.STRATA_MODEL ?? Bun.env.OPENAI_MODEL ?? prefs.model ?? defaultModel(provider);
  const authStatus = await loadAuthStatus();
  const options: StrataAppOptions = { repoRoot, provider, model };
  if (prefs.reasoningEffort !== undefined) {
    options.reasoningEffort = prefs.reasoningEffort;
  }
  return { options, authStatus };
}

async function listAllModelOptions(repoRoot: string): Promise<ModelOption[]> {
  const settled = await Promise.allSettled(
    MODEL_PROVIDERS.map(async (provider) => ({
      provider,
      models: await listModels(provider, { repoRoot }),
    })),
  );
  const models: ModelOption[] = [];
  const errors: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      for (const model of result.value.models) {
        models.push({
          id: model.id,
          description: model.description,
          provider: result.value.provider,
        });
      }
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }
  if (models.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  models.sort((a, b) => {
    const provider = a.provider.localeCompare(b.provider);
    return provider === 0 ? a.id.localeCompare(b.id) : provider;
  });
  return models;
}

function parseProviderEnv(): ProviderName | undefined {
  const value = Bun.env.STRATA_PROVIDER;
  if (value === undefined || value === "") {
    return undefined;
  }
  return parseProviderName(value);
}

function parseProviderName(value: string): ProviderName | undefined {
  return MODEL_PROVIDERS.includes(value as ProviderName) ? (value as ProviderName) : undefined;
}

export interface TuiExitMessageInput {
  currentSessionId: string | undefined;
  usage: TokenUsageTotals;
  contextWindow: number | undefined;
}

export function buildTuiExitMessage(
  input: TuiExitMessageInput,
  commandBase = "bun run strata tui",
): string {
  const lines: string[] = [];
  const tokenUsage = formatExitTokenUsage(input);
  if (tokenUsage !== undefined) {
    lines.push(`Token usage: ${tokenUsage}`);
  }
  if (input.currentSessionId !== undefined) {
    lines.push(`Resume: ${commandBase} -r ${abbreviateSessionId(input.currentSessionId)}`);
  }
  return lines.join("\n");
}

function abbreviateSessionId(sessionId: string): string {
  return sessionId.slice(0, 12);
}

function formatExitTokenUsage(input: TuiExitMessageInput): string | undefined {
  const usage = input.usage;
  if (!hasExitTokenUsage(usage)) {
    return undefined;
  }
  const parts = [
    `input ${formatExactTokenCount(usage.input)}`,
    `output ${formatExactTokenCount(usage.output)}`,
    `cache read ${formatExactTokenCount(usage.cacheRead)}`,
    `cache write ${formatExactTokenCount(usage.cacheWrite)}`,
    `total ${formatExactTokenCount(usage.total)}`,
  ];
  if (usage.cost > 0) {
    parts.push(`cost $${usage.cost.toFixed(3)}`);
  }

  const context = formatExitContextUsage(usage, input.contextWindow);
  if (context !== undefined) {
    parts.push(context);
  }
  return parts.join(" · ");
}

function formatExitContextUsage(
  usage: TokenUsageTotals,
  contextWindow: number | undefined,
): string | undefined {
  if (contextWindow === undefined) {
    return undefined;
  }
  if (usage.latestContextTokens === undefined) {
    return `context window ${formatExactTokenCount(contextWindow)}`;
  }
  const percent = (usage.latestContextTokens / contextWindow) * 100;
  return `last context ${formatExactTokenCount(usage.latestContextTokens)}/${formatExactTokenCount(contextWindow)} (${percent.toFixed(1)}%)`;
}

function hasExitTokenUsage(usage: TokenUsageTotals): boolean {
  return (
    usage.input > 0 ||
    usage.output > 0 ||
    usage.cacheRead > 0 ||
    usage.cacheWrite > 0 ||
    usage.total > 0 ||
    usage.cost > 0
  );
}

function formatExactTokenCount(count: number): string {
  return Math.max(0, Math.round(count)).toLocaleString("en-US");
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
