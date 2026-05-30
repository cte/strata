import type { AgentAttachment } from "@strata/agent";
import type { ToolExecutionResult } from "@strata/tools";
import { padToWidth, theme, truncateToWidth, visibleWidth, wrapText } from "../ansi.js";
import type { Component, Frame, RenderContext } from "../component.js";
import { Markdown } from "../components.js";
import { renderUnifiedDiff } from "../diff.js";
import {
  getCapabilities,
  getImageDimensions,
  imageFallback,
  renderImage,
} from "../terminalImage.js";
import type { TranscriptItem } from "./state.js";

export class Transcript implements Component {
  items: TranscriptItem[];

  constructor(items: TranscriptItem[]) {
    this.items = items;
  }

  render(ctx: RenderContext): Frame {
    if (this.items.length === 0) {
      const hint = padToWidth(theme.muted("Type a question or /help to begin."), ctx.width);
      return { lines: [hint] };
    }
    const lines: string[] = [];
    for (const item of this.items) {
      lines.push(...renderItem(item, ctx.width));
      lines.push(padToWidth("", ctx.width));
    }
    if (lines.length > 0 && lines[lines.length - 1] !== undefined) {
      lines.pop();
    }
    return { lines };
  }
}

function renderItem(item: TranscriptItem, width: number): string[] {
  switch (item.kind) {
    case "user":
      return renderUserMessage(item.content, width);
    case "assistant":
      return renderAssistantMessage(item.content, width);
    case "reasoning":
      return renderReasoningMessage(item.content, width, item.streaming === true);
    case "tool":
      return renderToolItem(item, width);
    case "status":
      return wrapPrefixedText(`· ${item.content}`, width).map((line) =>
        padToWidth(theme.muted(line), width),
      );
    case "error":
      return wrapPrefixedText(`! ${item.content}`, width).map((line) =>
        padToWidth(theme.error(line), width),
      );
    case "image":
      return renderImageItem(item.attachment, width);
    case "header":
    case "notice":
      // Already-styled lines; render verbatim with a single leading space
      // (pi-style indent) and pad to the viewport width.
      return item.lines.map((line) => padToWidth(` ${line}`, width));
  }
}

// Pi renders user messages with a subtle background-color box and no "you"
// label. The label-free style keeps the chat compact; the background gives
// just enough contrast to find your turns when scrolling. We mirror pi's
// box: 1 cell horizontal padding + 1 line of vertical padding above and below.
function renderUserMessage(content: string, width: number): string[] {
  const innerWidth = Math.max(1, width - 2);
  const wrapped = wrapText(content, innerWidth);
  const out: string[] = [];
  // Top padding row
  out.push(theme.userBg(padToWidth("", width)));
  for (const line of wrapped) {
    const body = ` ${line}${" ".repeat(Math.max(0, innerWidth - visibleWidth(line)))} `;
    out.push(theme.userBg(body));
  }
  // Bottom padding row
  out.push(theme.userBg(padToWidth("", width)));
  return out;
}

// Pi renders assistant messages with no label and 1 cell of horizontal
// padding around the markdown body. We do the same — the visual contrast
// against the user-bg box is enough to tell the two apart.
function renderAssistantMessage(content: string, width: number): string[] {
  if (content.trim() === "") return [];
  const innerWidth = Math.max(1, width - 2);
  const inner = new Markdown(content).render({ width: innerWidth, height: 0 }).lines;
  return inner.map((line) => padToWidth(` ${line}`, width));
}

// Reasoning/thinking trace: muted, indented, with a small marker header so it
// reads as secondary context distinct from the visible answer.
function renderReasoningMessage(content: string, width: number, streaming: boolean): string[] {
  if (content.trim() === "") return [];
  const innerWidth = Math.max(1, width - 4);
  const wrapped = wrapText(content.trim(), innerWidth);
  const out: string[] = [];
  out.push(padToWidth(theme.muted(streaming ? "✻ thinking…" : "✻ thought"), width));
  for (const line of wrapped) {
    out.push(padToWidth(theme.muted(`  ${line}`), width));
  }
  return out;
}

function renderImageItem(attachment: AgentAttachment, width: number): string[] {
  if (attachment.kind !== "image") {
    return [];
  }
  const dims = getImageDimensions(attachment.dataBase64, attachment.mimeType);
  const caps = getCapabilities();
  // Width budget: cap at 60 cells so images don't dominate the transcript.
  const targetCells = Math.min(width, 60);
  if (caps.images === null || dims === null) {
    const fallback = imageFallback(attachment.mimeType, dims, attachment.name);
    return [padToWidth(theme.muted(fallback), width)];
  }
  const rendered = renderImage(attachment.dataBase64, dims, {
    maxWidthCells: targetCells,
  });
  if (rendered === null) {
    const fallback = imageFallback(attachment.mimeType, dims, attachment.name);
    return [padToWidth(theme.muted(fallback), width)];
  }
  // Emit the escape sequence on the first line, followed by `rows-1` blank
  // lines that the image draws over. The runtime treats any line containing
  // the kitty/iterm2 prefix as an "image line" and skips diffing it.
  const lines: string[] = [rendered.sequence];
  for (let i = 1; i < rendered.rows; i += 1) {
    lines.push(padToWidth("", width));
  }
  return lines;
}

