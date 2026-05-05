/**
 * Markdown renderer ported from pi-mono's `tui/src/components/markdown.ts`.
 * Uses `marked` for parsing (so we get correct CommonMark/GFM behavior) and
 * `cli-highlight` for fenced code-block syntax highlighting. Token rendering
 * tracks pi's structure: heading, paragraph, code, list (ordered + unordered,
 * nested), blockquote, hr, table, space, html, plus inline bold/italic/
 * codespan/link/strikethrough/text.
 *
 * Styling adapts pi's MarkdownTheme to cortex's smaller `theme` set:
 *   heading           → bold + accent
 *   bold              → bold
 *   italic            → underline (cortex theme has no italic)
 *   strikethrough     → muted, wrapped in tildes for visibility
 *   codeBlockBorder   → muted backticks
 *   codeBlock         → muted (when no highlight available)
 *   highlightCode     → cli-highlight when a known language is set
 *   quote             → muted (cortex doesn't ship italic)
 *   quoteBorder       → muted │
 *   listBullet        → accent
 *   hr                → muted ─
 *   link              → accent label + muted url
 */

import { highlight, supportsLanguage } from "cli-highlight";
import { marked, type Token, type Tokens } from "marked";
import { padToWidth, theme, visibleWidth, wrapText } from "./ansi.js";
import type { Component, Frame, RenderContext } from "./component.js";

const HORIZONTAL_RULE_MAX = 80;

export class Markdown implements Component {
  text: string;

  constructor(text = "") {
    this.text = text;
  }

  render(ctx: RenderContext): Frame {
    if (ctx.width <= 0) {
      return { lines: [] };
    }
    return { lines: renderMarkdown(this.text, ctx.width) };
  }
}

export function renderMarkdown(text: string, width: number): string[] {
  if (width <= 0 || text === "") {
    return [];
  }
  // marked's lexer expects a clean newline-terminated string; tabs render badly.
  const normalized = text.replace(/\t/g, "  ");
  let tokens: Token[];
  try {
    tokens = marked.lexer(normalized);
  } catch {
    // Marked failures should never crash the TUI; fall back to plain text.
    return wrapText(normalized, width).map((line) => padToWidth(line, width));
  }
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next = tokens[i + 1];
    if (token === undefined) continue;
    out.push(...renderBlockToken(token, width, next?.type));
  }
  // Pad each line to width so the renderer caller can stack frames cleanly.
  return out.map((line) => padToWidth(line, width));
}

function renderBlockToken(token: Token, width: number, nextType: string | undefined): string[] {
  switch (token.type) {
    case "heading":
      return renderHeading(token as Tokens.Heading, width, nextType);
    case "paragraph":
      return renderParagraph(token as Tokens.Paragraph, width, nextType);
    case "code":
      return renderCodeBlock(token as Tokens.Code, width, nextType);
    case "list":
      return renderList(token as Tokens.List, 0, width);
    case "blockquote":
      return renderBlockquote(token as Tokens.Blockquote, width, nextType);
    case "hr":
      return renderHorizontalRule(width, nextType);
    case "table":
      return renderTable(token as Tokens.Table, width, nextType);
    case "space":
      return [""];
    case "html": {
      const raw = (token as Tokens.HTML).raw ?? "";
      return wrapText(raw.trim(), width);
    }
    default: {
      const text = (token as { text?: string }).text;
      return text === undefined ? [] : wrapText(text, width);
    }
  }
}

function renderHeading(
  token: Tokens.Heading,
  width: number,
  nextType: string | undefined,
): string[] {
  const inline = renderInline(token.tokens ?? []);
  const styled =
    token.depth === 1
      ? theme.bold(theme.accent(theme.underline(inline)))
      : token.depth === 2
        ? theme.bold(theme.accent(inline))
        : token.depth === 3
          ? theme.bold(inline)
          : theme.muted(theme.bold(inline));
  const lines = wrapText(styled, width);
  if (nextType !== undefined && nextType !== "space") {
    lines.push("");
  }
  return lines;
}

function renderParagraph(
  token: Tokens.Paragraph,
  width: number,
  nextType: string | undefined,
): string[] {
  const inline = renderInline(token.tokens ?? []);
  const lines = wrapText(inline, width);
  if (nextType !== undefined && nextType !== "list" && nextType !== "space") {
    lines.push("");
  }
  return lines;
}

