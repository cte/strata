const ESC = "\x1b";
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const TERMINAL_CONTROL_PATTERN =
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g;
const C0_CONTROL_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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
  return text.replace(TERMINAL_CONTROL_PATTERN, "");
}

export function sanitizeTerminalText(text: string): string {
  return text.replace(TERMINAL_CONTROL_PATTERN, "").replace(C0_CONTROL_PATTERN, "");
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
  if (text === "") {
    return [""];
  }

  const out: string[] = [];
  const tracker = new AnsiCodeTracker();
  for (const line of text.split("\n")) {
    const prefix = out.length > 0 ? tracker.getActiveCodes() : "";
    out.push(...wrapSingleLine(`${prefix}${line}`, width));
    updateTrackerFromText(line, tracker);
  }
  return out.length > 0 ? out : [""];
}

function wrapSingleLine(line: string, width: number): string[] {
  if (line === "") {
    return [""];
  }
  if (visibleWidth(line) <= width) {
    return [line];
  }

  const wrapped: string[] = [];
  const tracker = new AnsiCodeTracker();
  const tokens = splitIntoTokensWithAnsi(line);
  let currentLine = "";
  let currentVisibleWidth = 0;

  for (const token of tokens) {
    const tokenWidth = visibleWidth(token);
    const isWhitespace = stripAnsi(token).trim() === "";

    if (tokenWidth > width && !isWhitespace) {
      if (visibleWidth(currentLine.trimEnd()) > 0) {
        const lineEndReset = tracker.getLineEndReset();
        wrapped.push(`${currentLine.trimEnd()}${lineEndReset}`);
      }
      currentLine = "";
      currentVisibleWidth = 0;

      const broken = breakLongWord(token, width, tracker);
      wrapped.push(...broken.slice(0, -1));
      currentLine = broken[broken.length - 1] ?? "";
      currentVisibleWidth = visibleWidth(currentLine);
      continue;
    }

    if (currentVisibleWidth > 0 && currentVisibleWidth + tokenWidth > width) {
      const lineEndReset = tracker.getLineEndReset();
      wrapped.push(`${currentLine.trimEnd()}${lineEndReset}`);
      if (isWhitespace) {
        currentLine = tracker.getActiveCodes();
        currentVisibleWidth = 0;
      } else {
        currentLine = `${tracker.getActiveCodes()}${token}`;
        currentVisibleWidth = tokenWidth;
      }
    } else {
      currentLine += token;
      currentVisibleWidth += tokenWidth;
    }

    updateTrackerFromText(token, tracker);
  }

  const finalLine = currentLine.trimEnd();
  if (visibleWidth(finalLine) > 0) {
    wrapped.push(finalLine);
  }
  return wrapped.length > 0 ? wrapped : [""];
}

function splitIntoTokensWithAnsi(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let pendingAnsi = "";
  let inWhitespace = false;
  let i = 0;

  while (i < text.length) {
    const ansi = extractAnsiCode(text, i);
    if (ansi !== null) {
      pendingAnsi += ansi.code;
      i += ansi.length;
      continue;
    }

    const char = text[i] ?? "";
    const charIsWhitespace = char === " " || char === "\t";
    if (current !== "" && charIsWhitespace !== inWhitespace) {
      tokens.push(current);
      current = "";
    }
    if (pendingAnsi !== "") {
      current += pendingAnsi;
      pendingAnsi = "";
    }
    inWhitespace = charIsWhitespace;
    current += char;
    i += 1;
  }

  if (pendingAnsi !== "") {
    current += pendingAnsi;
  }
  if (current !== "") {
    tokens.push(current);
  }
  return tokens;
}

function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
  const lines: string[] = [];
  let currentLine = tracker.getActiveCodes();
  let currentWidth = 0;
  let i = 0;

  while (i < word.length) {
    const ansi = extractAnsiCode(word, i);
    if (ansi !== null) {
      currentLine += ansi.code;
      tracker.process(ansi.code);
      i += ansi.length;
      continue;
    }

    let end = i;
    while (end < word.length && extractAnsiCode(word, end) === null) {
      end += 1;
    }

    for (const { segment } of segmenter.segment(word.slice(i, end))) {
      const segmentWidth = visibleWidth(segment);
      if (currentWidth > 0 && currentWidth + segmentWidth > width) {
        const lineEndReset = tracker.getLineEndReset();
        lines.push(`${currentLine}${lineEndReset}`);
        currentLine = tracker.getActiveCodes();
        currentWidth = 0;
      }
      currentLine += segment;
      currentWidth += segmentWidth;
    }
    i = end;
  }

  if (currentLine !== "") {
    lines.push(currentLine);
  }
  return lines.length > 0 ? lines : [""];
}

