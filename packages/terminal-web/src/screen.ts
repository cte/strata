export interface TerminalCell {
  char: string;
  style?: TerminalCellStyle;
}

export interface TerminalCellStyle {
  foreground?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface TerminalCursor {
  x: number;
  y: number;
}

export interface TerminalModes {
  alternateScreen: boolean;
  bracketedPaste: boolean;
}

export interface TerminalSnapshot {
  cols: number;
  rows: number;
  cursor: TerminalCursor;
  modes: TerminalModes;
  cells: readonly (readonly TerminalCell[])[];
}

interface ScreenBuffer {
  cells: TerminalCell[][];
  cursorX: number;
  cursorY: number;
}

export class TerminalScreen {
  private cols: number;
  private rows: number;
  private primaryBuffer: ScreenBuffer;
  private alternateBuffer: ScreenBuffer | null = null;
  private activeBuffer: ScreenBuffer;
  private currentStyle: TerminalCellStyle = {};
  private scrollTop = 0;
  private scrollBottom: number;
  private modes: TerminalModes = {
    alternateScreen: false,
    bracketedPaste: false,
  };

  constructor(cols: number, rows: number) {
    this.cols = positiveInt(cols, 80);
    this.rows = positiveInt(rows, 24);
    this.primaryBuffer = createBuffer(this.cols, this.rows);
    this.activeBuffer = this.primaryBuffer;
    this.scrollBottom = this.rows - 1;
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  get modeState(): TerminalModes {
    return { ...this.modes };
  }

  snapshot(): TerminalSnapshot {
    return {
      cols: this.cols,
      rows: this.rows,
      cursor: { x: this.activeBuffer.cursorX, y: this.activeBuffer.cursorY },
      modes: this.modeState,
      cells: this.activeBuffer.cells,
    };
  }

  reset(): void {
    this.primaryBuffer = createBuffer(this.cols, this.rows);
    this.alternateBuffer = null;
    this.activeBuffer = this.primaryBuffer;
    this.currentStyle = {};
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.modes = {
      alternateScreen: false,
      bracketedPaste: false,
    };
  }

  resize(cols: number, rows: number): void {
    const nextCols = positiveInt(cols, this.cols);
    const nextRows = positiveInt(rows, this.rows);
    if (nextCols === this.cols && nextRows === this.rows) return;

    this.primaryBuffer = resizeBuffer(this.primaryBuffer, nextCols, nextRows);
    if (this.alternateBuffer !== null) {
      this.alternateBuffer = resizeBuffer(this.alternateBuffer, nextCols, nextRows);
    }

    this.cols = nextCols;
    this.rows = nextRows;
    this.activeBuffer =
      this.modes.alternateScreen && this.alternateBuffer !== null
        ? this.alternateBuffer
        : this.primaryBuffer;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
  }

  putChar(char: string): void {
    this.activeBuffer.cells[this.activeBuffer.cursorY]![this.activeBuffer.cursorX] = cell(
      char,
      this.currentStyle,
    );
    this.activeBuffer.cursorX += 1;
    if (this.activeBuffer.cursorX >= this.cols) {
      this.activeBuffer.cursorX = 0;
      this.lineFeed();
    }
  }

  carriageReturn(): void {
    this.activeBuffer.cursorX = 0;
  }

  lineFeed(): void {
    if (this.activeBuffer.cursorY === this.scrollBottom) {
      this.scrollUp(1);
      return;
    }
    this.activeBuffer.cursorY = Math.min(this.rows - 1, this.activeBuffer.cursorY + 1);
  }

  backspace(): void {
    this.activeBuffer.cursorX = Math.max(0, this.activeBuffer.cursorX - 1);
  }

  tab(): void {
    const spaces = 8 - (this.activeBuffer.cursorX % 8);
    for (let i = 0; i < spaces; i += 1) this.putChar(" ");
  }

  moveCursor(deltaX: number, deltaY: number): void {
    this.activeBuffer.cursorX = clamp(this.activeBuffer.cursorX + deltaX, 0, this.cols - 1);
    this.activeBuffer.cursorY = clamp(this.activeBuffer.cursorY + deltaY, 0, this.rows - 1);
  }

  setCursor(row: number, col: number): void {
    this.activeBuffer.cursorY = clamp(row - 1, 0, this.rows - 1);
    this.activeBuffer.cursorX = clamp(col - 1, 0, this.cols - 1);
  }

  setScrollRegion(top: number, bottom: number): void {
    const nextTop = clamp(Math.floor(top) - 1, 0, this.rows - 1);
    const nextBottom = clamp(Math.floor(bottom) - 1, 0, this.rows - 1);
    if (nextTop >= nextBottom) {
      this.resetScrollRegion();
      return;
    }

    this.scrollTop = nextTop;
    this.scrollBottom = nextBottom;
    this.setCursor(1, 1);
  }

  resetScrollRegion(): void {
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.setCursor(1, 1);
  }

  scrollUp(count: number): void {
    const steps = Math.max(1, Math.floor(count));
    for (let i = 0; i < steps; i += 1) {
      this.activeBuffer.cells.splice(this.scrollTop, 1);
      this.activeBuffer.cells.splice(this.scrollBottom, 0, createRow(this.cols, this.currentStyle));
    }
  }

  scrollDown(count: number): void {
    const steps = Math.max(1, Math.floor(count));
    for (let i = 0; i < steps; i += 1) {
      this.activeBuffer.cells.splice(this.scrollBottom, 1);
      this.activeBuffer.cells.splice(this.scrollTop, 0, createRow(this.cols, this.currentStyle));
    }
  }

  eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.activeBuffer.cells = createScreen(this.cols, this.rows, this.currentStyle);
      return;
    }

