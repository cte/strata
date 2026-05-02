import process from "node:process";
import {
  BRACKETED_PASTE_OFF,
  BRACKETED_PASTE_ON,
  CLEAR_SCREEN,
  HIDE_CURSOR,
  SHOW_CURSOR,
} from "./ansi.js";

export interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  write(data: string): void;
  readonly columns: number;
  readonly rows: number;
  hideCursor(): void;
  showCursor(): void;
  clearScreen(): void;
  setTitle(title: string): void;
}

export class FakeTerminal implements Terminal {
  columns: number;
  rows: number;
  output = "";
  readonly frames: string[] = [];
  title = "";

  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;

  constructor(columns = 80, rows = 24) {
    this.columns = columns;
    this.rows = rows;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
  }

  stop(): void {
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
  }

  write(data: string): void {
    this.output += data;
    this.frames.push(data);
  }

  hideCursor(): void {
    this.write(HIDE_CURSOR);
  }

  showCursor(): void {
    this.write(SHOW_CURSOR);
  }

  clearScreen(): void {
    this.write(CLEAR_SCREEN);
  }

  setTitle(title: string): void {
    this.title = title;
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.resizeHandler?.();
  }

  feed(data: string): void {
    this.inputHandler?.(data);
  }
}

export class ProcessTerminal implements Terminal {
  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;
  private readonly onInputBound = (data: Buffer | string) => {
    this.inputHandler?.(typeof data === "string" ? data : data.toString("utf8"));
  };
  private readonly onResizeBound = () => this.resizeHandler?.();
  private rawWasEnabled = false;
  private started = false;

  get columns(): number {
    return process.stdout.columns ?? 80;
  }

  get rows(): number {
    return process.stdout.rows ?? 24;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    if (this.started) {
      return;
    }
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
    this.rawWasEnabled = process.stdin.isRaw === true;
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.onInputBound);
    process.stdout.on("resize", this.onResizeBound);
    this.write(BRACKETED_PASTE_ON);
    this.hideCursor();
    process.stdin.resume();
    this.started = true;
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    process.stdin.off("data", this.onInputBound);
    process.stdout.off("resize", this.onResizeBound);
    this.write(BRACKETED_PASTE_OFF);
    this.showCursor();
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(this.rawWasEnabled);
    }
    process.stdin.pause();
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
    this.started = false;
  }

  write(data: string): void {
    process.stdout.write(data);
  }

  hideCursor(): void {
    this.write(HIDE_CURSOR);
  }

  showCursor(): void {
    this.write(SHOW_CURSOR);
  }

  clearScreen(): void {
    this.write(CLEAR_SCREEN);
  }

  setTitle(title: string): void {
    this.write(`\x1b]2;${title}\x07`);
  }
}
