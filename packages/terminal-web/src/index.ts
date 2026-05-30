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
}

type DataListener = (data: string) => void;

interface Cell {
  char: string;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const PRINTABLE_CONTROL = new Set(["\n", "\r", "\b", "\t"]);

export class Terminal {
  private cols: number;
  private rows: number;
  private options: Required<Omit<TerminalOptions, "theme">> & { theme: Required<TerminalTheme> };
  private screen: Cell[][];
  private cursorX = 0;
  private cursorY = 0;
  private root: HTMLDivElement | null = null;
  private viewport: HTMLDivElement | null = null;
  private cursorEl: HTMLSpanElement | null = null;
  private dataListeners = new Set<DataListener>();
  private keydownHandler = (event: KeyboardEvent) => this.handleKeydown(event);
  private beforeInputHandler = (event: InputEvent) => this.handleBeforeInput(event);
  private pasteHandler = (event: ClipboardEvent) => this.handlePaste(event);
  private composition = false;

  constructor(options: TerminalOptions = {}) {
    this.cols = positiveInt(options.cols, DEFAULT_COLS);
    this.rows = positiveInt(options.rows, DEFAULT_ROWS);
    this.options = {
      cols: this.cols,
      rows: this.rows,
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
    };
    this.screen = createScreen(this.cols, this.rows);
  }

  open(container: HTMLElement): void {
    this.disposeDom();
    const root = document.createElement("div");
    root.tabIndex = 0;
    root.contentEditable = "plaintext-only";
    root.setAttribute("role", "textbox");

    root.setAttribute("aria-label", "Terminal");
    root.spellcheck = false;
    root.style.cssText = [
      "box-sizing:border-box",
      "height:100%",
      "width:100%",
      "overflow:hidden",
      "outline:none",
      "white-space:pre",
      "user-select:text",
      "padding:10px",
      `background:${this.options.theme.background}`,
      `color:${this.options.theme.foreground}`,
      `font-family:${this.options.fontFamily}`,
      `font-size:${this.options.fontSize}px`,
      `line-height:${this.options.lineHeight}`,
      "font-variant-ligatures:none",
    ].join(";");

    const viewport = document.createElement("div");
    viewport.style.cssText = "min-height:100%;width:max-content;min-width:100%";
    root.appendChild(viewport);
    root.addEventListener("keydown", this.keydownHandler);
    root.addEventListener("beforeinput", this.beforeInputHandler);
    root.addEventListener("paste", this.pasteHandler);

    root.addEventListener("compositionstart", () => {
      this.composition = true;
    });
    root.addEventListener("compositionend", (event) => {
      this.composition = false;
      const value = event.data;
      if (value.length > 0) this.emitData(value);
    });
    container.replaceChildren(root);
    this.root = root;
    this.viewport = viewport;
    this.render();
    root.focus();
  }

  focus(): void {
    this.root?.focus();
  }

  dispose(): void {
    this.disposeDom();
    this.dataListeners.clear();
  }

