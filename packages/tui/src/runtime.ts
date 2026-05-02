import {
  CLEAR_LINE,
  CLEAR_SCREEN,
  HIDE_CURSOR,
  SHOW_CURSOR,
  SYNC_BEGIN,
  SYNC_END,
  moveCursor,
  padToWidth,
  sliceByWidth,
  visibleWidth,
} from "./ansi.js";
import type { Component, Frame } from "./component.js";
import { emptyFrame } from "./component.js";
import type { InputEvent } from "./keys.js";
import { InputBuffer } from "./keys.js";
import type { Terminal } from "./terminal.js";

export interface RuntimeOptions {
  terminal: Terminal;
  root: Component;
  onExit?: () => void;
  onFatalError?: (error: unknown) => void;
}

const FRAME_INTERVAL_MS = 16;

export class TuiRuntime {
  private readonly terminal: Terminal;
  private readonly inputBuffer = new InputBuffer();
  private root: Component;
  private overlay: Component | undefined;
  private prevLines: string[] = [];
  private prevWidth = 0;
  private renderScheduled = false;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private escapeTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (this.escapeTimer !== undefined) {
      clearTimeout(this.escapeTimer);
      this.escapeTimer = undefined;
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
    this.invalidate(true);
  }

  onInput(handler: (event: InputEvent) => void): void {
    this.inputHandler = handler;
  }

  invalidate(forceFullRedraw = false): void {
    if (!this.running) {
      return;
    }
    if (forceFullRedraw) {
      this.prevLines = [];
    }
    this.scheduleRender();
  }

  forceRedraw(): void {
    this.prevLines = [];
    this.terminal.write(CLEAR_SCREEN);
    this.renderNow();
  }

  get width(): number {
    return this.terminal.columns;
  }

  get rows(): number {
    return this.terminal.rows;
  }

  private dispatchInput(data: string): void {
    const events = this.inputBuffer.push(data);
    this.scheduleEscapeFlush();
    for (const event of events) {
      const overlay = this.overlay;
      if (overlay !== undefined && overlay.handleInput?.(event) === "consumed") {
        this.invalidate();
        continue;
      }
      const handled = this.root.handleInput?.(event);
      if (handled === "consumed") {
        this.invalidate();
        continue;
      }
      this.inputHandler?.(event);
    }
    this.invalidate();
  }

  private scheduleEscapeFlush(): void {
    if (this.escapeTimer !== undefined) {
      clearTimeout(this.escapeTimer);
    }
    this.escapeTimer = setTimeout(() => {
      this.escapeTimer = undefined;
      this.guarded(() => {
        const flushed = this.inputBuffer.flush();
        if (flushed.length === 0) {
          return;
        }
        for (const event of flushed) {
          const overlay = this.overlay;
          if (overlay !== undefined && overlay.handleInput?.(event) === "consumed") {
            this.invalidate();
            continue;
          }
          const handled = this.root.handleInput?.(event);
          if (handled === "consumed") {
            this.invalidate();
            continue;
          }
          this.inputHandler?.(event);
        }
        this.invalidate();
      });
    }, 30);
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
    const widthChanged = width !== this.prevWidth;
    const baseFrame = safeRender(this.root, width, height);
    const overlayFrame = this.overlay ? safeRender(this.overlay, width, height) : emptyFrame();
    const frame = composeFrame(baseFrame, overlayFrame, width, height);

    if (widthChanged || this.prevLines.length === 0) {
      this.terminal.write(SYNC_BEGIN);
      this.terminal.write(CLEAR_SCREEN);
      this.terminal.write(HIDE_CURSOR);
      for (let row = 0; row < frame.lines.length; row += 1) {
        this.terminal.write(moveCursor(row, 0));
        this.terminal.write(frame.lines[row] ?? "");
      }
      this.applyCursor(frame);
      this.terminal.write(SYNC_END);
    } else {
      this.terminal.write(SYNC_BEGIN);
      this.terminal.write(HIDE_CURSOR);
      const maxRows = Math.max(frame.lines.length, this.prevLines.length);
      for (let row = 0; row < maxRows; row += 1) {
        const next = frame.lines[row] ?? "";
        const prev = this.prevLines[row] ?? "";
        if (next !== prev) {
          this.terminal.write(moveCursor(row, 0));
          this.terminal.write(CLEAR_LINE);
          this.terminal.write(next);
        }
      }
      this.applyCursor(frame);
      this.terminal.write(SYNC_END);
    }

    this.prevLines = frame.lines.slice();
    this.prevWidth = width;
    this.lastRenderAt = Date.now();
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

  private applyCursor(frame: Frame): void {
    if (frame.cursor === undefined) {
      this.terminal.write(HIDE_CURSOR);
      return;
    }
    this.terminal.write(moveCursor(frame.cursor.row, frame.cursor.col));
    this.terminal.write(SHOW_CURSOR);
  }
}

function safeRender(component: Component, width: number, height: number): Frame {
  if (width <= 0) {
    return emptyFrame();
  }
  return component.render({ width, height });
}

function composeFrame(base: Frame, overlay: Frame, width: number, height: number): Frame {
  const overlayLines = overlay.lines.map((line) => normalizeLine(line, width));
  if (overlayLines.length > 0) {
    while (overlayLines.length < height) {
      overlayLines.push(padToWidth("", width));
    }
    if (overlayLines.length > height) {
      overlayLines.length = height;
    }
    const result: Frame = { lines: overlayLines };
    if (overlay.cursor !== undefined) {
      result.cursor = clampCursor(overlay.cursor, width, overlayLines.length);
    }
    return result;
  }
  const baseLines = base.lines.map((line) => normalizeLine(line, width));
  if (baseLines.length > height) {
    baseLines.splice(0, baseLines.length - height);
  }
  const result: Frame = { lines: baseLines };
  if (base.cursor !== undefined) {
    result.cursor = clampCursor(base.cursor, width, baseLines.length);
  }
  return result;
}

function normalizeLine(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w === width) {
    return line;
  }
  if (w > width) {
    return sliceByWidth(line, width);
  }
  return padToWidth(line, width);
}

function clampCursor(
  cursor: { row: number; col: number },
  width: number,
  rows: number,
): { row: number; col: number } {
  return {
    row: Math.max(0, Math.min(cursor.row, Math.max(0, rows - 1))),
    col: Math.max(0, Math.min(cursor.col, Math.max(0, width - 1))),
  };
}
