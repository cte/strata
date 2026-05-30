import type { TerminalCell, TerminalCellStyle, TerminalSnapshot } from "./screen.js";

export const GHOSTTY_CELL_SIZE = 16;
export const GHOSTTY_CONFIG_SIZE = 80;
export const DEFAULT_GHOSTTY_WASM_URL = new URL("../assets/ghostty-vt.wasm", import.meta.url).href;

export const enum GhosttyCellFlags {
  Bold = 1 << 0,
  Italic = 1 << 1,
  Underline = 1 << 2,
  Strikethrough = 1 << 3,
  Inverse = 1 << 4,
  Invisible = 1 << 5,
  Blink = 1 << 6,
  Faint = 1 << 7,
}

export interface GhosttyWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  ghostty_wasm_alloc_u8_array(size: number): number;
  ghostty_wasm_free_u8_array(ptr: number, size: number): void;
  ghostty_terminal_new(cols: number, rows: number): number;
  ghostty_terminal_new_with_config?: (cols: number, rows: number, configPtr: number) => number;
  ghostty_terminal_free(handle: number): void;
  ghostty_terminal_resize(handle: number, cols: number, rows: number): void;
  ghostty_terminal_write(handle: number, dataPtr: number, dataLen: number): void;
  ghostty_render_state_update(handle: number): number;
  ghostty_render_state_get_cursor_x(handle: number): number;
  ghostty_render_state_get_cursor_y(handle: number): number;
  ghostty_render_state_get_viewport(handle: number, bufferPtr: number, cellCount: number): number;
  ghostty_render_state_get_grapheme?: (
    handle: number,
    row: number,
    col: number,
    bufferPtr: number,
    bufferSize: number,
  ) => number;
  ghostty_terminal_is_alternate_screen(handle: number): number | boolean;
  ghostty_terminal_get_mode(handle: number, mode: number, isAnsi: boolean): number | boolean;
  ghostty_terminal_get_scrollback_length?: (handle: number) => number;
  ghostty_terminal_get_scrollback_line?: (
    handle: number,
    offset: number,
    bufferPtr: number,
    cellCount: number,
  ) => number;
  ghostty_terminal_get_scrollback_grapheme?: (
    handle: number,
    offset: number,
    col: number,
    bufferPtr: number,
    bufferSize: number,
  ) => number;
  ghostty_terminal_get_hyperlink_uri?: (
    handle: number,
    row: number,
    col: number,
    bufferPtr: number,
    bufferSize: number,
  ) => number;
  ghostty_terminal_get_scrollback_hyperlink_uri?: (
    handle: number,
    offset: number,
    col: number,
    bufferPtr: number,
    bufferSize: number,
  ) => number;
}

export interface LoadGhosttyWasmTerminalOptions {
  wasmUrl?: string | URL;
  cols: number;
  rows: number;
  scrollback?: number;
}

export class GhosttyWasmTerminal {
  private readonly exports: GhosttyWasmExports;
  private readonly memory: WebAssembly.Memory;
  private readonly handle: number;
  private readonly scrollbackLimit: number;
  private cols: number;
  private rows: number;
  private disposed = false;

  constructor(exports: GhosttyWasmExports, cols: number, rows: number, scrollbackLimit = 1000) {
    this.exports = exports;
    this.memory = exports.memory;
    this.cols = positiveInt(cols, 80);
    this.rows = positiveInt(rows, 24);
    this.scrollbackLimit = Math.max(0, Math.floor(scrollbackLimit));
    this.handle = this.createTerminal();
    if (this.handle === 0) throw new Error("Failed to create libghostty terminal.");
  }

  static fromInstance(
    instance: WebAssembly.Instance,
    cols: number,
    rows: number,
    scrollbackLimit?: number,
  ): GhosttyWasmTerminal {
    return new GhosttyWasmTerminal(
      instance.exports as GhosttyWasmExports,
      cols,
      rows,
      scrollbackLimit,
    );
  }

  write(data: string | Uint8Array): void {
    this.assertLive();
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.length === 0) return;

