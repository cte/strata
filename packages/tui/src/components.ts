import {
  padToWidth,
  sliceByWidth,
  theme,
  truncateToWidth,
  visibleWidth,
  wrapText,
} from "./ansi.js";
import type { Component, Frame, RenderContext } from "./component.js";
import type { InputEvent } from "./keys.js";

export class Text implements Component {
  text: string;
  style?: (text: string) => string;

  constructor(text = "", style?: (text: string) => string) {
    this.text = text;
    if (style !== undefined) {
      this.style = style;
    }
  }

  render(ctx: RenderContext): Frame {
    const lines = wrapText(this.text, ctx.width);
    const styled = this.style
      ? lines.map((line) => this.style!(line))
      : lines;
    return { lines: styled.map((line) => padToWidth(line, ctx.width)) };
  }
}

export class TruncatedText implements Component {
  text: string;
  style?: (text: string) => string;

  constructor(text = "", style?: (text: string) => string) {
    this.text = text;
    if (style !== undefined) {
      this.style = style;
    }
  }

  render(ctx: RenderContext): Frame {
    const truncated = truncateToWidth(this.text, ctx.width);
    const styled = this.style ? this.style(truncated) : truncated;
    return { lines: [padToWidth(styled, ctx.width)] };
  }
}

export class Spacer implements Component {
  rows: number;

  constructor(rows = 1) {
    this.rows = rows;
  }

  render(ctx: RenderContext): Frame {
    const blank = padToWidth("", ctx.width);
    return { lines: Array.from({ length: this.rows }, () => blank) };
  }
}

export class DynamicBorder implements Component {
  style: (text: string) => string;
  char: string;

  constructor(char = "─", style: (text: string) => string = theme.muted) {
    this.char = char;
    this.style = style;
  }

  render(ctx: RenderContext): Frame {
    if (ctx.width <= 0) {
      return { lines: [] };
    }
    return { lines: [this.style(this.char.repeat(ctx.width))] };
  }
}

export class Container implements Component {
  children: Component[];

  constructor(children: Component[] = []) {
    this.children = children;
  }

  render(ctx: RenderContext): Frame {
    const lines: string[] = [];
    let cursor: Frame["cursor"] | undefined;
    for (const child of this.children) {
      const frame = child.render(ctx);
      if (frame.cursor !== undefined && cursor === undefined) {
        cursor = { row: lines.length + frame.cursor.row, col: frame.cursor.col };
      }
      for (const line of frame.lines) {
        lines.push(line);
      }
    }
    return cursor === undefined ? { lines } : { lines, cursor };
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    for (const child of this.children) {
      if (child.handleInput?.(event) === "consumed") {
        return "consumed";
      }
    }
    return "passthrough";
  }
}

export interface BoxOptions {
  border?: boolean;
  padding?: number;
  style?: (text: string) => string;
  title?: string;
}

export class Box implements Component {
  child: Component;
  options: BoxOptions;

  constructor(child: Component, options: BoxOptions = {}) {
    this.child = child;
    this.options = options;
  }

