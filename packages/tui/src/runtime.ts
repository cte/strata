import {
  CLEAR_SCREEN,
  HIDE_CURSOR,
  padToWidth,
  SHOW_CURSOR,
  SYNC_BEGIN,
  SYNC_END,
  sliceByWidth,
  visibleWidth,
} from "./ansi.js";
import type { Component, Frame } from "./component.js";
import type { InputEvent } from "./keys.js";
import { isKeyRelease, sequenceToInputEvent } from "./keys.js";
import type { Terminal } from "./terminal.js";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export interface RuntimeOptions {
  terminal: Terminal;
  root: Component;
  onExit?: () => void;
  onFatalError?: (error: unknown) => void;
}

const FRAME_INTERVAL_MS = 16;

/**
 * TuiRuntime — pi-style scrollback-friendly renderer.
 *
 * The runtime renders all components into one logical line array. The terminal's
 * visible viewport is the last `rows` lines of that array; older lines have
 * already scrolled into native scrollback. When the rendered content grows past
 * the previous viewport bottom, the runtime writes `\r\n` at the bottom of the
 * viewport so the terminal scrolls top lines into scrollback. Within the viewport,
 * only changed lines are rewritten.
 *
 * No alt-screen, no full-screen takeover. The chat history flows naturally.
 */
export class TuiRuntime {
  private readonly terminal: Terminal;
  private root: Component;
  private overlay: Component | undefined;
  private prevLines: string[] = [];
  private prevWidth = 0;
  private prevHeight = 0;
  private prevViewportTop = 0;
  private hardwareCursorRow = 0;
  private renderScheduled = false;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private lastRenderAt = 0;
  private inputHandler?: (event: InputEvent) => void;
  private exitHandler?: () => void;
  private fatalErrorHandler?: (error: unknown) => void;
  private running = false;

  constructor(options: RuntimeOptions) {
    this.terminal = options.terminal;
    this.root = options.root;
    if (options.onExit !== undefined) {
      this.exitHandler = options.onExit;
    }
    if (options.onFatalError !== undefined) {
      this.fatalErrorHandler = options.onFatalError;
    }
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.terminal.start(
      (data) => this.guarded(() => this.dispatchInput(data)),
      () => this.guarded(() => this.invalidate(true)),
    );
    this.guarded(() => this.renderNow());
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    if (this.renderTimer !== undefined) {
      clearTimeout(this.renderTimer);
      this.renderTimer = undefined;
    }
    // Move cursor below the rendered content so the next shell prompt
    // starts on a fresh line instead of overwriting our last frame.
    if (this.prevLines.length > 0) {
      const targetRow = this.prevLines.length;
      const delta = targetRow - this.hardwareCursorRow;
      if (delta > 0) {
        this.terminal.write(`\x1b[${delta}B`);
      } else if (delta < 0) {
        this.terminal.write(`\x1b[${-delta}A`);
      }
      this.terminal.write("\r\n");
    }
    this.terminal.write(SHOW_CURSOR);
    this.terminal.stop();
    this.exitHandler?.();
  }

  setRoot(component: Component): void {
    this.root = component;
    this.invalidate(true);
  }

  setOverlay(component: Component | undefined): void {
    this.overlay = component;
    this.invalidate();
  }

  onInput(handler: (event: InputEvent) => void): void {
    this.inputHandler = handler;
  }

  invalidate(forceFullRedraw: boolean | "clear" = false): void {
    if (!this.running) {
      return;
    }
    if (forceFullRedraw) {
      this.prevLines = [];
      this.prevWidth = 0;
      this.prevHeight = 0;
      this.prevViewportTop = 0;
      this.hardwareCursorRow = 0;
      // "clear" mode also wipes the visible buffer + homes the cursor on
      // the next render, so transitions like opening / closing a picker
      // can't leave residual content from the previous frame size.
      if (forceFullRedraw === "clear") {
        this.pendingClear = true;
      }
    }
    this.scheduleRender();
  }

  private pendingClear = false;

  forceRedraw(): void {
    this.invalidate(true);
  }