    this.withBytes(bytes.length, (ptr) => {
      new Uint8Array(this.memory.buffer).set(bytes, ptr);
      this.exports.ghostty_terminal_write(this.handle, ptr, bytes.length);
    });
  }

  resize(cols: number, rows: number): void {
    this.assertLive();
    this.cols = positiveInt(cols, this.cols);
    this.rows = positiveInt(rows, this.rows);
    this.exports.ghostty_terminal_resize(this.handle, this.cols, this.rows);
  }

  snapshot(): TerminalSnapshot {
    this.assertLive();
    this.exports.ghostty_render_state_update(this.handle);

    const cells = this.withBytes(this.cols * this.rows * GHOSTTY_CELL_SIZE, (ptr) => {
      const count = this.exports.ghostty_render_state_get_viewport(
        this.handle,
        ptr,
        this.cols * this.rows,
      );
      if (count < 0) throw new Error("libghostty render-state viewport read failed.");
      return this.decodeCells(ptr, this.rows, { kind: "viewport" });
    });

    return {
      cols: this.cols,
      rows: this.rows,
      cursor: {
        x: clamp(this.exports.ghostty_render_state_get_cursor_x(this.handle), 0, this.cols - 1),
        y: clamp(this.exports.ghostty_render_state_get_cursor_y(this.handle), 0, this.rows - 1),
      },
      modes: {
        alternateScreen: toBoolean(this.exports.ghostty_terminal_is_alternate_screen(this.handle)),
        bracketedPaste: toBoolean(this.exports.ghostty_terminal_get_mode(this.handle, 2004, false)),
        applicationCursor: toBoolean(this.exports.ghostty_terminal_get_mode(this.handle, 1, false)),
        mouseTracking:
          toBoolean(this.exports.ghostty_terminal_get_mode(this.handle, 1000, false)) ||
          toBoolean(this.exports.ghostty_terminal_get_mode(this.handle, 1002, false)) ||
          toBoolean(this.exports.ghostty_terminal_get_mode(this.handle, 1003, false)),
        sgrMouse: toBoolean(this.exports.ghostty_terminal_get_mode(this.handle, 1006, false)),
      },
      scrollbackCells: this.scrollbackCells(),
      cells,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.exports.ghostty_terminal_free(this.handle);
    this.disposed = true;
  }

  private withBytes<T>(size: number, fn: (ptr: number) => T): T {
    const ptr = this.exports.ghostty_wasm_alloc_u8_array(size);
    if (ptr === 0) throw new Error("libghostty WASM allocation failed.");
    try {
      return fn(ptr);
    } finally {
      this.exports.ghostty_wasm_free_u8_array(ptr, size);
    }
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("libghostty terminal has been disposed.");
  }

  private createTerminal(): number {
    if (this.exports.ghostty_terminal_new_with_config === undefined) {
      return this.exports.ghostty_terminal_new(this.cols, this.rows);
    }

    return this.withBytes(GHOSTTY_CONFIG_SIZE, (ptr) => {
      const view = new DataView(this.memory.buffer);
      view.setUint32(ptr, this.scrollbackLimit, true);
      return this.exports.ghostty_terminal_new_with_config!(this.cols, this.rows, ptr);
    });
  }

  private scrollbackCells(): TerminalCell[][] {
    const getLength = this.exports.ghostty_terminal_get_scrollback_length;
    const getLine = this.exports.ghostty_terminal_get_scrollback_line;
    if (getLength === undefined || getLine === undefined || this.scrollbackLimit === 0) return [];

    const total = Math.max(0, getLength(this.handle));
    const count = Math.min(total, this.scrollbackLimit);
    const first = total - count;
    const rows: TerminalCell[][] = [];
    for (let index = 0; index < count; index += 1) {
      const offset = first + index;
      const row = this.withBytes(this.cols * GHOSTTY_CELL_SIZE, (ptr) => {
        const written = getLine(this.handle, offset, ptr, this.cols);
        if (written < 0) return null;
        return this.decodeCells(ptr, 1, { kind: "scrollback", offset })[0] ?? [];
      });
      if (row !== null) rows.push(row);
    }
    return rows;
  }

  private decodeCells(
    ptr: number,
    rows: number,
    source: { kind: "viewport" } | { kind: "scrollback"; offset: number },
  ): TerminalCell[][] {
    const byteLength = this.cols * rows * GHOSTTY_CELL_SIZE;
    // Copy out before resolving graphemes/hyperlinks. Those lookups cross the
    // WASM boundary again and may grow memory, detaching existing JS views.
    const bytes = new Uint8Array(this.memory.buffer, ptr, byteLength).slice();
    const view = new DataView(bytes.buffer);
    const decoded: TerminalCell[][] = [];

    for (let y = 0; y < rows; y += 1) {
      const row: TerminalCell[] = [];
      for (let x = 0; x < this.cols; x += 1) {
        const offset = (y * this.cols + x) * GHOSTTY_CELL_SIZE;
        const codepoint = view.getUint32(offset, true);
        const flags = bytes[offset + 10] ?? 0;
        const width = bytes[offset + 11] ?? 1;
        const hyperlinkId = view.getUint16(offset + 12, true);
        const graphemeLength = bytes[offset + 14] ?? 0;
        const style = cellStyle(bytes, offset, flags);
        const char = this.cellText(source, y, x, codepoint, graphemeLength);
        const hyperlink = hyperlinkId === 0 ? null : (this.hyperlinkUri(source, y, x) ?? undefined);
        const cell: TerminalCell = style === undefined ? { char } : { char, style };
        if (width !== 1) cell.width = width;
        if (width === 0) cell.continuation = true;
        if (hyperlink !== undefined && hyperlink !== null) cell.hyperlink = hyperlink;
        row.push(cell);
      }
      decoded.push(row);
    }

    return decoded;
  }

  private cellText(
    source: { kind: "viewport" } | { kind: "scrollback"; offset: number },
    row: number,
    col: number,
    codepoint: number,
    graphemeLength: number,
  ): string {
    if (graphemeLength > 0) {
      const grapheme = this.graphemeString(source, row, col);
      if (grapheme !== null) return grapheme;
    }
    return String.fromCodePoint(codepoint || 32);
  }

  private graphemeString(
    source: { kind: "viewport" } | { kind: "scrollback"; offset: number },
    row: number,
    col: number,
  ): string | null {
    const getter =
      source.kind === "viewport"
        ? this.exports.ghostty_render_state_get_grapheme
        : this.exports.ghostty_terminal_get_scrollback_grapheme;
    if (getter === undefined) return null;

    return this.withBytes(16 * 4, (ptr) => {
      const count =
        source.kind === "viewport"
          ? getter(this.handle, row, col, ptr, 16)
          : getter(this.handle, source.offset, col, ptr, 16);
      if (count <= 0) return null;
      const view = new Uint32Array(this.memory.buffer, ptr, count);
      return String.fromCodePoint(...Array.from(view));
    });
  }

  private hyperlinkUri(
    source: { kind: "viewport" } | { kind: "scrollback"; offset: number },
    row: number,
    col: number,
  ): string | null {
    const getter =
      source.kind === "viewport"
        ? this.exports.ghostty_terminal_get_hyperlink_uri
        : this.exports.ghostty_terminal_get_scrollback_hyperlink_uri;
    if (getter === undefined) return null;

    for (const size of [2048, 8192, 32768]) {
      const value = this.withBytes(size, (ptr) => {
        const written =
          source.kind === "viewport"
            ? getter(this.handle, row, col, ptr, size)
            : getter(this.handle, source.offset, col, ptr, size);
        if (written === 0) return null;
        if (written < 0) return undefined;
        return new TextDecoder().decode(new Uint8Array(this.memory.buffer, ptr, written).slice());
      });
      if (value !== undefined) return value;
    }

    return null;
  }
}