  render(ctx: RenderContext): Frame {
    const padding = this.options.padding ?? 0;
    const border = this.options.border === true;
    const style = this.options.style ?? ((t: string) => t);
    const innerWidth = Math.max(0, ctx.width - (border ? 2 : 0) - padding * 2);
    const inner = this.child.render({ width: innerWidth });
    const lines: string[] = [];
    const horizontal = "─".repeat(Math.max(0, ctx.width - 2));
    if (border) {
      const title = this.options.title ?? "";
      const titleSegment = title === "" ? "" : ` ${title} `;
      const remaining = Math.max(0, ctx.width - 2 - visibleWidth(titleSegment));
      const top = `┌${titleSegment}${"─".repeat(remaining)}┐`;
      lines.push(style(top));
    }
    for (let i = 0; i < padding; i += 1) {
      lines.push(border ? style(`│${" ".repeat(ctx.width - 2)}│`) : padToWidth("", ctx.width));
    }
    let cursor: Frame["cursor"] | undefined;
    for (let i = 0; i < inner.lines.length; i += 1) {
      const content = padToWidth(inner.lines[i] ?? "", innerWidth);
      const padded = `${" ".repeat(padding)}${content}${" ".repeat(padding)}`;
      const wrapped = border ? `${style("│")}${padded}${style("│")}` : padded;
      if (inner.cursor !== undefined && inner.cursor.row === i && cursor === undefined) {
        cursor = {
          row: lines.length,
          col: (border ? 1 : 0) + padding + inner.cursor.col,
        };
      }
      lines.push(wrapped);
    }
    for (let i = 0; i < padding; i += 1) {
      lines.push(border ? style(`│${" ".repeat(ctx.width - 2)}│`) : padToWidth("", ctx.width));
    }
    if (border) {
      lines.push(style(`└${horizontal}┘`));
    }
    return cursor === undefined ? { lines } : { lines, cursor };
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    return this.child.handleInput?.(event) ?? "passthrough";
  }
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export class SelectList implements Component {
  options: SelectOption[];
  selectedIndex = 0;
  focused = true;
  onSubmit?: (option: SelectOption) => void;
  onCancel?: () => void;

  constructor(options: SelectOption[] = []) {
    this.options = options;
  }

  render(ctx: RenderContext): Frame {
    const lines: string[] = [];
    for (let i = 0; i < this.options.length; i += 1) {
      const opt = this.options[i];
      if (opt === undefined) {
        continue;
      }
      const marker = i === this.selectedIndex ? theme.accent("›") : " ";
      const label = i === this.selectedIndex ? theme.bold(opt.label) : opt.label;
      const description = opt.description !== undefined ? `  ${theme.muted(opt.description)}` : "";
      lines.push(padToWidth(truncateToWidth(`${marker} ${label}${description}`, ctx.width), ctx.width));
    }
    if (lines.length === 0) {
      lines.push(padToWidth(theme.muted("(no options)"), ctx.width));
    }
    return { lines };
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.focused || event.type !== "key") {
      return "passthrough";
    }
    if (event.key === "up" || event.key === "ctrl+p") {
      this.selectedIndex = (this.selectedIndex - 1 + this.options.length) % Math.max(1, this.options.length);
      return "consumed";
    }
    if (event.key === "down" || event.key === "ctrl+n") {
      this.selectedIndex = (this.selectedIndex + 1) % Math.max(1, this.options.length);
      return "consumed";
    }
    if (event.key === "enter") {
      const opt = this.options[this.selectedIndex];
      if (opt !== undefined) {
        this.onSubmit?.(opt);
      }
      return "consumed";
    }
    if (event.key === "escape") {
      this.onCancel?.();
      return "consumed";
    }
    return "passthrough";
  }
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Loader implements Component {
  message: string;
  active = true;
  private startedAt = Date.now();

  constructor(message = "Working") {
    this.message = message;
  }

  render(ctx: RenderContext): Frame {
    if (!this.active) {
      return { lines: [] };
    }
    const frame = SPINNER_FRAMES[Math.floor((Date.now() - this.startedAt) / 80) % SPINNER_FRAMES.length] ?? "⠋";
    const text = `${theme.accent(frame)} ${this.message}`;
    return { lines: [padToWidth(truncateToWidth(text, ctx.width), ctx.width)] };
  }
}

export class Markdown implements Component {
  text: string;

  constructor(text = "") {
    this.text = text;
  }

  render(ctx: RenderContext): Frame {
    if (ctx.width <= 0) {
      return { lines: [] };
    }
    const out: string[] = [];
    let inFence = false;
    for (const raw of this.text.split("\n")) {
      if (raw.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) {
        out.push(...wrapText(theme.muted(`  ${raw}`), ctx.width).map((l) => padToWidth(l, ctx.width)));
        continue;
      }
      const heading = /^(#{1,3})\s+(.*)$/.exec(raw);
      if (heading) {
        out.push(...wrapText(theme.bold(theme.accent(heading[2] ?? "")), ctx.width).map((l) => padToWidth(l, ctx.width)));
        continue;
      }
      const list = /^\s*[-*]\s+(.*)$/.exec(raw);
      if (list) {
        out.push(...wrapText(`• ${list[1] ?? ""}`, ctx.width).map((l) => padToWidth(l, ctx.width)));
        continue;
      }
      const styled = applyInlineMarkdown(raw);
      out.push(...wrapText(styled, ctx.width).map((l) => padToWidth(l, ctx.width)));
    }
    return { lines: out };
  }
}

function applyInlineMarkdown(line: string): string {
  return line
    .replace(/`([^`]+)`/g, (_, code: string) => theme.muted(code))
    .replace(/\*\*([^*]+)\*\*/g, (_, b: string) => theme.bold(b))
    .replace(/\*([^*]+)\*/g, (_, i: string) => theme.underline(i));
}

export { sliceByWidth };
