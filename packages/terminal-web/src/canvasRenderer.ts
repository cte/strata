import type { TerminalTheme } from "./index.js";
import type { TerminalCell, TerminalCellStyle, TerminalSnapshot } from "./screen.js";

export interface TerminalRendererOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: Required<TerminalTheme>;
  /**
   * CSS background applied to the scroll root. Defaults to the theme
   * background; pass "transparent" to let a host surface show through (the
   * canvas itself is transparent and only paints glyphs + explicit cell
   * backgrounds).
   */
  rootBackground?: string;
}

interface SelectionPoint {
  row: number;
  col: number;
}

/** Extra rows drawn beyond the viewport so quick scrolls stay filled. */
const OVERSCAN_ROWS = 2;

/**
 * Canvas terminal renderer. Mirrors libghostty/ghostty-web's approach: the cell
 * grid (the heavy lifting) lives in libghostty; this draws the authoritative
 * cells to a `<canvas>`, only repainting rows that actually changed, and only
 * for the rows currently in view. That keeps cost proportional to the visible
 * window — fast for full-screen apps (top/vim) and for huge scrollback alike,
 * which a per-frame DOM rebuild never managed.
 */
export class TerminalCanvasRenderer {
  private root: HTMLDivElement | null = null;
  private sizer: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resolvedFontFamily = "monospace";
  private devicePixelRatio = 1;
  private cellWidth = 0;
  private cellHeight = 0;
  private lastSnapshot: TerminalSnapshot | null = null;

  // Incremental-redraw bookkeeping: persisted canvas pixels between frames, so
  // we only clear+repaint rows whose content key changed (unless forced).
  private rowKeys = new Map<number, string>();
  private lastScrollTop = -1;
  private lastCanvasWidth = 0;
  private lastCanvasHeight = 0;

  // Selection state (content coordinates; col may equal cols for line-end).
  private mouseTracking = false;
  private selecting = false;
  private selStart: SelectionPoint | null = null;
  private selEnd: SelectionPoint | null = null;