function wrapPrefixedText(content: string, width: number): string[] {
  return wrapText(content, width).map((line) => truncateToWidth(line, width));
}

// Pi-style tool rendering:
//   <bold-accent>name</bold-accent> <muted>compact-args</muted>
//     indented preview of the result, max 10 lines
//     ... (N more lines)
// Errors render as a single muted-red line under the header. No ⚙ / ✓ icons,
// no "args:" or "→" prefix labels — pi's renderer skips them, and the visual
// effect is much cleaner.
const PREVIEW_LINE_LIMIT = 10;

function renderToolItem(item: Extract<TranscriptItem, { kind: "tool" }>, width: number): string[] {
  const out: string[] = [];
  const header = formatToolHeader(item);
  out.push(padToWidth(truncateToWidth(header, width), width));
  if (item.result === undefined) {
    // Don't render anything until the tool resolves; the StatusLine spinner
    // already conveys that work is in progress.
    return out;
  }
  out.push(...formatResultBody(item.result, width));
  return out;
}

function formatToolHeader(item: Extract<TranscriptItem, { kind: "tool" }>): string {
  const name = theme.bold(theme.accent(item.toolName));
  const args = formatCompactArgs(item.argumentsText);
  return args === "" ? name : `${name} ${theme.muted(args)}`;
}

function formatCompactArgs(argumentsText: string): string {
  if (argumentsText === "" || argumentsText === "{}") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return argumentsText;
  }
  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  // Single-string-arg shortcut: `read foo.ts` instead of `read path=foo.ts`.
  if (keys.length === 1) {
    const value = obj[keys[0] ?? ""];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  // Multi-arg: `path=foo limit=10`. Skip empty / default values to keep the
  // header clean.
  const parts: string[] = [];
  for (const key of keys) {
    const value = obj[key];
    if (value === "" || value === false || value === null || value === undefined) continue;
    parts.push(`${key}=${compactValue(value)}`);
  }
  return parts.join(" ");
}

function compactValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatResultBody(result: ToolExecutionResult, width: number): string[] {
  if (!result.ok) {
    const body = `✗ ${result.error.code}: ${result.error.message}`;
    return wrapText(body, Math.max(1, width - 2)).map((line) =>
      padToWidth(`  ${theme.error(line)}`, width),
    );
  }

  const out: string[] = [];
  const diff = extractDiff(result.result);
  const previewText = formatResultPreview(result.result);
  if (previewText !== "") {
    const innerWidth = Math.max(1, width - 2);
    const wrapped = wrapText(previewText, innerWidth);
    const display = wrapped.slice(0, PREVIEW_LINE_LIMIT);
    for (const line of display) {
      out.push(padToWidth(`  ${theme.muted(line)}`, width));
    }
    const remaining = wrapped.length - display.length;
    if (remaining > 0) {
      out.push(padToWidth(`  ${theme.muted(`... (${remaining} more lines)`)}`, width));
    }
  }
  if (diff !== undefined && diff !== "") {
    const innerWidth = Math.max(1, width - 2);
    for (const line of renderUnifiedDiff(diff, innerWidth)) {
      out.push(padToWidth(`  ${line}`, width));
    }
  }
  if (result.truncated && previewText === "" && (diff === undefined || diff === "")) {
    out.push(padToWidth(`  ${theme.muted("(result truncated)")}`, width));
  }
  return out;
}

function extractDiff(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as { diff?: unknown }).diff;
  return typeof candidate === "string" && candidate !== "" ? candidate : undefined;
}

// Render a textual preview tailored to common strata tool result shapes.
// Falls back to pretty-printed JSON for anything we don't recognize.
function formatResultPreview(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map((entry) => compactValue(entry)).join("\n");

  const obj = value as Record<string, unknown>;
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.entries)) {
    return obj.entries
      .map((entry) => {
        if (entry === null || typeof entry !== "object") return compactValue(entry);
        const e = entry as Record<string, unknown>;
        if (typeof e.path === "string") {
          const t = typeof e.type === "string" ? ` [${e.type}]` : "";
          return `${e.path}${t}`;
        }
        return JSON.stringify(e);
      })
      .join("\n");
  }
  if (Array.isArray(obj.matches)) {
    return obj.matches.map(formatMatch).join("\n");
  }
  if (Array.isArray(obj.results)) {
    return obj.results.map(formatMatch).join("\n");
  }

  // Generic object: pretty-print, but strip out the `diff` field (already
  // rendered separately) and any noisy hash/byte metadata that doesn't help
  // the reader.
  const filtered: Record<string, unknown> = { ...obj };
  delete filtered.diff;
  return JSON.stringify(filtered, null, 2);
}

function formatMatch(match: unknown): string {
  if (typeof match === "string") return match;
  if (match === null || typeof match !== "object") return JSON.stringify(match);
  const m = match as Record<string, unknown>;
  if (typeof m.path === "string") {
    const line = typeof m.line === "number" ? `:${m.line}` : "";
    const text = typeof m.text === "string" ? `: ${m.text}` : "";
    return `${m.path}${line}${text}`;
  }
  return JSON.stringify(m);
}
