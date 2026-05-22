import {
  padToWidth,
  sliceByWidth,
  theme,
  truncateToWidth,
  visibleWidth,
  wrapText,
} from "./ansi.js";
import type { Component, Frame, RenderContext } from "./component.js";
import type { InputEvent, KeyId } from "./keys.js";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface TextChunk {
  text: string;
  startIndex: number;
  endIndex: number;
}

interface LayoutLine {
  text: string;
  startIndex: number;
  endIndex: number;
}

function isWhitespaceChar(char: string): boolean {
  return /\s/u.test(char);
}

/**
 * Split one logical editor line into visual chunks.
 *
 * This mirrors Pi's prompt-editor behavior: prefer word boundaries, keep the
 * original text indices for cursor mapping, and only force-break long tokens.
 */
export function wordWrapLine(line: string, maxWidth: number): TextChunk[] {
  if (line === "" || maxWidth <= 0) {
    return [{ text: "", startIndex: 0, endIndex: 0 }];
  }

  if (visibleWidth(line) <= maxWidth) {
    return [{ text: line, startIndex: 0, endIndex: line.length }];
  }

  const chunks: TextChunk[] = [];
  const segments = [...segmenter.segment(line)];
  let currentWidth = 0;
  let chunkStart = 0;
  let wrapOppIndex = -1;
  let wrapOppWidth = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) {
      continue;
    }

    const grapheme = segment.segment;
    const graphemeWidth = visibleWidth(grapheme);
    const charIndex = segment.index;
    const isWhitespace = isWhitespaceChar(grapheme);

    if (currentWidth + graphemeWidth > maxWidth) {
      if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + graphemeWidth <= maxWidth) {
        chunks.push({
          text: line.slice(chunkStart, wrapOppIndex),
          startIndex: chunkStart,
          endIndex: wrapOppIndex,
        });
        chunkStart = wrapOppIndex;
        currentWidth -= wrapOppWidth;
      } else if (chunkStart < charIndex) {
        chunks.push({
          text: line.slice(chunkStart, charIndex),
          startIndex: chunkStart,
          endIndex: charIndex,
        });
        chunkStart = charIndex;
        currentWidth = 0;
      }
      wrapOppIndex = -1;
    }

    if (graphemeWidth > maxWidth) {
      if (chunkStart < charIndex) {
        chunks.push({
          text: line.slice(chunkStart, charIndex),
          startIndex: chunkStart,
          endIndex: charIndex,
        });
      }
      chunks.push({
        text: grapheme,
        startIndex: charIndex,
        endIndex: charIndex + grapheme.length,
      });
      chunkStart = charIndex + grapheme.length;
      currentWidth = 0;
      wrapOppIndex = -1;
      continue;
    }

    currentWidth += graphemeWidth;

    const next = segments[i + 1];
    if (isWhitespace && next !== undefined && !isWhitespaceChar(next.segment)) {
      wrapOppIndex = next.index;
      wrapOppWidth = currentWidth;
    }
  }

  if (chunkStart < line.length || chunks.length === 0) {
    chunks.push({ text: line.slice(chunkStart), startIndex: chunkStart, endIndex: line.length });
  }
  return chunks;
}

export interface AutocompleteItem {
  label: string;
  value: string;
  description?: string;
}

export interface AutocompleteSuggestions {
  items: AutocompleteItem[];
  /**
   * Indices in `text` of the range to replace when an item is accepted.
   * For slash commands this is the whole input (`0` to `text.length`).
   * For `@file` mentions, `replaceStart` is the position of `@` and
   * `replaceEnd` is the cursor position (so the user's partial token is
   * swapped for the chosen completion).
   */
  replaceStart: number;
  replaceEnd: number;
}

export interface AutocompleteProvider {
  provide(text: string, cursor: number): AutocompleteSuggestions | undefined;
}

