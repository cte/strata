import type { TerminalTheme } from "./index.js";
import type { TerminalCellStyle, TerminalSnapshot } from "./screen.js";

export interface TerminalRendererOptions {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  theme: Required<TerminalTheme>;
  /**
   * CSS background applied to the scroll root. Defaults to the theme
   * background; pass "transparent" to let a host surface show through while
   * still using {@link TerminalTheme.background} for cursor-cell contrast.
   */
  rootBackground?: string;
}

export class TerminalDomRenderer {
  private root: HTMLDivElement | null = null;
  private viewport: HTMLDivElement | null = null;

  constructor(private options: TerminalRendererOptions) {}

  setFont(fontSize: number, lineHeight?: number): void {
    this.options = {
      ...this.options,
      fontSize,
      lineHeight: lineHeight ?? this.options.lineHeight,
    };
    if (this.root !== null) {
      this.root.style.fontSize = `${this.options.fontSize}px`;
      this.root.style.lineHeight = `${this.options.lineHeight}`;
    }
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
      "height:100%",
      "width:100%",
      "overflow:auto",
      "outline:none",
      "white-space:pre",
      "user-select:text",
      "padding:10px",
      `background:${this.options.rootBackground ?? this.options.theme.background}`,
      `color:${this.options.theme.foreground}`,
      `font-family:${this.options.fontFamily}`,
      `font-size:${this.options.fontSize}px`,
      `line-height:${this.options.lineHeight}`,
      "font-variant-ligatures:none",
    ].join(";");

    const viewport = document.createElement("div");
    viewport.style.cssText = "min-height:100%;width:max-content;min-width:100%";
    root.appendChild(viewport);
    container.replaceChildren(root);

    this.root = root;
    this.viewport = viewport;
    return root;
  }

  focus(): void {
    this.root?.focus();
  }

  dispose(): void {
    this.root?.remove();
    this.root = null;
    this.viewport = null;
  }

  measureFit(fallback: { cols: number; rows: number }): { cols: number; rows: number } {
    if (this.root === null) return fallback;

    const computed = getComputedStyle(this.root);
    const horizontalPadding =
      parsePixels(computed.paddingLeft) + parsePixels(computed.paddingRight);
    const verticalPadding = parsePixels(computed.paddingTop) + parsePixels(computed.paddingBottom);
    const innerWidth = this.root.clientWidth - horizontalPadding;
    const innerHeight = this.root.clientHeight - verticalPadding;
    const cell = this.measureCell();

    if (innerWidth <= 0 || innerHeight <= 0 || cell.width <= 0 || cell.height <= 0) {
      return fallback;
    }

    return {
      cols: Math.max(2, Math.floor(innerWidth / cell.width)),
      rows: Math.max(2, Math.floor(innerHeight / cell.height)),
    };
  }

  render(snapshot: TerminalSnapshot): void {
    if (this.viewport === null) return;
    const root = this.root;
    const shouldFollowOutput =
      root === null || root.scrollHeight - root.scrollTop - root.clientHeight <= 2;
    const previousScrollTop = root?.scrollTop ?? 0;
    const fragment = document.createDocumentFragment();
    const rows = [...snapshot.scrollbackCells, ...snapshot.cells];
    const cursorY = snapshot.scrollbackCells.length + snapshot.cursor.y;

    for (let y = 0; y < rows.length; y += 1) {
      const line = document.createElement("div");
      line.style.height = `${this.options.fontSize * this.options.lineHeight}px`;
      const row = rows[y];
      for (let x = 0; x < snapshot.cols; x += 1) {
        const cell = row?.[x];
        const span = document.createElement("span");
        span.textContent = cell?.continuation === true ? " " : (cell?.char ?? " ");
        applyCellStyle(span, cell?.style, this.options.theme);
        applyCellLink(span, cell?.hyperlink);
        if (x === snapshot.cursor.x && y === cursorY) {
          span.style.background = this.options.theme.cursor;
          span.style.color = this.options.theme.background;
        }
        line.appendChild(span);
      }
      fragment.appendChild(line);
    }

    this.viewport.replaceChildren(fragment);
    if (root !== null) {
      root.scrollTop = shouldFollowOutput ? root.scrollHeight : previousScrollTop;
    }
  }

  private measureCell(): { width: number; height: number } {
    if (this.root === null) {
      return {
        width: this.options.fontSize * 0.62,
        height: this.options.fontSize * this.options.lineHeight,
      };
    }

    const probe = document.createElement("span");
    probe.textContent = "W";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    this.root.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    probe.remove();

    return {
      width: rect.width || this.options.fontSize * 0.62,
      height: rect.height || this.options.fontSize * this.options.lineHeight,
    };
  }
}

function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applyCellStyle(
  span: HTMLSpanElement,
  style: TerminalCellStyle | undefined,
  theme: Required<TerminalTheme>,
): void {
  if (style === undefined) return;
  if (style.invisible === true) {
    span.style.visibility = "hidden";
    return;
  }

  const foreground = style.inverse
    ? (style.background ?? theme.background)
    : (style.foreground ?? theme.foreground);
  const background = style.inverse ? (style.foreground ?? theme.foreground) : style.background;

  if (foreground !== theme.foreground) span.style.color = foreground;
  if (background !== undefined) span.style.background = background;
  if (style.bold === true) span.style.fontWeight = "700";
  if (style.dim === true) span.style.opacity = "0.68";
  if (style.italic === true) span.style.fontStyle = "italic";
  if (style.underline === true && style.strikethrough === true) {
    span.style.textDecoration = "underline line-through";
  } else if (style.underline === true) span.style.textDecoration = "underline";
  else if (style.strikethrough === true) span.style.textDecoration = "line-through";
}

function applyCellLink(span: HTMLSpanElement, hyperlink: string | undefined): void {
  if (hyperlink === undefined) return;
  span.dataset.href = hyperlink;
  span.title = hyperlink;
  span.style.textDecoration = span.style.textDecoration
    ? `${span.style.textDecoration} underline`
    : "underline";
  span.style.textDecorationStyle = "dotted";
  span.style.cursor = "pointer";
  span.addEventListener("click", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    window.open(hyperlink, "_blank", "noopener,noreferrer");
  });
}