  private scrollRaf = 0;
  private suppressScroll = false;
  private readonly handleScroll = () => {
    if (this.suppressScroll) {
      this.suppressScroll = false;
      return;
    }
    if (this.scrollRaf !== 0 || typeof requestAnimationFrame !== "function") return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.renderWindow(true);
    });
  };

  constructor(private options: TerminalRendererOptions) {}

  setFont(fontSize: number, lineHeight?: number): void {
    this.options = {
      ...this.options,
      fontSize,
      lineHeight: lineHeight ?? this.options.lineHeight,
    };
    this.measureCell();
    this.rowKeys.clear();
    this.renderWindow(true);
  }

  open(container: HTMLElement): HTMLDivElement {
    this.dispose();

    const root = document.createElement("div");
    root.tabIndex = 0;
    root.contentEditable = "plaintext-only";
    root.setAttribute("role", "textbox");
    root.setAttribute("aria-label", "Terminal");
    root.spellcheck = false;
    root.style.cssText = [
      "box-sizing:border-box",
      "position:relative",
      "height:100%",
      "width:100%",
      "overflow:auto",
      "outline:none",
      // contenteditable (for IME/key capture) draws a native caret; hide it.
      "caret-color:transparent",
      "cursor:text",
      `background:${this.options.rootBackground ?? this.options.theme.background}`,
      `font-family:${this.options.fontFamily}`,
    ].join(";");

    const sizer = document.createElement("div");
    sizer.style.cssText = "position:relative;width:100%;pointer-events:none";

    const canvas = document.createElement("canvas");
    canvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none";

    root.append(sizer, canvas);
    container.replaceChildren(root);
    root.addEventListener("scroll", this.handleScroll, { passive: true });
    root.addEventListener("mousedown", this.handleMouseDown);
    root.addEventListener("mousemove", this.handleMouseMove);
    root.addEventListener("mouseup", this.handleMouseUp);

    // Resolve a real font stack: ctx.font cannot read CSS variables, so let the
    // DOM resolve `var(--font-mono-terminal)` and copy the computed family.
    this.resolvedFontFamily = getComputedStyle(root).fontFamily || this.options.fontFamily;

    this.root = root;
    this.sizer = sizer;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.devicePixelRatio =
      typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
    this.measureCell();
    return root;
  }

  focus(): void {
    this.root?.focus();
  }

  dispose(): void {
    if (this.scrollRaf !== 0 && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.scrollRaf);
    }
    this.scrollRaf = 0;
    if (this.root !== null) {
      this.root.removeEventListener("scroll", this.handleScroll);
      this.root.removeEventListener("mousedown", this.handleMouseDown);
      this.root.removeEventListener("mousemove", this.handleMouseMove);
      this.root.removeEventListener("mouseup", this.handleMouseUp);
      this.root.remove();
    }
    this.root = null;
    this.sizer = null;
    this.canvas = null;
    this.ctx = null;
    this.lastSnapshot = null;
    this.rowKeys.clear();
    this.selStart = null;
    this.selEnd = null;
    this.selecting = false;
  }

  measureFit(fallback: { cols: number; rows: number }): { cols: number; rows: number } {
    if (this.root === null || this.cellWidth <= 0 || this.cellHeight <= 0) return fallback;
    const innerWidth = this.root.clientWidth;
    const innerHeight = this.root.clientHeight;
    if (innerWidth <= 0 || innerHeight <= 0) return fallback;
    return {
      cols: Math.max(2, Math.floor(innerWidth / this.cellWidth)),
      rows: Math.max(2, Math.floor(innerHeight / this.cellHeight)),
    };
  }

  render(snapshot: TerminalSnapshot): void {
    this.mouseTracking = snapshot.modes.mouseTracking;
    this.lastSnapshot = snapshot;
    this.renderWindow(false);
  }

  /** Returns the current selection as text, or null when nothing is selected. */
  getSelectionText(): string | null {
    const snapshot = this.lastSnapshot;
    if (snapshot === null || this.selStart === null || this.selEnd === null) return null;
    const [a, b] = orderPoints(this.selStart, this.selEnd);
    if (a.row === b.row && a.col === b.col) return null;

    const out: string[] = [];
    for (let row = a.row; row <= b.row; row += 1) {
      const cells = rowAt(snapshot, row);
      const startCol = row === a.row ? a.col : 0;
      const endCol = row === b.row ? b.col : snapshot.cols;
      let line = "";
      for (let x = startCol; x < endCol; x += 1) {
        const cell = cells?.[x];
        if (cell?.continuation === true) continue;
        line += cell?.char ?? " ";
      }
      out.push(line.replace(/\s+$/u, ""));
    }
    return out.join("\n");
  }

  private measureCell(): void {
    const ctx = this.ctx;
    this.cellHeight = Math.round(this.options.fontSize * this.options.lineHeight);
    if (ctx === null) {
      this.cellWidth = this.options.fontSize * 0.6;
      return;
    }
    ctx.font = this.fontString(false, false);
    const width = ctx.measureText("M").width;
    this.cellWidth = width > 0 ? width : this.options.fontSize * 0.6;
  }

  private fontString(bold: boolean, italic: boolean): string {
    const style = italic ? "italic " : "";
    const weight = bold ? "700" : "400";
    return `${style}${weight} ${this.options.fontSize}px ${this.resolvedFontFamily}`;
  }

  /**
   * Repaint the visible window. `force` clears and redraws every visible row
   * (first paint, scroll, resize, selection change); otherwise only rows whose
   * content key changed are cleared and redrawn, leaving the rest as-is.
   */
  private renderWindow(force: boolean): void {
    const root = this.root;
    const sizer = this.sizer;
    const canvas = this.canvas;
    const ctx = this.ctx;
    const snapshot = this.lastSnapshot;
    if (root === null || sizer === null || canvas === null || ctx === null || snapshot === null) {
      return;
    }
    if (this.cellWidth <= 0 || this.cellHeight <= 0) this.measureCell();

    const scrollbackLen = snapshot.scrollbackCells.length;
    const totalRows = scrollbackLen + snapshot.cells.length;
    const totalHeight = totalRows * this.cellHeight;

    const clientWidth = root.clientWidth;
    const clientHeight = root.clientHeight || totalHeight;

    // Measure "pinned to the bottom?" against the CURRENT (pre-growth) scroll
    // state — before resizing the spacer — so newly-arrived output keeps us
    // following the bottom the way a real terminal does.
    const follow = root.scrollHeight - root.scrollTop - root.clientHeight <= this.cellHeight + 1;

    sizer.style.height = `${totalHeight}px`;
    const scrollTop = follow ? Math.max(0, totalHeight - clientHeight) : root.scrollTop;

    // Keep the (absolutely positioned) canvas pinned over the viewport.
    canvas.style.top = `${scrollTop}px`;

    const dpr = this.devicePixelRatio;
    const pixelWidth = Math.max(1, Math.round(clientWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(clientHeight * dpr));
    const resized = canvas.width !== pixelWidth || canvas.height !== pixelHeight;
    if (resized) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
    }
    // Setting width/height (or first paint) resets the transform and clears.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const forceAll =
      force ||
      resized ||
      scrollTop !== this.lastScrollTop ||
      pixelWidth !== this.lastCanvasWidth ||
      pixelHeight !== this.lastCanvasHeight ||
      this.selStart !== null;
    if (forceAll) {
      ctx.clearRect(0, 0, clientWidth, clientHeight);
      this.rowKeys.clear();
    }
    this.lastScrollTop = scrollTop;
    this.lastCanvasWidth = pixelWidth;
    this.lastCanvasHeight = pixelHeight;

    const firstRow = Math.max(0, Math.floor(scrollTop / this.cellHeight) - OVERSCAN_ROWS);
    const lastRow = Math.min(
      totalRows - 1,
      Math.ceil((scrollTop + clientHeight) / this.cellHeight) + OVERSCAN_ROWS,
    );
    const cursorRow = scrollbackLen + snapshot.cursor.y;

    for (let row = firstRow; row <= lastRow; row += 1) {
      const cells = rowAt(snapshot, row);
      const key = this.rowKey(cells, row, snapshot, cursorRow);
      if (!forceAll && this.rowKeys.get(row) === key) continue;
      this.rowKeys.set(row, key);
      this.drawRow(ctx, cells, row, scrollTop, clientWidth, snapshot, cursorRow);
    }

    if (follow && Math.abs(root.scrollTop - scrollTop) > 0.5) {
      this.suppressScroll = true;
      root.scrollTop = scrollTop;
    }
  }

  private rowKey(
    cells: readonly TerminalCell[] | undefined,
    row: number,
    snapshot: TerminalSnapshot,
    cursorRow: number,
  ): string {
    const cursorPart = row === cursorRow ? ` c${snapshot.cursor.x}` : "";
    const selPart = this.selStart !== null ? ` s${row}` : "";
    if (cells === undefined) return `empty${cursorPart}${selPart}`;
    let key = "";
    for (let x = 0; x < snapshot.cols; x += 1) {
      const cell = cells[x];
      key += (cell?.continuation === true ? " " : (cell?.char ?? " ")) + cellStyleKey(cell);
    }
    return key + cursorPart + selPart;
  }

  private drawRow(
    ctx: CanvasRenderingContext2D,
    cells: readonly TerminalCell[] | undefined,
    row: number,
    scrollTop: number,
    clientWidth: number,
    snapshot: TerminalSnapshot,
    cursorRow: number,
  ): void {
    const theme = this.options.theme;
    const y = row * this.cellHeight - scrollTop;
    const transparent = (this.options.rootBackground ?? theme.background) === "transparent";

    // Clear the whole row first so wide glyphs are never clipped by a neighbor.
    ctx.clearRect(0, y, clientWidth, this.cellHeight);
    if (!transparent) {
      ctx.fillStyle = this.options.rootBackground ?? theme.background;
      ctx.fillRect(0, y, clientWidth, this.cellHeight);
    }

    const [selA, selB] =
      this.selStart !== null && this.selEnd !== null
        ? orderPoints(this.selStart, this.selEnd)
        : [null, null];

    for (let x = 0; x < snapshot.cols; x += 1) {
      const cell = cells?.[x];
      const isCursor = x === snapshot.cursor.x && row === cursorRow;
      const colors = resolveColors(cell?.style, theme, isCursor);
      const cx = x * this.cellWidth;

      if (colors.background !== null) {
        ctx.fillStyle = colors.background;
        ctx.fillRect(cx, y, this.cellWidth, this.cellHeight);
      }

      const char = cell?.continuation === true ? "" : (cell?.char ?? "");
      if (char !== "" && char !== " " && cell?.style?.invisible !== true) {
        const style = cell?.style;
        ctx.font = this.fontString(style?.bold === true, style?.italic === true);
        ctx.fillStyle = colors.foreground;
        ctx.globalAlpha = style?.dim === true ? 0.68 : 1;
        ctx.textBaseline = "middle";
        ctx.fillText(char, cx, y + this.cellHeight / 2);
        ctx.globalAlpha = 1;
        this.drawDecorations(ctx, style, colors.foreground, cx, y);
      }

      if (selA !== null && selB !== null && isSelected(row, x, selA, selB)) {
        ctx.fillStyle = theme.selection;
        ctx.fillRect(cx, y, this.cellWidth, this.cellHeight);
      }
    }
  }

  private drawDecorations(
    ctx: CanvasRenderingContext2D,
    style: TerminalCellStyle | undefined,
    color: string,
    cx: number,
    y: number,
  ): void {
    if (style?.underline !== true && style?.strikethrough !== true && style === undefined) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, Math.round(this.options.fontSize / 14));
    if (style?.underline === true) {
      const ly = Math.round(y + this.cellHeight - ctx.lineWidth);
      ctx.beginPath();
      ctx.moveTo(cx, ly);
      ctx.lineTo(cx + this.cellWidth, ly);
      ctx.stroke();
    }
    if (style?.strikethrough === true) {
      const ly = Math.round(y + this.cellHeight / 2);
      ctx.beginPath();
      ctx.moveTo(cx, ly);
      ctx.lineTo(cx + this.cellWidth, ly);
      ctx.stroke();
    }
  }

  // --- Selection + hyperlink input (only active when not in mouse mode) ------

  private readonly handleMouseDown = (event: MouseEvent) => {
    if (this.mouseTracking || event.button !== 0) return;
    const point = this.pointAt(event);
    if (point === null) return;
    if ((event.ctrlKey || event.metaKey) && this.openHyperlinkAt(point)) {
      event.preventDefault();
      return;
    }
    this.selecting = true;
    this.selStart = point;
    this.selEnd = point;
    this.renderWindow(true);
  };

  private readonly handleMouseMove = (event: MouseEvent) => {
    if (!this.selecting) return;
    const point = this.pointAt(event);
    if (point === null) return;
    this.selEnd = point;
    this.renderWindow(true);
  };

  private readonly handleMouseUp = () => {
    if (!this.selecting) return;
    this.selecting = false;
    if (
      this.selStart !== null &&
      this.selEnd !== null &&
      this.selStart.row === this.selEnd.row &&
      this.selStart.col === this.selEnd.col
    ) {
      this.selStart = null;
      this.selEnd = null;
      this.renderWindow(true);
    }
  };

  private pointAt(event: MouseEvent): SelectionPoint | null {
    const root = this.root;
    const snapshot = this.lastSnapshot;
    if (root === null || snapshot === null || this.cellWidth <= 0) return null;
    const rect = root.getBoundingClientRect();
    const totalRows = snapshot.scrollbackCells.length + snapshot.cells.length;
    const x = event.clientX - rect.left + root.scrollLeft;
    const yPx = event.clientY - rect.top + root.scrollTop;
    const row = Math.max(0, Math.min(totalRows - 1, Math.floor(yPx / this.cellHeight)));
    const col = Math.max(0, Math.min(snapshot.cols, Math.floor(x / this.cellWidth)));
    return { row, col };
  }

  private openHyperlinkAt(point: SelectionPoint): boolean {
    const snapshot = this.lastSnapshot;
    if (snapshot === null) return false;
    const href = rowAt(snapshot, point.row)?.[point.col]?.hyperlink;
    if (href === undefined) return false;
    window.open(href, "_blank", "noopener,noreferrer");
    return true;
  }
}