function renderCodeBlock(
  token: Tokens.Code,
  width: number,
  nextType: string | undefined,
): string[] {
  const lang = token.lang ?? "";
  const out: string[] = [];
  out.push(theme.muted(`\`\`\`${lang}`));
  const indent = "  ";
  if (lang !== "" && supportsLanguage(lang)) {
    let highlighted: string;
    try {
      highlighted = highlight(token.text, { language: lang, ignoreIllegals: true });
    } catch {
      highlighted = theme.muted(token.text);
    }
    for (const line of highlighted.split("\n")) {
      out.push(`${indent}${line}`);
    }
  } else {
    for (const line of token.text.split("\n")) {
      out.push(`${indent}${theme.muted(line)}`);
    }
  }
  out.push(theme.muted("```"));
  if (nextType !== undefined && nextType !== "space") {
    out.push("");
  }
  return out;
}

function renderList(token: Tokens.List, depth: number, width: number): string[] {
  const indent = "  ".repeat(depth);
  const out: string[] = [];
  let counter = 1;
  const start = token.start === undefined || token.start === "" ? 1 : Number(token.start);
  if (Number.isFinite(start)) counter = start;

  for (const item of token.items as Tokens.ListItem[]) {
    const bullet = token.ordered ? `${counter}.` : "-";
    const styledBullet = theme.accent(bullet);
    const prefix = `${indent}${styledBullet} `;
    const prefixWidth = visibleWidth(prefix);
    const innerWidth = Math.max(1, width - prefixWidth);

    const itemLines: string[] = [];
    let firstBlock = true;
    const childTokens = (item.tokens ?? []) as Token[];
    for (let i = 0; i < childTokens.length; i += 1) {
      const child = childTokens[i];
      if (child === undefined) continue;
      if (child.type === "list") {
        itemLines.push(...renderList(child as Tokens.List, depth + 1, width));
        firstBlock = false;
        continue;
      }
      if (child.type === "text") {
        const textBlock = (child as Tokens.Text).tokens ?? [];
        const inline = textBlock.length > 0 ? renderInline(textBlock) : (child as Tokens.Text).text;
        for (const wrapped of wrapText(inline, innerWidth)) {
          itemLines.push(wrapped);
        }
        firstBlock = false;
        continue;
      }
      // Generic fallback: render the block at innerWidth and merge.
      const subLines = renderBlockToken(child, innerWidth, childTokens[i + 1]?.type);
      // Strip a trailing blank that block renderers add to keep the list tight.
      while (subLines.length > 0 && subLines[subLines.length - 1] === "") {
        subLines.pop();
      }
      if (!firstBlock) {
        itemLines.push("");
      }
      itemLines.push(...subLines);
      firstBlock = false;
    }

    for (let i = 0; i < itemLines.length; i += 1) {
      const lead = i === 0 ? prefix : " ".repeat(prefixWidth);
      out.push(`${lead}${itemLines[i] ?? ""}`);
    }

    counter += 1;
  }
  return out;
}

function renderBlockquote(
  token: Tokens.Blockquote,
  width: number,
  nextType: string | undefined,
): string[] {
  const innerWidth = Math.max(1, width - 2);
  const inner: string[] = [];
  const children = (token.tokens ?? []) as Token[];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child === undefined) continue;
    inner.push(...renderBlockToken(child, innerWidth, children[i + 1]?.type));
  }
  while (inner.length > 0 && inner[inner.length - 1] === "") {
    inner.pop();
  }
  const out: string[] = [];
  for (const line of inner) {
    out.push(`${theme.muted("│ ")}${theme.muted(line)}`);
  }
  if (nextType !== undefined && nextType !== "space") {
    out.push("");
  }
  return out;
}

function renderHorizontalRule(width: number, nextType: string | undefined): string[] {
  const lines = [theme.muted("─".repeat(Math.min(width, HORIZONTAL_RULE_MAX)))];
  if (nextType !== undefined && nextType !== "space") {
    lines.push("");
  }
  return lines;
}