    if (mode === 1) {
      for (let y = 0; y < this.activeBuffer.cursorY; y += 1) {
        this.activeBuffer.cells[y] = createRow(this.cols, this.currentStyle);
      }
      for (let x = 0; x <= this.activeBuffer.cursorX; x += 1) {
        this.activeBuffer.cells[this.activeBuffer.cursorY]![x] = cell(" ", this.currentStyle);
      }
      return;
    }

    for (let x = this.activeBuffer.cursorX; x < this.cols; x += 1) {
      this.activeBuffer.cells[this.activeBuffer.cursorY]![x] = cell(" ", this.currentStyle);
    }
    for (let y = this.activeBuffer.cursorY + 1; y < this.rows; y += 1) {
      this.activeBuffer.cells[y] = createRow(this.cols, this.currentStyle);
    }
  }

  eraseLine(mode: number): void {
    if (mode === 1) {
      for (let x = 0; x <= this.activeBuffer.cursorX; x += 1) {
        this.activeBuffer.cells[this.activeBuffer.cursorY]![x] = cell(" ", this.currentStyle);
      }
      return;
    }
    if (mode === 2) {
      this.activeBuffer.cells[this.activeBuffer.cursorY] = createRow(this.cols, this.currentStyle);
      return;
    }
    for (let x = this.activeBuffer.cursorX; x < this.cols; x += 1) {
      this.activeBuffer.cells[this.activeBuffer.cursorY]![x] = cell(" ", this.currentStyle);
    }
  }

  applySgr(parameters: readonly number[]): void {
    const params = parameters.length === 0 ? [0] : parameters;
    for (let index = 0; index < params.length; index += 1) {
      const code = params[index] ?? 0;
      if (code === 0) {
        this.currentStyle = {};
        continue;
      }
      if (code === 1) this.currentStyle.bold = true;
      else if (code === 2) this.currentStyle.dim = true;
      else if (code === 3) this.currentStyle.italic = true;
      else if (code === 4) this.currentStyle.underline = true;
      else if (code === 7) this.currentStyle.inverse = true;
      else if (code === 22) {
        delete this.currentStyle.bold;
        delete this.currentStyle.dim;
      } else if (code === 23) delete this.currentStyle.italic;
      else if (code === 24) delete this.currentStyle.underline;
      else if (code === 27) delete this.currentStyle.inverse;
      else if (code >= 30 && code <= 37) {
        this.currentStyle.foreground = ANSI_COLORS[code - 30] ?? ANSI_COLORS[0]!;
      } else if (code === 39) delete this.currentStyle.foreground;
      else if (code >= 40 && code <= 47) {
        this.currentStyle.background = ANSI_COLORS[code - 40] ?? ANSI_COLORS[0]!;
      } else if (code === 49) delete this.currentStyle.background;
      else if (code >= 90 && code <= 97) {
        this.currentStyle.foreground = BRIGHT_ANSI_COLORS[code - 90] ?? BRIGHT_ANSI_COLORS[0]!;
      } else if (code >= 100 && code <= 107) {
        this.currentStyle.background = BRIGHT_ANSI_COLORS[code - 100] ?? BRIGHT_ANSI_COLORS[0]!;
      } else if (code === 38 || code === 48) {
        const parsed = parseExtendedColor(params, index + 1);
        if (parsed !== null) {
          if (code === 38) this.currentStyle.foreground = parsed.color;
          else this.currentStyle.background = parsed.color;
          index = parsed.nextIndex;
        }
      }
    }
  }