function updateTrackerFromText(text: string, tracker: AnsiCodeTracker): void {
  let i = 0;
  while (i < text.length) {
    const ansi = extractAnsiCode(text, i);
    if (ansi === null) {
      i += 1;
      continue;
    }
    tracker.process(ansi.code);
    i += ansi.length;
  }
}

function extractAnsiCode(text: string, position: number): { code: string; length: number } | null {
  if (position >= text.length || text[position] !== ESC) {
    return null;
  }

  const next = text[position + 1];
  if (next === "[") {
    let end = position + 2;
    while (end < text.length && !/[@-~]/.test(text[end] ?? "")) {
      end += 1;
    }
    if (end < text.length) {
      return { code: text.slice(position, end + 1), length: end + 1 - position };
    }
    return null;
  }

  if (next === "]") {
    let end = position + 2;
    while (end < text.length) {
      if (text[end] === "\x07") {
        return { code: text.slice(position, end + 1), length: end + 1 - position };
      }
      if (text[end] === ESC && text[end + 1] === "\\") {
        return { code: text.slice(position, end + 2), length: end + 2 - position };
      }
      end += 1;
    }
    return null;
  }

  if (next === "_" || next === "P" || next === "X" || next === "^") {
    let end = position + 2;
    while (end < text.length) {
      if (text[end] === ESC && text[end + 1] === "\\") {
        return { code: text.slice(position, end + 2), length: end + 2 - position };
      }
      end += 1;
    }
    return null;
  }

  if (next !== undefined && /[@-Z\\-_]/.test(next)) {
    return { code: text.slice(position, position + 2), length: 2 };
  }

  return null;
}

class AnsiCodeTracker {
  private bold = false;
  private dim = false;
  private italic = false;
  private underline = false;
  private inverse = false;
  private strikethrough = false;
  private foreground: string | null = null;
  private background: string | null = null;

  process(ansiCode: string): void {
    if (!ansiCode.startsWith(`${ESC}[`) || !ansiCode.endsWith("m")) {
      return;
    }

    const body = ansiCode.slice(2, -1);
    if (body === "" || body === "0") {
      this.reset();
      return;
    }

    const parts = body.split(";");
    let i = 0;
    while (i < parts.length) {
      const code = Number.parseInt(parts[i] ?? "", 10);
      if (!Number.isFinite(code)) {
        i += 1;
        continue;
      }

      if ((code === 38 || code === 48) && parts[i + 1] === "5" && parts[i + 2] !== undefined) {
        const value = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
        if (code === 38) {
          this.foreground = value;
        } else {
          this.background = value;
        }
        i += 3;
        continue;
      }

      if (
        (code === 38 || code === 48) &&
        parts[i + 1] === "2" &&
        parts[i + 2] !== undefined &&
        parts[i + 3] !== undefined &&
        parts[i + 4] !== undefined
      ) {
        const value = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
        if (code === 38) {
          this.foreground = value;
        } else {
          this.background = value;
        }
        i += 5;
        continue;
      }

      switch (code) {
        case 0:
          this.reset();
          break;
        case 1:
          this.bold = true;
          break;
        case 2:
          this.dim = true;
          break;
        case 3:
          this.italic = true;
          break;
        case 4:
          this.underline = true;
          break;
        case 7:
          this.inverse = true;
          break;
        case 9:
          this.strikethrough = true;
          break;
        case 22:
          this.bold = false;
          this.dim = false;
          break;
        case 23:
          this.italic = false;
          break;
        case 24:
          this.underline = false;
          break;
        case 27:
          this.inverse = false;
          break;
        case 29:
          this.strikethrough = false;
          break;
        case 39:
          this.foreground = null;
          break;
        case 49:
          this.background = null;
          break;
        default:
          if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
            this.foreground = String(code);
          } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
            this.background = String(code);
          }
      }
      i += 1;
    }
  }

  getActiveCodes(): string {
    const codes: string[] = [];
    if (this.bold) codes.push("1");
    if (this.dim) codes.push("2");
    if (this.italic) codes.push("3");
    if (this.underline) codes.push("4");
    if (this.inverse) codes.push("7");
    if (this.strikethrough) codes.push("9");
    if (this.foreground !== null) codes.push(this.foreground);
    if (this.background !== null) codes.push(this.background);
    return codes.length === 0 ? "" : `${ESC}[${codes.join(";")}m`;
  }

  getLineEndReset(): string {
    return this.underline ? `${ESC}[24m` : "";
  }

  private reset(): void {
    this.bold = false;
    this.dim = false;
    this.italic = false;
    this.underline = false;
    this.inverse = false;
    this.strikethrough = false;
    this.foreground = null;
    this.background = null;
  }
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