function renderTable(
  token: Tokens.Table,
  width: number,
  nextType: string | undefined,
): string[] {
  const header = (token.header ?? []) as Tokens.TableCell[];
  const rows = (token.rows ?? []) as Tokens.TableCell[][];
  const numCols = header.length;
  if (numCols === 0) return [];

  // Border overhead: "│ " + (n-1)*" │ " + " │" = 3n + 1
  const overhead = 3 * numCols + 1;
  const availableForCells = width - overhead;
  if (availableForCells < numCols) {
    // Too narrow — render the raw markdown as plain text.
    const raw = token.raw ?? "";
    return wrapText(raw, width);
  }

  const headerInline = header.map((cell) => renderInline(cell.tokens ?? []));
  const rowInline = rows.map((row) => row.map((cell) => renderInline(cell.tokens ?? [])));

  const naturalWidths = headerInline.map((cell, i) => {
    let max = visibleWidth(cell);
    for (const row of rowInline) {
      max = Math.max(max, visibleWidth(row[i] ?? ""));
    }
    return max;
  });
  const totalNatural = naturalWidths.reduce((a, b) => a + b, 0) + overhead;
  const colWidths =
    totalNatural <= width
      ? naturalWidths
      : distributeColumns(naturalWidths, availableForCells);

  const out: string[] = [];
  out.push(`┌─${colWidths.map((w) => "─".repeat(w)).join("─┬─")}─┐`);
  out.push(formatTableRow(headerInline, colWidths, true));
  out.push(`├─${colWidths.map((w) => "─".repeat(w)).join("─┼─")}─┤`);
  for (const row of rowInline) {
    out.push(formatTableRow(row, colWidths, false));
  }
  out.push(`└─${colWidths.map((w) => "─".repeat(w)).join("─┴─")}─┘`);
  if (nextType !== undefined && nextType !== "space") {
    out.push("");
  }
  return out;
}

function distributeColumns(naturals: number[], availableForCells: number): number[] {
  const total = naturals.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return naturals.map(() => Math.max(1, Math.floor(availableForCells / naturals.length)));
  }
  const widths = naturals.map((n) => Math.max(1, Math.floor((n / total) * availableForCells)));
  // Distribute leftover space.
  let remaining = availableForCells - widths.reduce((a, b) => a + b, 0);
  for (let i = 0; remaining > 0 && i < widths.length; i += 1) {
    widths[i] = (widths[i] ?? 1) + 1;
    remaining -= 1;
  }
  return widths;
}

function formatTableRow(cells: string[], widths: number[], isHeader: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < widths.length; i += 1) {
    const colWidth = widths[i] ?? 1;
    const cell = cells[i] ?? "";
    const styled = isHeader ? theme.bold(cell) : cell;
    parts.push(padCell(styled, colWidth));
  }
  return `│ ${parts.join(" │ ")} │`;
}

function padCell(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w >= width) {
    return sliceVisible(text, width);
  }
  return text + " ".repeat(width - w);
}

// Truncates an ANSI-styled string to a visible-width budget. We only use this
// when a cell overflows; in that case we keep it simple — slice through and
// let any unclosed style get reset on the next row (`│` is plain).
function sliceVisible(text: string, width: number): string {
  let out = "";
  let acc = 0;
  for (const segment of splitAnsi(text)) {
    if (segment.kind === "ansi") {
      out += segment.value;
      continue;
    }
    for (const ch of segment.value) {
      if (acc + 1 > width) {
        return out;
      }
      out += ch;
      acc += 1;
    }
  }
  return out;
}

function* splitAnsi(text: string): Generator<{ kind: "text" | "ansi"; value: string }> {
  const re = /\x1b\[[0-9;?]*[A-Za-z]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      yield { kind: "text", value: text.slice(lastIndex, match.index) };
    }
    yield { kind: "ansi", value: match[0] };
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) {
    yield { kind: "text", value: text.slice(lastIndex) };
  }
}

function renderInline(tokens: Token[]): string {
  let out = "";
  for (const token of tokens) {
    if (token === undefined) continue;
    switch (token.type) {
      case "text":
        out += renderInline((token as Tokens.Text).tokens ?? []) || (token as Tokens.Text).text;
        break;
      case "strong":
        out += theme.bold(renderInline((token as Tokens.Strong).tokens ?? []));
        break;
      case "em":
        out += theme.underline(renderInline((token as Tokens.Em).tokens ?? []));
        break;
      case "del":
        out += theme.muted(`~~${renderInline((token as Tokens.Del).tokens ?? [])}~~`);
        break;
      case "codespan":
        out += theme.bold(theme.muted(`\`${(token as Tokens.Codespan).text}\``));
        break;
      case "link": {
        const link = token as Tokens.Link;
        const label = renderInline(link.tokens ?? []) || link.text || link.href;
        out += `${theme.accent(label)} ${theme.muted(`(${link.href})`)}`;
        break;
      }
      case "image": {
        const image = token as Tokens.Image;
        out += `${theme.accent(`[${image.text}]`)} ${theme.muted(`(${image.href})`)}`;
        break;
      }
      case "br":
        out += "\n";
        break;
      case "html":
        out += (token as Tokens.HTML).raw ?? "";
        break;
      case "escape":
        out += (token as Tokens.Escape).text;
        break;
      default: {
        const text = (token as { text?: string }).text;
        if (text !== undefined) out += text;
      }
    }
  }
  return out;
}