  setAlternateScreen(enabled: boolean): void {
    if (enabled === this.modes.alternateScreen) return;

    if (enabled) {
      this.alternateBuffer = createBuffer(this.cols, this.rows);
      this.activeBuffer = this.alternateBuffer;
      this.modes.alternateScreen = true;
      this.scrollTop = 0;
      this.scrollBottom = this.rows - 1;
      return;
    }

    this.activeBuffer = this.primaryBuffer;
    this.alternateBuffer = null;
    this.modes.alternateScreen = false;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
  }

  setBracketedPaste(enabled: boolean): void {
    this.modes.bracketedPaste = enabled;
  }
}

function createBuffer(cols: number, rows: number): ScreenBuffer {
  return {
    cells: createScreen(cols, rows),
    cursorX: 0,
    cursorY: 0,
  };
}

function resizeBuffer(buffer: ScreenBuffer, cols: number, rows: number): ScreenBuffer {
  const next = createScreen(cols, rows);
  const copyRows = Math.min(buffer.cells.length, rows);
  const copyCols = Math.min(buffer.cells[0]?.length ?? cols, cols);
  for (let y = 0; y < copyRows; y += 1) {
    for (let x = 0; x < copyCols; x += 1) {
      const source = buffer.cells[y]?.[x];
      next[y]![x] = source === undefined ? cell(" ") : cloneCell(source);
    }
  }

  return {
    cells: next,
    cursorX: Math.min(buffer.cursorX, cols - 1),
    cursorY: Math.min(buffer.cursorY, rows - 1),
  };
}

function createScreen(cols: number, rows: number, style: TerminalCellStyle = {}): TerminalCell[][] {
  return Array.from({ length: rows }, () => createRow(cols, style));
}

function createRow(cols: number, style: TerminalCellStyle = {}): TerminalCell[] {
  return Array.from({ length: cols }, () => cell(" ", style));
}

function cell(char: string, style: TerminalCellStyle = {}): TerminalCell {
  const cloned = cloneStyle(style);
  return cloned === undefined ? { char } : { char, style: cloned };
}

function cloneCell(source: TerminalCell): TerminalCell {
  return source.style === undefined ? { char: source.char } : cell(source.char, source.style);
}

function cloneStyle(style: TerminalCellStyle): TerminalCellStyle | undefined {
  const next: TerminalCellStyle = {};
  if (style.foreground !== undefined) next.foreground = style.foreground;
  if (style.background !== undefined) next.background = style.background;
  if (style.bold === true) next.bold = true;
  if (style.dim === true) next.dim = true;
  if (style.italic === true) next.italic = true;
  if (style.underline === true) next.underline = true;
  if (style.inverse === true) next.inverse = true;
  return Object.keys(next).length === 0 ? undefined : next;
}

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const ANSI_COLORS = [
  "#1f2937",
  "#ef4444",
  "#22c55e",
  "#eab308",
  "#3b82f6",
  "#d946ef",
  "#06b6d4",
  "#e5e7eb",
];

const BRIGHT_ANSI_COLORS = [
  "#6b7280",
  "#f87171",
  "#4ade80",
  "#facc15",
  "#60a5fa",
  "#e879f9",
  "#22d3ee",
  "#ffffff",
];

function parseExtendedColor(
  params: readonly number[],
  index: number,
): { color: string; nextIndex: number } | null {
  const mode = params[index];
  if (mode === 5) {
    const colorIndex = params[index + 1];
    if (colorIndex === undefined) return null;
    return { color: indexedColor(colorIndex), nextIndex: index + 1 };
  }
  if (mode === 2) {
    const red = params[index + 1];
    const green = params[index + 2];
    const blue = params[index + 3];
    if (red === undefined || green === undefined || blue === undefined) return null;
    return { color: rgbColor(red, green, blue), nextIndex: index + 3 };
  }
  return null;
}

function indexedColor(value: number): string {
  const index = clamp(Math.floor(value), 0, 255);
  if (index < 8) return ANSI_COLORS[index] ?? ANSI_COLORS[0]!;
  if (index < 16) return BRIGHT_ANSI_COLORS[index - 8] ?? BRIGHT_ANSI_COLORS[0]!;
  if (index < 232) {
    const cube = index - 16;
    const red = Math.floor(cube / 36);
    const green = Math.floor((cube % 36) / 6);
    const blue = cube % 6;
    return rgbColor(colorCubeComponent(red), colorCubeComponent(green), colorCubeComponent(blue));
  }

  const gray = 8 + (index - 232) * 10;
  return rgbColor(gray, gray, gray);
}

function colorCubeComponent(value: number): number {
  return value === 0 ? 0 : 55 + value * 40;
}

function rgbColor(red: number, green: number, blue: number): string {
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

function hexByte(value: number): string {
  return clamp(Math.floor(value), 0, 255).toString(16).padStart(2, "0");
}