  get width(): number {
    return this.terminal.columns;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  // The terminal layer hands us already-framed sequences. We filter kitty key
  // releases (terminal sends both press+release with flag 2 active), unwrap
  // bracketed paste, and convert each remaining sequence to an InputEvent.
  private dispatchInput(sequence: string): void {
    if (sequence.length === 0) {
      return;
    }
    if (isKeyRelease(sequence)) {
      return;
    }
    if (sequence.startsWith(PASTE_START)) {
      const end = sequence.lastIndexOf(PASTE_END);
      const text =
        end === -1 ? sequence.slice(PASTE_START.length) : sequence.slice(PASTE_START.length, end);
      this.routeInput({ type: "paste", text, raw: sequence });
      this.invalidate();
      return;
    }
    const event = sequenceToInputEvent(sequence);
    if (event !== undefined) {
      this.routeInput(event);
    }
    this.invalidate();
  }

  private routeInput(event: InputEvent): void {
    const overlay = this.overlay;
    if (overlay !== undefined && overlay.handleInput?.(event) === "consumed") {
      this.invalidate();
      return;
    }
    if (this.root.handleInput?.(event) === "consumed") {
      this.invalidate();
      return;
    }
    this.inputHandler?.(event);
  }

  private scheduleRender(): void {
    if (this.renderScheduled) {
      return;
    }
    this.renderScheduled = true;
    const elapsed = Date.now() - this.lastRenderAt;
    const delay = Math.max(0, FRAME_INTERVAL_MS - elapsed);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.renderScheduled = false;
      this.guarded(() => this.renderNow());
    }, delay);
  }

  private renderNow(): void {
    if (!this.running) {
      return;
    }
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    if (width <= 0 || height <= 0) {
      return;
    }

    const baseFrame = this.root.render({ width, height });
    const lines = baseFrame.lines.map((line) => clampLineWidth(line, width));
    let cursor = baseFrame.cursor;

    if (this.overlay !== undefined) {
      const overlayFrame = this.overlay.render({ width, height });
      const overlayLines = overlayFrame.lines.map((line) => clampLineWidth(line, width));
      // Anchor overlay to the visible viewport's bottom so it always covers the
      // editor/footer area, no matter how short the base content is.
      const minTotal = Math.max(lines.length, overlayLines.length, height);
      while (lines.length < minTotal) {
        lines.push(padToWidth("", width));
      }
      const overlayStart = lines.length - overlayLines.length;
      for (let i = 0; i < overlayLines.length; i += 1) {
        const target = overlayStart + i;
        if (target >= 0 && target < lines.length) {
          lines[target] = overlayLines[i] ?? "";
        }
      }
      cursor =
        overlayFrame.cursor !== undefined
          ? { row: overlayStart + overlayFrame.cursor.row, col: overlayFrame.cursor.col }
          : undefined;
    }

    const widthChanged = this.prevWidth !== 0 && this.prevWidth !== width;
    const heightChanged = this.prevHeight !== 0 && this.prevHeight !== height;
    const firstRender = this.prevLines.length === 0;

    if (firstRender || widthChanged || heightChanged) {
      const shouldClear = !firstRender || this.pendingClear;
      this.pendingClear = false;
      this.fullRedraw(lines, width, height, cursor, shouldClear);
      return;
    }

    this.diffRedraw(lines, width, height, cursor);
  }

  private fullRedraw(
    lines: string[],
    width: number,
    height: number,
    cursor: Frame["cursor"],
    clear: boolean,
  ): void {
    // Pi-aligned (see `pi-mono/packages/tui/src/tui.ts:920-942`): cursor
    // hide is emitted as a separate write OUTSIDE the synchronized output
    // block, and `applyCursor` (which may emit SHOW_CURSOR) likewise.
    // Pi's `tui.ts` only puts content writes inside `\x1b[?2026h`/`l`.
    this.terminal.write(HIDE_CURSOR);
    let buffer = SYNC_BEGIN;
    if (clear) {
      // Pi's exact clear sequence (`tui.ts:921`): erase display, home
      // cursor, erase scrollback. The `\x1b[3J` (erase saved lines) part
      // is the only one that's specific to pi — `\x1b[2J\x1b[H` alone
      // leaves previously-scrolled content in the scrollback buffer.
      buffer += "\x1b[2J\x1b[H\x1b[3J";
    }
    for (let i = 0; i < lines.length; i += 1) {
      if (i > 0) {
        buffer += "\r\n";
      }
      buffer += "\x1b[2K";
      buffer += lines[i] ?? "";
    }
    buffer += SYNC_END;
    this.terminal.write(buffer);
    const lastRow = Math.max(0, lines.length - 1);
    this.hardwareCursorRow = lastRow;
    this.prevLines = lines.slice();
    this.prevWidth = width;
    this.prevHeight = height;
    this.prevViewportTop = Math.max(0, lines.length - height);
    // Cursor positioning happens OUTSIDE the sync block (pi pattern).
    this.terminal.write(this.applyCursor(cursor, lines.length));
    this.lastRenderAt = Date.now();
  }

  private diffRedraw(
    lines: string[],
    width: number,
    height: number,
    cursor: Frame["cursor"],
  ): void {
    const prevTop = this.prevViewportTop;
    const prevBottom = prevTop + height - 1;

    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(lines.length, this.prevLines.length);
    for (let i = 0; i < maxLines; i += 1) {
      const prev = i < this.prevLines.length ? this.prevLines[i] : "";
      const next = i < lines.length ? lines[i] : "";
      if (prev !== next) {
        if (firstChanged === -1) {
          firstChanged = i;
        }
        lastChanged = i;
      }
    }

    if (firstChanged === -1) {
      // No content changes — just reposition the cursor if needed.
      this.terminal.write(this.applyCursor(cursor, lines.length));
      return;
    }

    // Match pi's render structure: cursor hide outside sync, no
    // hide/show transitions inside the sync block.
    this.terminal.write(HIDE_CURSOR);
    let buffer = SYNC_BEGIN;

    // Differential rendering can only touch what was actually visible.
    // If the first changed line is above the previous viewport, fall back
    // to a full redraw — otherwise we'd write to a region the terminal
    // has already scrolled into native scrollback.
    if (firstChanged < prevTop) {
      this.fullRedraw(lines, width, height, cursor, true);
      return;
    }

    let viewportTop = prevTop;
    let cursorRow = this.hardwareCursorRow;

    // If the new content extends past the previous viewport bottom, scroll the
    // terminal by writing \r\n at the bottom of the viewport. Each \r\n pushes
    // one line off the top into native scrollback and advances viewportTop.
    if (lastChanged > prevBottom) {
      const scroll = lastChanged - prevBottom;
      // After scrolling by N, the new viewport top is prevTop + N. If
      // firstChanged would now be in scrollback, we can't safely patch — the
      // diff cursor would clamp to the visible top and write at the wrong
      // row, stranding old content as "phantom" rows in scrollback.
      if (firstChanged < prevTop + scroll) {
        this.fullRedraw(lines, width, height, cursor, true);
        return;
      }
      const toBottom = prevBottom - cursorRow;
      if (toBottom > 0) {
        buffer += `\x1b[${toBottom}B`;
      } else if (toBottom < 0) {
        buffer += `\x1b[${-toBottom}A`;
      }
      cursorRow = prevBottom;
      buffer += "\r\n".repeat(scroll);
      viewportTop += scroll;
      cursorRow += scroll;
    }

    // Move cursor to firstChanged.
    const targetRow = firstChanged;
    const delta = targetRow - cursorRow;
    if (delta > 0) {
      buffer += `\x1b[${delta}B`;
    } else if (delta < 0) {
      buffer += `\x1b[${-delta}A`;
    }
    buffer += "\r";
    cursorRow = targetRow;

    // Write changed lines.
    const renderEnd = Math.min(lastChanged, lines.length - 1);
    for (let i = firstChanged; i <= renderEnd; i += 1) {
      if (i > firstChanged) {
        buffer += "\r\n";
        cursorRow += 1;
      }
      buffer += "\x1b[2K";
      buffer += lines[i] ?? "";
    }

    // If old content was longer than new, clear the trailing rows.
    if (this.prevLines.length > lines.length) {
      const extra = this.prevLines.length - lines.length;
      for (let i = 0; i < extra; i += 1) {
        buffer += "\r\n\x1b[2K";
        cursorRow += 1;
      }
      const back = extra;
      buffer += `\x1b[${back}A`;
      cursorRow -= back;
    }

    buffer += SYNC_END;
    this.terminal.write(buffer);
    this.hardwareCursorRow = cursorRow;
    this.prevLines = lines.slice();
    this.prevWidth = width;
    this.prevHeight = height;
    this.prevViewportTop = Math.max(viewportTop, lines.length - height);
    // Cursor positioning happens OUTSIDE the sync block (pi pattern).
    this.terminal.write(this.applyCursor(cursor, lines.length));
    this.lastRenderAt = Date.now();
  }

  private applyCursor(cursor: Frame["cursor"], totalLines: number): string {
    if (cursor === undefined) {
      return HIDE_CURSOR;
    }
    const targetRow = Math.max(0, Math.min(cursor.row, Math.max(0, totalLines - 1)));
    const delta = targetRow - this.hardwareCursorRow;
    let buffer = "";
    if (delta > 0) {
      buffer += `\x1b[${delta}B`;
    } else if (delta < 0) {
      buffer += `\x1b[${-delta}A`;
    }
    buffer += `\x1b[${cursor.col + 1}G`;
    this.hardwareCursorRow = targetRow;
    buffer += SHOW_CURSOR;
    return buffer;
  }

  private guarded(fn: () => void): void {
    try {
      fn();
    } catch (error: unknown) {
      this.fatal(error);
    }
  }

  private fatal(error: unknown): void {
    if (!this.running) {
      return;
    }
    this.stop();
    if (this.fatalErrorHandler !== undefined) {
      this.fatalErrorHandler(error);
      return;
    }
    throw error;
  }
}

function clampLineWidth(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w === width) {
    return line;
  }
  if (w > width) {
    return sliceByWidth(line, width);
  }
  return padToWidth(line, width);
}
