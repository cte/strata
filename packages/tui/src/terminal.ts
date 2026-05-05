import process from "node:process";
import {
  BRACKETED_PASTE_OFF,
  BRACKETED_PASTE_ON,
  CLEAR_SCREEN,
  HIDE_CURSOR,
  SHOW_CURSOR,
} from "./ansi.js";
import { KITTY_RESPONSE_RE, setKittyProtocolActive } from "./keys.js";
import { StdinBuffer } from "./stdinBuffer.js";

export interface Terminal {
  /**
   * `onSequence` is called once per framed input sequence (a single keystroke
   * such as "a", "\r", "\x1b[A", or a kitty CSI-u sequence). The kitty
   * keyboard-protocol query response is intercepted by the terminal and not
   * delivered. Bracketed paste content is delivered as a single sequence
   * wrapped in `\x1b[200~`...`\x1b[201~` so consumers can detect paste.
   */
  start(onSequence: (data: string) => void, onResize: () => void): void;
  stop(): void;
  write(data: string): void;
  readonly columns: number;
  readonly rows: number;
  hideCursor(): void;
  showCursor(): void;
  clearScreen(): void;
  setTitle(title: string): void;
}

/** Test terminal — frames feeds through the same StdinBuffer as ProcessTerminal. */
export class FakeTerminal implements Terminal {
  columns: number;
  rows: number;
  output = "";
  readonly frames: string[] = [];
  title = "";

  private readonly stdin = new StdinBuffer({ timeout: 10 });
  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;

  constructor(columns = 80, rows = 24) {
    this.columns = columns;
    this.rows = rows;
    this.stdin.on("data", (sequence) => {
      this.inputHandler?.(sequence);
    });
    this.stdin.on("paste", (content) => {
      this.inputHandler?.(`\x1b[200~${content}\x1b[201~`);
    });
  }

  start(onSequence: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onSequence;
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
    this.stdin.process(data);
  }
}

/**
 * Real terminal — startup flow ported from pi-mono:
 *   1. Enable raw mode and bracketed paste.
 *   2. Send the kitty keyboard-protocol query (CSI ? u). If the terminal
 *      responds with CSI ? <flags> u, push flags 1+2+4 (disambiguate, event
 *      types, alternate keys) — the response is intercepted inside the
 *      StdinBuffer pipeline so split chunks don't confuse the detector.
 *   3. If no response within ~150ms, fall back to xterm modifyOtherKeys
 *      mode 2 — needed for terminals (and tmux <3.5) that don't speak kitty.
 *   4. On stop, disable whichever protocol was activated.
 */
export class ProcessTerminal implements Terminal {
  private readonly stdin = new StdinBuffer({ timeout: 10 });
  private readonly onStdinDataBound = (data: Buffer | string) => {
    this.stdin.process(typeof data === "string" ? data : data.toString("utf8"));
  };
  private readonly onResizeBound = () => this.resizeHandler?.();
  private inputHandler: ((data: string) => void) | undefined;
  private resizeHandler: (() => void) | undefined;
  private rawWasEnabled = false;
  private started = false;
  private kittyProtocolActive = false;
  private modifyOtherKeysActive = false;
  private kittyFallbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.stdin.on("data", (sequence) => {
      // Kitty protocol response — intercept, don't forward.
      if (KITTY_RESPONSE_RE.test(sequence)) {
        this.enableKittyKeyboardProtocol();
        return;
      }
      this.inputHandler?.(sequence);
    });
    this.stdin.on("paste", (content) => {
      // Wrap with bracketed paste markers so the runtime can recognize a paste.
      this.inputHandler?.(`\x1b[200~${content}\x1b[201~`);
    });
  }

  get columns(): number {
    return process.stdout.columns ?? 80;
  }

  get rows(): number {
    return process.stdout.rows ?? 24;
  }

  start(onSequence: (data: string) => void, onResize: () => void): void {
    if (this.started) {
      return;
    }
    this.inputHandler = onSequence;
    this.resizeHandler = onResize;
    this.rawWasEnabled = process.stdin.isRaw === true;
    if (typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.onStdinDataBound);
    process.stdout.on("resize", this.onResizeBound);
    this.write(BRACKETED_PASTE_ON);
    this.hideCursor();
    process.stdin.resume();
    process.stdout.write("\x1b[?u");
    this.kittyFallbackTimer = setTimeout(() => {
      this.kittyFallbackTimer = undefined;
      if (!this.kittyProtocolActive && !this.modifyOtherKeysActive) {
        process.stdout.write("\x1b[>4;2m");
        this.modifyOtherKeysActive = true;
      }
    }, 150);
    this.started = true;
  }

  stop(): void {
    if (!this.started) {
      return;
    }
    process.stdin.off("data", this.onStdinDataBound);
    process.stdout.off("resize", this.onResizeBound);
    if (this.kittyFallbackTimer !== undefined) {
      clearTimeout(this.kittyFallbackTimer);
      this.kittyFallbackTimer = undefined;
    }
    if (this.kittyProtocolActive) {
      process.stdout.write("\x1b[<u");
      this.kittyProtocolActive = false;
      setKittyProtocolActive(false);
    }
    if (this.modifyOtherKeysActive) {
      process.stdout.write("\x1b[>4;0m");
      this.modifyOtherKeysActive = false;
    }
    this.stdin.destroy();
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

  private enableKittyKeyboardProtocol(): void {
    if (this.kittyProtocolActive) {
      return;
    }
    if (this.kittyFallbackTimer !== undefined) {
      clearTimeout(this.kittyFallbackTimer);
      this.kittyFallbackTimer = undefined;
    }
    process.stdout.write("\x1b[>7u");
    this.kittyProtocolActive = true;
    setKittyProtocolActive(true);
  }
}
