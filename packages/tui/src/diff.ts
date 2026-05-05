/**
 * Renders unified-diff-formatted strings (lines starting with `+`, `-`, ` `,
 * or `@`) with terminal colors. Adapted from pi-mono's diff.ts but kept slim:
 * we don't try to do syntax highlighting inside diff lines.
 */

import { padToWidth, theme, visibleWidth, wrapText } from "./ansi.js";

export function renderUnifiedDiff(diff: string, width: number): string[] {
  if (diff === "" || width <= 0) {
    return [];
  }
  const out: string[] = [];
  for (const raw of diff.split("\n")) {
    if (raw === "") {
      out.push(padToWidth("", width));
      continue;
    }
    const styled = styleDiffLine(raw);
    for (const wrapped of wrapText(styled, width)) {
      out.push(padToWidth(wrapped, width));
    }
  }
  return out;
}

function styleDiffLine(line: string): string {
  const first = line.charAt(0);
  if (first === "+") return theme.success(line);
  if (first === "-") return theme.error(line);
  if (first === "@") return theme.accent(line);
  return theme.muted(line);
}

/**
 * Builds a unified diff hunk for an exact-text replacement. Used by fs.edit
 * (and any other tool that knows the precise replacement region) to produce
 * a transcript-friendly diff without running a generic diff algorithm.
 */
export interface BuildEditDiffOptions {
  before: string;
  oldText: string;
  newText: string;
  /** Number of context lines to show on each side (default 3). */
  context?: number;
  /** Maximum hunk lines emitted; truncated with "@@ truncated @@" if exceeded. */
  maxLines?: number;
  /** Path label for the diff header. */
  path?: string;
}

export function buildEditDiff(options: BuildEditDiffOptions): string {
  const contextLines = options.context ?? 3;
  const maxLines = options.maxLines ?? 200;
  const idx = options.before.indexOf(options.oldText);
  if (idx === -1) {
    return "";
  }
  const beforePrefix = options.before.slice(0, idx);
  const beforeSuffix = options.before.slice(idx + options.oldText.length);

  const prefixLines = beforePrefix === "" ? [] : beforePrefix.split("\n");
  const suffixLines = beforeSuffix === "" ? [] : beforeSuffix.split("\n");
  const oldTextLines = options.oldText.split("\n");
  const newTextLines = options.newText.split("\n");

  // Trim prefix/suffix to the requested context.
  const contextBefore = prefixLines.slice(Math.max(0, prefixLines.length - contextLines));
  const contextAfter = suffixLines.slice(0, contextLines);

  // Compute hunk header line numbers (1-indexed).
  const startLine = Math.max(1, prefixLines.length - contextBefore.length + 1);

  const out: string[] = [];
  if (options.path !== undefined) {
    out.push(`--- a/${options.path}`);
    out.push(`+++ b/${options.path}`);
  }
  const oldHunkLength = contextBefore.length + oldTextLines.length + contextAfter.length;
  const newHunkLength = contextBefore.length + newTextLines.length + contextAfter.length;
  out.push(`@@ -${startLine},${oldHunkLength} +${startLine},${newHunkLength} @@`);
  for (const line of contextBefore) out.push(` ${line}`);
  for (const line of oldTextLines) out.push(`-${line}`);
  for (const line of newTextLines) out.push(`+${line}`);
  for (const line of contextAfter) out.push(` ${line}`);

  if (out.length > maxLines) {
    const head = out.slice(0, maxLines);
    head.push("@@ truncated @@");
    return head.join("\n");
  }
  return out.join("\n");
}

/** Returns true if `text` looks like a unified diff. Used for opportunistic
 * detection in transcript rendering. */
export function isUnifiedDiff(text: string): boolean {
  if (text === "") return false;
  // A unified diff has at least one hunk header.
  return /^@@\s.*@@/m.test(text);
}

// Re-export so transcript.ts can compute display widths without re-importing
// from ansi.ts directly.
export { padToWidth, visibleWidth };
