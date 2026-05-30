import { type TerminalDataListener, TerminalInputController } from "./input.js";
import { HandwrittenVtParser, type TerminalVtParser } from "./parser.js";
import { TerminalDomRenderer } from "./renderer.js";
import { TerminalScreen, type TerminalSnapshot } from "./screen.js";

export interface TerminalTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  selection?: string;
}

export interface TerminalOptions {
  cols?: number;
  rows?: number;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  theme?: TerminalTheme;
  parser?: TerminalVtParser;
}

export class Terminal {
  private readonly screen: TerminalScreen;
  private readonly parser: TerminalVtParser;
  private readonly renderer: TerminalDomRenderer;
  private readonly input = new TerminalInputController();

  constructor(options: TerminalOptions = {}) {
    const cols = positiveInt(options.cols, 80);
    const rows = positiveInt(options.rows, 24);
    this.screen = new TerminalScreen(cols, rows);
    this.parser = options.parser ?? new HandwrittenVtParser();
    this.renderer = new TerminalDomRenderer({
      fontFamily:
        options.fontFamily ??
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: positiveNumber(options.fontSize, 13),
      lineHeight: positiveNumber(options.lineHeight, 1.35),
      theme: {
        background: options.theme?.background ?? "#09090b",
        foreground: options.theme?.foreground ?? "#e4e4e7",
        cursor: options.theme?.cursor ?? "#f4f4f5",
        selection: options.theme?.selection ?? "rgba(125, 211, 252, 0.28)",
      },
    });
  }

  open(container: HTMLElement): void {
    this.input.detach();
    const root = this.renderer.open(container);
    this.input.attach(root);
    this.render();
    root.focus();
  }

  focus(): void {
    this.renderer.focus();
  }

  dispose(): void {
    this.input.dispose();
    this.renderer.dispose();
  }

  onData(listener: TerminalDataListener): { dispose: () => void } {
    return this.input.onData(listener);
  }

  write(data: string | Uint8Array): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    this.parser.write(text, this.screen);
    this.render();
  }

  clear(): void {
    this.parser.reset(this.screen);
    this.render();
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows);
    this.render();
  }

  fit(): { cols: number; rows: number } {
    const next = this.renderer.measureFit(this.screen.size);
    this.resize(next.cols, next.rows);
    return this.size;
  }

  get size(): { cols: number; rows: number } {
    return this.screen.size;
  }

  get snapshot(): TerminalSnapshot {
    return this.screen.snapshot();
  }

  private render(): void {
    const snapshot = this.screen.snapshot();
    this.input.setBracketedPaste(snapshot.modes.bracketedPaste);
    this.renderer.render(snapshot);
  }
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

export * from "./input.js";
export * from "./parser.js";
export * from "./renderer.js";
export * from "./screen.js";
