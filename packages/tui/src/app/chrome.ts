import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { padToWidth, theme, truncateToWidth, visibleWidth } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { Loader } from "../components.js";
import type { AppState } from "./state.js";
import { formatTokens } from "./usage.js";

export class StatusLine implements Component {
  state: AppState;
  private loader = new Loader("Thinking");

  constructor(state: AppState) {
    this.state = state;
  }

  render(ctx: RenderContext): Frame {
    const blank = padToWidth("", ctx.width);
    if (this.state.running) {
      return { lines: [blank, ...this.loader.render(ctx).lines] };
    }
    if (this.state.status !== undefined) {
      return {
        lines: [
          blank,
          padToWidth(truncateToWidth(theme.muted(this.state.status), ctx.width), ctx.width),
        ],
      };
    }
    return { lines: [blank] };
  }
}

export class Footer implements Component {
  state: AppState;
  repoRoot: string;
  private gitBranch: string | undefined;
  private gitBranchCheckedAt = 0;

  constructor(state: AppState, repoRoot: string) {
    this.state = state;
    this.repoRoot = repoRoot;
  }

  render(ctx: RenderContext): Frame {
    const left = this.renderStatusLeft();
    const rightWithProvider = theme.muted(`(${this.state.provider}) ${this.modelStatus()}`);
    const rightWithoutProvider = theme.muted(this.modelStatus());
    const right =
      visibleWidth(left) + 2 + visibleWidth(rightWithProvider) <= ctx.width
        ? rightWithProvider
        : rightWithoutProvider;
    return {
      lines: [
        theme.muted("─".repeat(ctx.width)),
        padToWidth(theme.muted(truncateToWidth(this.locationStatus(), ctx.width)), ctx.width),
        alignLeftRight(left, right, ctx.width),
      ],
    };
  }

  private renderStatusLeft(): string {
    const stats = this.renderUsageStats();
    if (stats !== "") {
      return stats;
    }
    const status = this.state.status?.trim();
    if (status !== undefined && status !== "") {
      return theme.muted(sanitizeStatusText(status));
    }
    return theme.muted("/help · /quit");
  }

  private renderUsageStats(): string {
    const usage = this.state.usage;
    const parts: string[] = [];
    if (usage.input > 0) {
      parts.push(theme.muted(`↑${formatTokens(usage.input)}`));
    }
    if (usage.output > 0) {
      parts.push(theme.muted(`↓${formatTokens(usage.output)}`));
    }
    if (usage.cacheRead > 0) {
      parts.push(theme.muted(`R${formatTokens(usage.cacheRead)}`));
    }
    if (usage.cacheWrite > 0) {
      parts.push(theme.muted(`W${formatTokens(usage.cacheWrite)}`));
    }
    if (usage.cost > 0) {
      parts.push(theme.muted(`$${usage.cost.toFixed(3)}`));
    }
    const context = this.renderContextUsage();
    if (context !== undefined) {
      parts.push(context);
    }
    return parts.join(theme.muted(" "));
  }

  private renderContextUsage(): string | undefined {
    const contextWindow = this.state.contextWindow;
    if (contextWindow === undefined) {
      return undefined;
    }
    const latestContextTokens = this.state.usage.latestContextTokens;
    if (latestContextTokens === undefined) {
      return theme.muted(`?/${formatTokens(contextWindow)}`);
    }
    const percent = (latestContextTokens / contextWindow) * 100;
    const display = `${percent.toFixed(1)}%/${formatTokens(contextWindow)}`;
    if (percent > 90) {
      return theme.error(display);
    }
    if (percent > 70) {
      return theme.warning(display);
    }
    return theme.muted(display);
  }

  private locationStatus(): string {
    const branch = this.getGitBranch();
    const parts = [
      branch === undefined
        ? shortenPath(this.repoRoot)
        : `${shortenPath(this.repoRoot)} (${branch})`,
    ];
    if (this.state.currentSessionId !== undefined) {
      parts.push(`session ${this.state.currentSessionId.slice(0, 12)}`);
    } else {
      parts.push("no session");
    }
    return parts.join(" • ");
  }

  private modelStatus(): string {
    const thinking =
      this.state.reasoningEffort === "off" ? "thinking off" : this.state.reasoningEffort;
    return `${this.state.model} • ${thinking}`;
  }

