import type { ToolExecutionResult } from "@cortex/tools";
import { padToWidth, theme, truncateToWidth, wrapText } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { Markdown } from "../components.js";
import type { TranscriptItem } from "./state.js";

export class Transcript implements Component {
  items: TranscriptItem[];

  constructor(items: TranscriptItem[]) {
    this.items = items;
  }

  render(ctx: RenderContext): Frame {
    if (this.items.length === 0) {
      const hint = padToWidth(theme.muted("Type a question or /help to begin."), ctx.width);
      return { lines: [hint] };
    }
    const lines: string[] = [];
    for (const item of this.items) {
      lines.push(...renderItem(item, ctx.width));
      lines.push(padToWidth("", ctx.width));
    }
    if (lines.length > 0 && lines[lines.length - 1] !== undefined) {
      lines.pop();
    }
    return { lines };
  }
}

function renderItem(item: TranscriptItem, width: number): string[] {
  switch (item.kind) {
    case "user":
      return decorate(item.content, theme.accent("you"), width);
    case "assistant":
      return [
        ...prefixHeader(theme.success("cortex"), width),
        ...new Markdown(item.content).render({ width, height: 0 }).lines,
      ];
    case "tool":
      return renderToolItem(item, width);
    case "status":
      return [padToWidth(theme.muted(`· ${truncateToWidth(item.content, width - 2)}`), width)];
    case "error":
      return [padToWidth(theme.error(`! ${truncateToWidth(item.content, width - 2)}`), width)];
  }
}

function decorate(content: string, header: string, width: number): string[] {
  const headerLine = padToWidth(theme.bold(header), width);
  const body = wrapText(content, width).map((line) => padToWidth(line, width));
  return [headerLine, ...body];
}

function prefixHeader(header: string, width: number): string[] {
  return [padToWidth(theme.bold(header), width)];
}

function renderToolItem(item: Extract<TranscriptItem, { kind: "tool" }>, width: number): string[] {
  const status = formatToolStatus(item.result);
  const header = `${theme.warning("⚙")} ${theme.bold(item.toolName)} ${status}`;
  const lines = [padToWidth(truncateToWidth(header, width), width)];
  const args = formatArgs(item.argumentsText);
  if (args !== "") {
    lines.push(
      padToWidth(theme.muted(`  args: ${truncateToWidth(args, Math.max(0, width - 8))}`), width),
    );
  }
  if (item.result !== undefined) {
    lines.push(...formatResult(item.result, width));
  }
  return lines;
}

function formatToolStatus(result: ToolExecutionResult | undefined): string {
  if (result === undefined) {
    return theme.muted("(running…)");
  }
  if (result.ok) {
    return theme.success("✓") + (result.truncated ? theme.muted(" (truncated)") : "");
  }
  return theme.error(`✗ ${result.error.code}`);
}

function formatArgs(argumentsText: string): string {
  if (argumentsText === "" || argumentsText === "{}") {
    return "";
  }
  try {
    const parsed: unknown = JSON.parse(argumentsText);
    if (parsed === null || typeof parsed !== "object") {
      return argumentsText;
    }
    return JSON.stringify(parsed);
  } catch {
    return argumentsText;
  }
}

function formatResult(result: ToolExecutionResult, width: number): string[] {
  if (!result.ok) {
    return [
      padToWidth(
        theme.muted(`  → ${truncateToWidth(result.error.message, Math.max(0, width - 4))}`),
        width,
      ),
    ];
  }
  const summary = stringifySummary(result.result);
  if (summary === "") {
    return [];
  }
  return [
    padToWidth(theme.muted(`  → ${truncateToWidth(summary, Math.max(0, width - 4))}`), width),
  ];
}

function stringifySummary(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value);
}
