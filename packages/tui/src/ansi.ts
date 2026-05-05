const ESC = "\x1b";
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]/g;

export const CSI = `${ESC}[`;
export const CLEAR_SCREEN = `${CSI}2J${CSI}H`;
export const CLEAR_LINE = `${CSI}2K`;
export const HIDE_CURSOR = `${CSI}?25l`;
export const SHOW_CURSOR = `${CSI}?25h`;
export const BRACKETED_PASTE_ON = `${CSI}?2004h`;
export const BRACKETED_PASTE_OFF = `${CSI}?2004l`;
export const SYNC_BEGIN = `${CSI}?2026h`;
export const SYNC_END = `${CSI}?2026l`;

export function moveCursor(row: number, col: number): string {
  return `${CSI}${row + 1};${col + 1}H`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function visibleWidth(text: string): number {
  const stripped = stripAnsi(text);
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0) {
      continue;
    }
    if (isCombining(code)) {
      continue;
    }
    if (isWide(code)) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

export function truncateToWidth(text: string, width: number, ellipsis = "…"): string {
  if (visibleWidth(text) <= width) {
    return text;
  }
  if (width <= 0) {
    return "";
  }
  const targetWidth = Math.max(0, width - visibleWidth(ellipsis));
  return `${sliceByWidth(text, targetWidth)}${ellipsis}`;
}

export function sliceByWidth(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  let result = "";
  let acc = 0;
  for (const segment of splitAnsi(text)) {
    if (segment.kind === "ansi") {
      result += segment.value;
      continue;
    }
    for (const char of segment.value) {
      const code = char.codePointAt(0) ?? 0;
      if (isCombining(code)) {
        result += char;
        continue;
      }
      const w = isWide(code) ? 2 : 1;
      if (acc + w > width) {
        return result;
      }
      result += char;
      acc += w;
      if (acc === width) {
        return result;
      }
    }
  }
  return result;
}

export function padToWidth(text: string, width: number): string {
  const current = visibleWidth(text);
  if (current >= width) {
    return text;
  }
  return text + " ".repeat(width - current);
}

export function wrapText(text: string, width: number): string[] {
  if (width <= 0) {
    return text === "" ? [""] : [text];
  }
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let remaining = paragraph;
    while (visibleWidth(remaining) > width) {
      const head = sliceByWidth(remaining, width);
      lines.push(head);
      remaining = remaining.slice(head.length);
    }
    lines.push(remaining);
  }
  return lines;
}

interface Segment {
  kind: "text" | "ansi";
  value: string;
}

function* splitAnsi(text: string): Generator<Segment> {
  let lastIndex = 0;
  ANSI_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      yield { kind: "text", value: text.slice(lastIndex, match.index) };
    }
    yield { kind: "ansi", value: match[0] };
    lastIndex = ANSI_PATTERN.lastIndex;
  }
  if (lastIndex < text.length) {
    yield { kind: "text", value: text.slice(lastIndex) };
  }
}

function isCombining(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  );
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}

export const theme = {
  reset: (text: string): string => `${text}${CSI}0m`,
  accent: (text: string): string => `${CSI}38;5;75m${text}${CSI}39m`,
  muted: (text: string): string => `${CSI}38;5;244m${text}${CSI}39m`,
  error: (text: string): string => `${CSI}38;5;203m${text}${CSI}39m`,
  warning: (text: string): string => `${CSI}38;5;214m${text}${CSI}39m`,
  success: (text: string): string => `${CSI}38;5;114m${text}${CSI}39m`,
  dim: (text: string): string => `${CSI}2m${text}${CSI}22m`,
  bold: (text: string): string => `${CSI}1m${text}${CSI}22m`,
  inverse: (text: string): string => `${CSI}7m${text}${CSI}27m`,
  underline: (text: string): string => `${CSI}4m${text}${CSI}24m`,
  // Pi-style user-message background. Approximates pi's `#343541` in the
  // 256-color palette (color 237 ≈ #3a3a3a).
  userBg: (text: string): string => `${CSI}48;5;237m${text}${CSI}49m`,
};