function cellStyle(
  bytes: Uint8Array,
  offset: number,
  flags: number,
): TerminalCellStyle | undefined {
  const style: TerminalCellStyle = {};
  const foreground = rgb(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0);
  const background = rgb(bytes[offset + 7] ?? 0, bytes[offset + 8] ?? 0, bytes[offset + 9] ?? 0);

  if (foreground !== "#cccccc") style.foreground = foreground;
  if (background !== "#000000") style.background = background;
  if ((flags & GhosttyCellFlags.Bold) !== 0) style.bold = true;
  if ((flags & GhosttyCellFlags.Faint) !== 0) style.dim = true;
  if ((flags & GhosttyCellFlags.Italic) !== 0) style.italic = true;
  if ((flags & GhosttyCellFlags.Underline) !== 0) style.underline = true;
  if ((flags & GhosttyCellFlags.Strikethrough) !== 0) style.strikethrough = true;
  if ((flags & GhosttyCellFlags.Inverse) !== 0) style.inverse = true;
  if ((flags & GhosttyCellFlags.Invisible) !== 0) style.invisible = true;
  return Object.keys(style).length === 0 ? undefined : style;
}

function rgb(red: number, green: number, blue: number): string {
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

function hexByte(value: number): string {
  return clamp(Math.floor(value), 0, 255).toString(16).padStart(2, "0");
}

function toBoolean(value: number | boolean): boolean {
  return typeof value === "boolean" ? value : value !== 0;
}

function positiveInt(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function loadGhosttyWasmTerminal(
  options: LoadGhosttyWasmTerminalOptions,
): Promise<GhosttyWasmTerminal> {
  const instance = await instantiateGhosttyWasm(options.wasmUrl ?? DEFAULT_GHOSTTY_WASM_URL);
  return GhosttyWasmTerminal.fromInstance(instance, options.cols, options.rows, options.scrollback);
}

export async function instantiateGhosttyWasm(
  source: string | URL | ArrayBuffer,
): Promise<WebAssembly.Instance> {
  const bytes = await readWasmBytes(source);
  let instance: WebAssembly.Instance | null = null;
  const result = await WebAssembly.instantiate(bytes, {
    env: {
      log: (ptr: number, len: number) => {
        const memory = (instance?.exports as GhosttyWasmExports | undefined)?.memory;
        if (memory === undefined) return;
        const text = new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
        console.debug("[ghostty-vt]", text);
      },
    },
  });
  instance = result instanceof WebAssembly.Instance ? result : result.instance;
  return instance;
}

async function readWasmBytes(source: string | URL | ArrayBuffer): Promise<ArrayBuffer> {
  if (source instanceof ArrayBuffer) return source;

  const url = source instanceof URL ? source : new URL(String(source), import.meta.url);
  if (url.protocol === "file:" && typeof Bun !== "undefined") {
    return Bun.file(url).arrayBuffer();
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load Ghostty WASM from ${url.href}: ${response.status}`);
  }
  return response.arrayBuffer();
}