  private getGitBranch(): string | undefined {
    const now = Date.now();
    if (now - this.gitBranchCheckedAt < 2000) {
      return this.gitBranch;
    }
    this.gitBranchCheckedAt = now;
    this.gitBranch = readGitBranch(this.repoRoot);
    return this.gitBranch;
  }
}

export class HelpOverlay implements Component {
  active = false;
  lines: string[];
  onDismiss: () => void = () => {};

  constructor(commands: { name: string; description: string }[]) {
    this.lines = buildHelpContent(commands);
  }

  render(ctx: RenderContext): Frame {
    return centerModal(this.lines, "help", ctx);
  }

  handleInput(event: { type: string; key?: string }): "consumed" | "passthrough" {
    if (event.type === "key" && (event.key === "escape" || event.key === "enter")) {
      this.active = false;
      this.onDismiss();
      return "consumed";
    }
    return "consumed";
  }
}

function buildHelpContent(commands: { name: string; description: string }[]): string[] {
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
    ...commands.map((cmd) => `  /${cmd.name.padEnd(10)} ${cmd.description}`),
    "",
    "Press Esc or Enter to dismiss.",
  ];
}

export function centerModal(content: string[], title: string, ctx: RenderContext): Frame {
  const boxWidth = Math.min(ctx.width, Math.max(40, Math.min(80, ctx.width - 4)));
  const padding = 2;
  const innerWidth = Math.max(1, boxWidth - 2 - padding * 2);
  const wrapped: string[] = [];
  for (const line of content) {
    wrapped.push(truncateToWidth(line, innerWidth));
  }
  const boxLines: string[] = [];
  const horizontalRest = "─".repeat(Math.max(0, boxWidth - 2 - title.length - 4));
  const titleLabel = title === "" ? "─".repeat(boxWidth - 2) : `─ ${title} ${horizontalRest}`;
  boxLines.push(theme.accent(`┌${titleLabel.padEnd(boxWidth - 2, "─")}┐`));
  boxLines.push(theme.accent(`│${" ".repeat(boxWidth - 2)}│`));
  for (const line of wrapped) {
    boxLines.push(
      theme.accent("│") +
        " ".repeat(padding) +
        padToWidth(line, innerWidth) +
        " ".repeat(padding) +
        theme.accent("│"),
    );
  }
  boxLines.push(theme.accent(`│${" ".repeat(boxWidth - 2)}│`));
  boxLines.push(theme.accent(`└${"─".repeat(boxWidth - 2)}┘`));
  const horizontalCentered = boxLines.map((line) => centerLine(line, ctx.width));
  const verticalPadAbove = Math.max(0, Math.floor((ctx.height - horizontalCentered.length) / 2));
  const out: string[] = [];
  for (let i = 0; i < verticalPadAbove; i += 1) {
    out.push(padToWidth("", ctx.width));
  }
  out.push(...horizontalCentered);
  while (out.length < ctx.height) {
    out.push(padToWidth("", ctx.width));
  }
  if (out.length > ctx.height) {
    out.length = ctx.height;
  }
  return { lines: out };
}

function centerLine(line: string, width: number): string {
  const len = visibleWidth(line);
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

function alignLeftRight(left: string, right: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  const minGap = 2;
  const rightWidth = visibleWidth(right);
  const availableLeft = Math.max(0, width - minGap - rightWidth);
  const fittedLeft =
    visibleWidth(left) > availableLeft && availableLeft > 0
      ? truncateToWidth(left, availableLeft)
      : left;
  const leftWidth = visibleWidth(fittedLeft);
  if (leftWidth + minGap + rightWidth <= width) {
    return padToWidth(`${fittedLeft}${" ".repeat(width - leftWidth - rightWidth)}${right}`, width);
  }
  if (rightWidth <= width) {
    return padToWidth(right, width);
  }
  return padToWidth(truncateToWidth(right, width), width);
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function readGitBranch(repoRoot: string): string | undefined {
  const argsPrefix = ["--no-optional-locks"];
  try {
    const branch = execFileSync("git", [...argsPrefix, "branch", "--show-current"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 100,
    }).trim();
    if (branch !== "") {
      return branch;
    }
    const hash = execFileSync("git", [...argsPrefix, "rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 100,
    }).trim();
    return hash === "" ? undefined : `detached:${hash}`;
  } catch {
    return undefined;
  }
}