function rowAt(snapshot: TerminalSnapshot, row: number): readonly TerminalCell[] | undefined {
  const scrollbackLen = snapshot.scrollbackCells.length;
  return row < scrollbackLen ? snapshot.scrollbackCells[row] : snapshot.cells[row - scrollbackLen];
}

function orderPoints(a: SelectionPoint, b: SelectionPoint): [SelectionPoint, SelectionPoint] {
  if (a.row < b.row || (a.row === b.row && a.col <= b.col)) return [a, b];
  return [b, a];
}

function isSelected(row: number, col: number, a: SelectionPoint, b: SelectionPoint): boolean {
  if (row < a.row || row > b.row) return false;
  if (row === a.row && col < a.col) return false;
  if (row === b.row && col >= b.col) return false;
  return true;
}

interface ResolvedColors {
  foreground: string;
  background: string | null;
}

function resolveColors(
  style: TerminalCellStyle | undefined,
  theme: Required<TerminalTheme>,
  isCursor: boolean,
): ResolvedColors {
  if (isCursor) {
    return { foreground: theme.background, background: theme.cursor };
  }
  if (style === undefined) {
    return { foreground: theme.foreground, background: null };
  }
  if (style.inverse === true) {
    return {
      foreground: style.background ?? theme.background,
      background: style.foreground ?? theme.foreground,
    };
  }
  return {
    foreground: style.foreground ?? theme.foreground,
    background: style.background ?? null,
  };
}

/** Compact style fingerprint for run/row change detection. */
function cellStyleKey(cell: TerminalCell | undefined): string {
  const s = cell?.style;
  if (s === undefined && cell?.hyperlink === undefined) return "";
  return `[${s?.foreground ?? ""},${s?.background ?? ""},${s?.bold ? 1 : 0}${s?.dim ? 1 : 0}${
    s?.italic ? 1 : 0
  }${s?.underline ? 1 : 0}${s?.strikethrough ? 1 : 0}${s?.inverse ? 1 : 0}${
    s?.invisible ? 1 : 0
  },${cell?.hyperlink ?? ""}]`;
}
