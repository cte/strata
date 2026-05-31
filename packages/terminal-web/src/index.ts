import { TerminalCanvasRenderer } from "./canvasRenderer.js";
import { type GhosttyWasmTerminal, loadGhosttyWasmTerminal } from "./ghosttyWasm.js";
import { type TerminalDataListener, TerminalInputController } from "./input.js";
import { HandwrittenVtParser, type TerminalVtParser } from "./parser.js";
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
  emulator?: "fallback" | "ghostty" | "auto";
  ghosttyWasmUrl?: string | URL;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  scrollback?: number;
  theme?: TerminalTheme;
  /**
   * CSS background for the scroll root. Defaults to the theme background;
   * pass "transparent" to let a translucent host surface show through.
   */
  rootBackground?: string;
  parser?: TerminalVtParser;
}

export class Terminal {
  private readonly screen: TerminalScreen;
  private readonly parser: TerminalVtParser;
  private readonly renderer: TerminalCanvasRenderer;
  private readonly input = new TerminalInputController();
  private readonly scrollback: number;
  private ghostty: GhosttyWasmTerminal | null = null;
  private ghosttyLoad: Promise<void> | null = null;
  private replayText = "";
  private disposed = false;
  private renderRaf = 0;

  constructor(options: TerminalOptions = {}) {
    const cols = positiveInt(options.cols, 80);
    const rows = positiveInt(options.rows, 24);
    this.scrollback = positiveInt(options.scrollback, 1000);
    this.screen = new TerminalScreen(cols, rows, this.scrollback);
    this.parser = options.parser ?? new HandwrittenVtParser();
    this.renderer = new TerminalCanvasRenderer({
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
      ...(options.rootBackground === undefined ? {} : { rootBackground: options.rootBackground }),
    });

    if (options.emulator === "ghostty" || options.emulator === "auto") {
      this.startGhostty(options.ghosttyWasmUrl);
    }
  }

  open(container: HTMLElement): void {
    this.input.detach();
    const root = this.renderer.open(container);
    this.input.setSelectionTextProvider(() => this.renderer.getSelectionText());
    this.input.attach(root);
    this.render();
    root.focus();
  }

  focus(): void {
    this.renderer.focus();
  }

  dispose(): void {
    this.disposed = true;
    if (this.renderRaf !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.renderRaf);
    }
    this.renderRaf = 0;
    this.input.dispose();
    this.renderer.dispose();
    this.ghostty?.dispose();
    this.ghostty = null;
  }

  /** Coalesce bursty writes into a single render on the next animation frame. */
  private scheduleRender(): void {
    if (this.disposed) return;
    if (typeof requestAnimationFrame !== "function") {
      this.render();
      return;
    }
    if (this.renderRaf !== 0) return;
    this.renderRaf = requestAnimationFrame(() => {
      this.renderRaf = 0;
      if (!this.disposed) this.render();
    });
  }

  onData(listener: TerminalDataListener): { dispose: () => void } {
    return this.input.onData(listener);
  }

  write(data: string | Uint8Array): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    if (this.ghostty !== null) {
      this.ghostty.write(text);
    } else {
      if (this.ghosttyLoad !== null) this.replayText += text;
      this.parser.write(text, this.screen);
    }
    // Streaming output arrives as many small frames; coalesce them into one
    // render per animation frame instead of re-rendering synchronously each time.
    this.scheduleRender();
  }

  clear(): void {
    if (this.ghostty !== null) this.ghostty.write("\x1bc");
    this.parser.reset(this.screen);
    this.replayText = "";
    this.render();
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows);
    this.ghostty?.resize(cols, rows);
    this.render();
  }

  setFontSize(fontSize: number, lineHeight?: number): void {
    this.renderer.setFont(fontSize, lineHeight);
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
    return this.currentSnapshot();
  }

  private render(): void {
    const snapshot = this.currentSnapshot();
    this.input.setBracketedPaste(snapshot.modes.bracketedPaste);
    this.input.setModes({
      applicationCursor: snapshot.modes.applicationCursor,
      mouseTracking: snapshot.modes.mouseTracking,
      sgrMouse: snapshot.modes.sgrMouse,
    });
    this.renderer.render(snapshot);
  }

  private currentSnapshot(): TerminalSnapshot {
    return this.ghostty?.snapshot() ?? this.screen.snapshot();
  }

  private startGhostty(wasmUrl: string | URL | undefined): void {
    const size = this.screen.size;
    this.ghosttyLoad = loadGhosttyWasmTerminal({
      ...(wasmUrl === undefined ? {} : { wasmUrl }),
      cols: size.cols,
      rows: size.rows,
      scrollback: this.scrollback,
    })
      .then((terminal) => {
        if (this.disposed) {
          terminal.dispose();
          return;
        }
        const latestSize = this.screen.size;
        terminal.resize(latestSize.cols, latestSize.rows);
        if (this.replayText.length > 0) terminal.write(this.replayText);
        this.replayText = "";
        this.ghostty = terminal;
        this.render();
      })
      .catch((error: unknown) => {
        console.warn("Falling back to handwritten terminal emulator.", error);
        this.replayText = "";
      })
      .finally(() => {
        this.ghosttyLoad = null;
      });
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

export * from "./canvasRenderer.js";
export * from "./ghosttyWasm.js";
export * from "./input.js";
export * from "./parser.js";
export * from "./screen.js";