export interface EditorOptions {
  prompt?: string;
  placeholder?: string;
  autocomplete?: AutocompleteProvider;
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
  onCancel?: () => void;
}

export class Editor implements Component {
  text = "";
  cursor = 0;
  focused = true;
  disabled = false;
  history: string[] = [];
  historyIndex: number | undefined;
  prompt: string;
  placeholder: string;
  autocomplete?: AutocompleteProvider;
  onSubmit?: (text: string) => void;
  onChange?: (text: string) => void;
  onCancel?: () => void;
  private completions: AutocompleteItem[] = [];
  private completionIndex = 0;
  private completionReplaceStart = 0;
  private completionReplaceEnd = 0;

  constructor(options: EditorOptions = {}) {
    this.prompt = options.prompt ?? "› ";
    this.placeholder = options.placeholder ?? "";
    if (options.autocomplete !== undefined) {
      this.autocomplete = options.autocomplete;
    }
    if (options.onSubmit !== undefined) {
      this.onSubmit = options.onSubmit;
    }
    if (options.onChange !== undefined) {
      this.onChange = options.onChange;
    }
    if (options.onCancel !== undefined) {
      this.onCancel = options.onCancel;
    }
  }

  setText(value: string): void {
    this.text = value;
    this.cursor = value.length;
    this.refreshCompletions();
    this.onChange?.(value);
  }

  reset(): void {
    this.text = "";
    this.cursor = 0;
    this.completions = [];
    this.completionIndex = 0;
    this.historyIndex = undefined;
  }

  render(ctx: RenderContext): Frame {
    const promptWidth = visibleWidth(this.prompt);
    const innerWidth = Math.max(1, ctx.width - promptWidth - 1);
    const display =
      this.text === "" && !this.focused && this.placeholder !== ""
        ? theme.muted(this.placeholder)
        : this.text;
    const wrapped =
      display !== this.text
        ? wrapText(display === "" ? " " : display, innerWidth)
        : this.layoutText(display, innerWidth).map((line) => line.text);

    const cursor = this.computeCursor(innerWidth);
    const lines: string[] = [];
    for (let i = 0; i < wrapped.length; i += 1) {
      const text = wrapped[i] ?? "";
      const prefix = i === 0 ? this.styledPrompt() : " ".repeat(promptWidth);
      lines.push(padToWidth(`${prefix}${text}`, ctx.width));
    }
    if (lines.length === 0) {
      lines.push(padToWidth(this.styledPrompt(), ctx.width));
    }

    if (this.completions.length > 0 && this.focused) {
      // Pi-aligned picker: no leading separator. Window slides so the
      // selected item stays centered. Trailing `(i/total)` scroll indicator
      // appears only when the list exceeds the visible window.
      const maxVisible = 5;
      const total = this.completions.length;
      const startIndex = Math.max(
        0,
        Math.min(this.completionIndex - Math.floor(maxVisible / 2), total - maxVisible),
      );
      const endIndex = Math.min(startIndex + maxVisible, total);
      for (let i = startIndex; i < endIndex; i += 1) {
        const item = this.completions[i];
        if (item === undefined) continue;
        const isSelected = i === this.completionIndex;
        const prefix = isSelected ? "→ " : "  ";
        const label = isSelected ? theme.accent(item.label) : item.label;
        const desc = item.description !== undefined ? `  ${theme.muted(item.description)}` : "";
        lines.push(padToWidth(truncateToWidth(`${prefix}${label}${desc}`, ctx.width), ctx.width));
      }
      if (startIndex > 0 || endIndex < total) {
        const scrollText = `  (${this.completionIndex + 1}/${total})`;
        lines.push(padToWidth(theme.muted(truncateToWidth(scrollText, ctx.width)), ctx.width));
      }
    }

    const frame: Frame = { lines };
    if (this.focused && !this.disabled) {
      frame.cursor = {
        row: cursor.row,
        col: promptWidth + cursor.col,
      };
    }
    return frame;
  }