  onData(listener: DataListener): { dispose: () => void } {
    this.dataListeners.add(listener);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  write(data: string | Uint8Array): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index] ?? "";
      if (char === "\x1b") {
        index = this.consumeEscape(text, index);
        continue;
      }
      this.putChar(char);
    }
    this.render();
  }

  clear(): void {
    this.screen = createScreen(this.cols, this.rows);
    this.cursorX = 0;
    this.cursorY = 0;
    this.render();
  }

  resize(cols: number, rows: number): void {
    const nextCols = positiveInt(cols, this.cols);
    const nextRows = positiveInt(rows, this.rows);
    if (nextCols === this.cols && nextRows === this.rows) return;
    const next = createScreen(nextCols, nextRows);
    const copyRows = Math.min(this.rows, nextRows);
    const copyCols = Math.min(this.cols, nextCols);
    for (let y = 0; y < copyRows; y += 1) {
      for (let x = 0; x < copyCols; x += 1) {
        next[y]![x] = this.screen[y]![x]!;
      }
    }
    this.cols = nextCols;
    this.rows = nextRows;
    this.screen = next;
    this.cursorX = Math.min(this.cursorX, this.cols - 1);
    this.cursorY = Math.min(this.cursorY, this.rows - 1);
    this.render();
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  private disposeDom(): void {
    if (this.root !== null) {
      this.root.removeEventListener("keydown", this.keydownHandler);
      this.root.removeEventListener("beforeinput", this.beforeInputHandler);
      this.root.removeEventListener("paste", this.pasteHandler);

      this.root.remove();
    }
    this.root = null;
    this.viewport = null;
    this.cursorEl = null;
  }

  private emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data);
  }

  private handleBeforeInput(event: InputEvent): void {
    if (this.composition) return;
    if (
      event.inputType === "insertText" &&
      typeof event.data === "string" &&
      event.data.length > 0
    ) {
      event.preventDefault();
      this.emitData(event.data);
    }
  }

  private handlePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length > 0) this.emitData(text);
  }

  private handleKeydown(event: KeyboardEvent): void {
    const sequence = keySequence(event);
    if (sequence === null) return;
    event.preventDefault();
    this.emitData(sequence);
  }

  private putChar(char: string): void {
    if (char === "\r") {
      this.cursorX = 0;
      return;
    }
    if (char === "\n") {
      this.lineFeed();
      return;
    }
    if (char === "\b" || char === "\x7f") {
      this.cursorX = Math.max(0, this.cursorX - 1);
      return;
    }
    if (char === "\t") {
      const spaces = 8 - (this.cursorX % 8);
      for (let i = 0; i < spaces; i += 1) this.putChar(" ");
      return;
    }
    if (char < " " && !PRINTABLE_CONTROL.has(char)) return;
    this.screen[this.cursorY]![this.cursorX] = { char };
    this.cursorX += 1;
    if (this.cursorX >= this.cols) {
      this.cursorX = 0;
      this.lineFeed();
    }
  }

  private lineFeed(): void {
    if (this.cursorY === this.rows - 1) {
      this.screen.shift();
      this.screen.push(createRow(this.cols));
      return;
    }
    this.cursorY += 1;
  }

  private consumeEscape(text: string, start: number): number {
    const next = text[start + 1];
    if (next === undefined) return start;
    if (next === "[") return this.consumeCsi(text, start + 2);
    if (next === "]") return consumeUntilTerminator(text, start + 2);
    if (next === "c") {
      this.clear();
      return start + 1;
    }
    return start + 1;
  }

  private consumeCsi(text: string, index: number): number {
    let cursor = index;
    while (cursor < text.length) {
      const code = text.charCodeAt(cursor);
      if (code >= 0x40 && code <= 0x7e) break;
      cursor += 1;
    }
    const final = text[cursor] ?? "";
    const params = text.slice(index, cursor);
    const numbers = params
      .replace(/^\?/, "")
      .split(";")
      .filter(Boolean)
      .map((part) => Number.parseInt(part, 10));
    const first = numbers[0] ?? 1;
    switch (final) {
      case "A":
        this.cursorY = Math.max(0, this.cursorY - first);
        break;
      case "B":
        this.cursorY = Math.min(this.rows - 1, this.cursorY + first);
        break;
      case "C":
        this.cursorX = Math.min(this.cols - 1, this.cursorX + first);
        break;
      case "D":
        this.cursorX = Math.max(0, this.cursorX - first);
        break;
      case "H":
      case "f": {
        const row = Math.max(1, numbers[0] ?? 1);
        const col = Math.max(1, numbers[1] ?? 1);
        this.cursorY = Math.min(this.rows - 1, row - 1);
        this.cursorX = Math.min(this.cols - 1, col - 1);
        break;
      }
      case "J":
        if ((numbers[0] ?? 0) === 2) this.screen = createScreen(this.cols, this.rows);
        break;
      case "K":
        this.eraseLine(numbers[0] ?? 0);
        break;
      case "m":
        break;
      default:
        break;
    }
    return cursor;
  }

  private eraseLine(mode: number): void {
    if (mode === 1) {
      for (let x = 0; x <= this.cursorX; x += 1) this.screen[this.cursorY]![x] = { char: " " };
      return;
    }
    if (mode === 2) {
      this.screen[this.cursorY] = createRow(this.cols);
      return;
    }
    for (let x = this.cursorX; x < this.cols; x += 1) this.screen[this.cursorY]![x] = { char: " " };
  }

  private render(): void {
    if (this.viewport === null) return;
    const fragment = document.createDocumentFragment();
    for (let y = 0; y < this.rows; y += 1) {
      const line = document.createElement("div");
      line.style.height = `${this.options.fontSize * this.options.lineHeight}px`;
      for (let x = 0; x < this.cols; x += 1) {
        const span = document.createElement("span");
        span.textContent = this.screen[y]![x]!.char;
        if (x === this.cursorX && y === this.cursorY) {
          span.style.background = this.options.theme.cursor;
          span.style.color = this.options.theme.background;
          this.cursorEl = span;
        }
        line.appendChild(span);
      }
      fragment.appendChild(line);
    }
    this.viewport.replaceChildren(fragment);
  }
}

function createScreen(cols: number, rows: number): Cell[][] {
  return Array.from({ length: rows }, () => createRow(cols));
}

function createRow(cols: number): Cell[] {
  return Array.from({ length: cols }, () => ({ char: " " }));
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function consumeUntilTerminator(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\u0007") return index;
    if (text[index] === "\x1b" && text[index + 1] === "\\") return index + 1;
  }
  return text.length - 1;
}

function keySequence(event: KeyboardEvent): string | null {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") return null;
  if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    return event.key;
  }
  if (event.ctrlKey && !event.altKey && event.key.length === 1) {
    const lower = event.key.toLowerCase();
    const code = lower.charCodeAt(0);
    if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  }
  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return event.shiftKey ? "\x1b[Z" : "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "Delete":
      return "\x1b[3~";
    default:
      return null;
  }
}
