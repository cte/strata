import path from "node:path";
import os from "node:os";
import { padToWidth, theme, truncateToWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { DynamicBorder, Loader } from "../components.js";
import type { AppState } from "./state.js";

export class Header implements Component {
  state: AppState;
  repoRoot: string;

  constructor(state: AppState, repoRoot: string) {
    this.state = state;
    this.repoRoot = repoRoot;
  }

  render(ctx: RenderContext): Frame {
    const repo = shortenPath(this.repoRoot);
    const left = `${theme.bold("cortex")} ${theme.muted(repo)}`;
    const right = `${theme.muted(this.state.provider)} ${theme.accent(this.state.model)}`;
    const total = visibleLength(left) + visibleLength(right);
    const gap = Math.max(1, ctx.width - total);
    const line = `${left}${" ".repeat(gap)}${right}`;
    const border = new DynamicBorder().render(ctx).lines[0] ?? "";
    return { lines: [padToWidth(truncateToWidth(line, ctx.width), ctx.width), border] };
  }
}

export class StatusLine implements Component {
  state: AppState;
  private loader = new Loader("Thinking");

  constructor(state: AppState) {
    this.state = state;
  }

  render(ctx: RenderContext): Frame {
    if (this.state.running) {
      return this.loader.render(ctx);
    }
    if (this.state.status !== undefined) {
      return {
        lines: [padToWidth(truncateToWidth(theme.muted(this.state.status), ctx.width), ctx.width)],
      };
    }
    return { lines: [padToWidth("", ctx.width)] };
  }
}

export class Footer implements Component {
  state: AppState;

  constructor(state: AppState) {
    this.state = state;
  }

  render(ctx: RenderContext): Frame {
    const auth = this.state.auth.codexLoggedIn
      ? theme.success("auth✓")
      : this.state.auth.apiKeyConfigured
        ? theme.success("api-key✓")
        : theme.warning("auth✗");
    const session =
      this.state.currentSessionId !== undefined ? theme.muted(this.state.currentSessionId.slice(0, 12)) : theme.muted("no session");
    const hint = theme.muted("/help · /quit");
    const left = `${auth} ${session}`;
    const total = visibleLength(left) + visibleLength(hint);
    const gap = Math.max(1, ctx.width - total);
    const border = `${theme.muted("─".repeat(ctx.width))}`;
    return {
      lines: [
        border,
        padToWidth(truncateToWidth(`${left}${" ".repeat(gap)}${hint}`, ctx.width), ctx.width),
      ],
    };
  }
}

export class HelpOverlay implements Component {
  active = false;
  lines: string[];

  constructor(commands: { name: string; description: string }[]) {
    this.lines = [
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
      ...commands.map((cmd) => `  /${cmd.name.padEnd(10)} ${cmd.description}`),
      "",
      "Press Esc or Enter to dismiss.",
    ];
  }

  render(ctx: RenderContext): Frame {
    if (!this.active) {
      return { lines: [] };
    }
    const width = Math.min(ctx.width, 60);
    const padding = 2;
    const innerWidth = width - 2 - padding * 2;
    const inner = this.lines.flatMap((line) => [truncateToWidth(line, innerWidth)]);
    const lines: string[] = [];
    const horizontal = "─".repeat(Math.max(0, width - 2));
    lines.push(theme.accent(`┌${horizontal}┐`));
    lines.push(theme.accent(`│${" ".repeat(width - 2)}│`));
    for (const line of inner) {
      lines.push(theme.accent("│") + " ".repeat(padding) + padToWidth(line, innerWidth) + " ".repeat(padding) + theme.accent("│"));
    }
    lines.push(theme.accent(`│${" ".repeat(width - 2)}│`));
    lines.push(theme.accent(`└${horizontal}┘`));
    const padded = lines.map((line) => centerLine(line, ctx.width));
    return { lines: padded };
  }

  handleInput(event: { type: string; key?: string }): "consumed" | "passthrough" {
    if (!this.active) {
      return "passthrough";
    }
    if (event.type === "key" && (event.key === "escape" || event.key === "enter")) {
      this.active = false;
      return "consumed";
    }
    return "consumed";
  }
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;
}

function centerLine(line: string, width: number): string {
  const len = visibleLength(line);
  if (len >= width) {
    return line;
  }
  const left = Math.floor((width - len) / 2);
  return " ".repeat(left) + padToWidth(line, width - left);
}

function shortenPath(repoRoot: string): string {
  const home = os.homedir();
  if (repoRoot === home) {
    return "~";
  }
  if (repoRoot.startsWith(home + path.sep)) {
    return `~${repoRoot.slice(home.length)}`;
  }
  return repoRoot;
}