  handleInput(event: InputEvent): "consumed" | "passthrough" {
    if (!this.focused || this.disabled) {
      return "passthrough";
    }

    if (event.type === "paste") {
      this.insert(event.text);
      return "consumed";
    }

    if (event.type === "text") {
      this.insert(event.text);
      return "consumed";
    }

    return this.handleKey(event.key);
  }

  private handleKey(key: KeyId): "consumed" | "passthrough" {
    if (this.completions.length > 0) {
      if (key === "up") {
        this.completionIndex =
          (this.completionIndex - 1 + this.completions.length) % this.completions.length;
        return "consumed";
      }
      if (key === "down") {
        this.completionIndex = (this.completionIndex + 1) % this.completions.length;
        return "consumed";
      }
      if (key === "tab") {
        this.applyCompletion();
        return "consumed";
      }
      if (key === "enter") {
        // Pi's behavior: only slash-command completions submit on Enter; any
        // other completion (file mentions, etc.) applies and stays on the
        // line so the user can keep typing.
        const accepted = this.completions[this.completionIndex];
        const isSlashCommand = accepted !== undefined && accepted.value.startsWith("/");
        this.applyCompletion();
        if (!isSlashCommand) {
          return "consumed";
        }
        // Fall through to the submit handler below for slash commands.
      } else if (key === "escape") {
        this.completions = [];
        this.completionIndex = 0;
        return "consumed";
      }
    }

    switch (key) {
      case "enter": {
        const submitted = this.text;
        this.recordHistory(submitted);
        this.reset();
        this.onSubmit?.(submitted);
        return "consumed";
      }
      case "shift+enter":
        this.insert("\n");
        return "consumed";
      case "backspace":
        if (this.cursor > 0) {
          this.text = this.text.slice(0, this.cursor - 1) + this.text.slice(this.cursor);
          this.cursor -= 1;
          this.refreshCompletions();
          this.onChange?.(this.text);
        }
        return "consumed";
      case "delete":
        if (this.cursor < this.text.length) {
          this.text = this.text.slice(0, this.cursor) + this.text.slice(this.cursor + 1);
          this.refreshCompletions();
          this.onChange?.(this.text);
        }
        return "consumed";
      case "left":
        this.cursor = Math.max(0, this.cursor - 1);
        return "consumed";
      case "right":
        this.cursor = Math.min(this.text.length, this.cursor + 1);
        return "consumed";
      case "home":
      case "ctrl+a":
        this.cursor = 0;
        return "consumed";
      case "end":
      case "ctrl+e":
        this.cursor = this.text.length;
        return "consumed";
      case "ctrl+u":
        this.text = this.text.slice(this.cursor);
        this.cursor = 0;
        this.refreshCompletions();
        this.onChange?.(this.text);
        return "consumed";
      case "ctrl+k":
        this.text = this.text.slice(0, this.cursor);
        this.refreshCompletions();
        this.onChange?.(this.text);
        return "consumed";
      case "ctrl+w": {
        const before = this.text.slice(0, this.cursor);
        const trimmed = before.replace(/\S+\s*$/, "");
        this.text = trimmed + this.text.slice(this.cursor);
        this.cursor = trimmed.length;
        this.refreshCompletions();
        this.onChange?.(this.text);
        return "consumed";
      }
      case "up":
        if (this.history.length > 0 && (this.cursor === 0 || this.historyIndex !== undefined)) {
          this.cycleHistory(-1);
          return "consumed";
        }
        return "passthrough";
      case "down":
        if (this.historyIndex !== undefined) {
          this.cycleHistory(1);
          return "consumed";
        }
        return "passthrough";
      case "tab":
        this.refreshCompletions();
        return "consumed";
      case "escape":
        this.onCancel?.();
        return "consumed";
      default:
        return "passthrough";
    }
  }

  private styledPrompt(): string {
    return this.disabled ? theme.muted(this.prompt) : theme.accent(this.prompt);
  }

  private insert(text: string): void {
    this.text = this.text.slice(0, this.cursor) + text + this.text.slice(this.cursor);
    this.cursor += text.length;
    this.refreshCompletions();
    this.onChange?.(this.text);
  }

  private applyCompletion(): void {
    const item = this.completions[this.completionIndex];
    if (item === undefined) {
      return;
    }
    const before = this.text.slice(0, this.completionReplaceStart);
    const after = this.text.slice(this.completionReplaceEnd);
    this.text = before + item.value + after;
    this.cursor = before.length + item.value.length;
    this.completions = [];
    this.completionIndex = 0;
    this.onChange?.(this.text);
  }

  private refreshCompletions(): void {
    if (this.autocomplete === undefined || this.text === "") {
      this.completions = [];
      this.completionIndex = 0;
      return;
    }
    const result = this.autocomplete.provide(this.text, this.cursor);
    if (result === undefined || result.items.length === 0) {
      this.completions = [];
      this.completionIndex = 0;
      return;
    }
    this.completions = result.items;
    this.completionReplaceStart = result.replaceStart;
    this.completionReplaceEnd = result.replaceEnd;
    this.completionIndex = 0;
  }

  private recordHistory(value: string): void {
    if (value.trim() === "") {
      return;
    }
    this.history.push(value);
    this.historyIndex = undefined;
  }

  private cycleHistory(delta: number): void {
    if (this.history.length === 0) {
      return;
    }
    const next =
      this.historyIndex === undefined
        ? delta < 0
          ? this.history.length - 1
          : -1
        : this.historyIndex + delta;
    // Past the oldest entry — stay put. Pi's behavior is to stop at the edge,
    // not wrap around to the most-recent.
    if (next < 0) {
      return;
    }
    // Past the newest — return to the empty current state.
    if (next >= this.history.length) {
      this.historyIndex = undefined;
      this.text = "";
      this.cursor = 0;
      return;
    }
    this.historyIndex = next;
    const value = this.history[next] ?? "";
    this.text = value;
    this.cursor = value.length;
  }

  private layoutText(text: string, width: number): LayoutLine[] {
    if (text === "") {
      return [{ text: "", startIndex: 0, endIndex: 0 }];
    }

    const layoutLines: LayoutLine[] = [];
    let offset = 0;
    for (const logicalLine of text.split("\n")) {
      for (const chunk of wordWrapLine(logicalLine, width)) {
        layoutLines.push({
          text: chunk.text,
          startIndex: offset + chunk.startIndex,
          endIndex: offset + chunk.endIndex,
        });
      }
      offset += logicalLine.length + 1;
    }
    return layoutLines;
  }

  private computeCursor(innerWidth: number): { row: number; col: number } {
    const layoutLines = this.layoutText(this.text, innerWidth);

    for (let row = 0; row < layoutLines.length; row += 1) {
      const line = layoutLines[row];
      if (line === undefined) {
        continue;
      }

      const next = layoutLines[row + 1];
      const wrapsIntoNext = next !== undefined && next.startIndex === line.endIndex;
      const isLast = row === layoutLines.length - 1;
      const cursorAtLineEnd = this.cursor === line.endIndex && (!wrapsIntoNext || isLast);
      const cursorInsideLine = this.cursor >= line.startIndex && this.cursor < line.endIndex;

      if (cursorInsideLine || cursorAtLineEnd) {
        const cursorIndex = Math.max(line.startIndex, Math.min(this.cursor, line.endIndex));
        return {
          row,
          col: visibleWidth(this.text.slice(line.startIndex, cursorIndex)),
        };
      }
    }

    const last = layoutLines.at(-1) ?? { startIndex: 0, endIndex: 0 };
    return {
      row: Math.max(0, layoutLines.length - 1),
      col: visibleWidth(this.text.slice(last.startIndex, last.endIndex)),
    };
  }
}

export { sliceByWidth };
