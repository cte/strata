import type { TerminalScreen } from "./screen.js";

export interface TerminalVtParser {
  write(data: string, screen: TerminalScreen): void;
  reset(screen: TerminalScreen): void;
}

const PRINTABLE_CONTROL = new Set(["\n", "\r", "\b", "\t"]);

export class HandwrittenVtParser implements TerminalVtParser {
  write(data: string, screen: TerminalScreen): void {
    for (let index = 0; index < data.length; ) {
      const char = data[index] ?? "";
      if (char === "\x1b") {
        index = this.consumeEscape(data, index, screen);
        index += 1;
        continue;
      }
      const printable = readPrintableCluster(data, index);
      this.putChar(screen, printable.text);
      index = printable.nextIndex;
    }
  }

  reset(screen: TerminalScreen): void {
    screen.reset();
  }

  private putChar(screen: TerminalScreen, char: string): void {
    if (char === "\r") {
      screen.carriageReturn();
      return;
    }
    if (char === "\n") {
      screen.lineFeed();
      return;
    }
    if (char === "\b" || char === "\x7f") {
      screen.backspace();
      return;
    }
    if (char === "\t") {
      screen.tab();
      return;
    }
    if (char < " " && !PRINTABLE_CONTROL.has(char)) return;
    screen.putChar(char);
  }

  private consumeEscape(data: string, start: number, screen: TerminalScreen): number {
    const next = data[start + 1];
    if (next === undefined) return start;
    if (next === "[") return this.consumeCsi(data, start + 2, screen);
    if (next === "]") return this.consumeOsc(data, start + 2, screen);
    if (next === "c") {
      screen.reset();
      return start + 1;
    }
    return start + 1;
  }

  private consumeCsi(data: string, index: number, screen: TerminalScreen): number {
    let cursor = index;
    while (cursor < data.length) {
      const code = data.charCodeAt(cursor);
      if (code >= 0x40 && code <= 0x7e) break;
      cursor += 1;
    }

    const final = data[cursor] ?? "";
    const rawParams = data.slice(index, cursor);
    const privateMode = rawParams.startsWith("?");
    const params = privateMode ? rawParams.slice(1) : rawParams;
    const numbers = parseNumericParams(params);
    const first = positiveParam(numbers[0], 1);

    switch (final) {
      case "A":
        screen.moveCursor(0, -first);
        break;
      case "B":
        screen.moveCursor(0, first);
        break;
      case "C":
        screen.moveCursor(first, 0);
        break;
      case "D":
        screen.moveCursor(-first, 0);
        break;
      case "H":
      case "f": {
        const row = positiveParam(numbers[0], 1);
        const col = positiveParam(numbers[1], 1);
        screen.setCursor(row, col);
        break;
      }
      case "J":
        screen.eraseDisplay(numberParam(numbers[0], 0));
        break;
      case "K":
        screen.eraseLine(numberParam(numbers[0], 0));
        break;
      case "S":
        screen.scrollUp(first);
        break;
      case "T":
        screen.scrollDown(first);
        break;
      case "h":
      case "l":
        if (privateMode) applyPrivateMode(screen, numbers, final === "h");
        break;
      case "m":
        screen.applySgr(parseSgrParams(params));
        break;
      case "r":
        if (params.length === 0) {
          screen.resetScrollRegion();
        } else {
          screen.setScrollRegion(
            positiveParam(numbers[0], 1),
            positiveParam(numbers[1], screen.size.rows),
          );
        }
        break;
      default:
        break;
    }

    return cursor;
  }

  private consumeOsc(data: string, index: number, screen: TerminalScreen): number {
    const parsed = readUntilOscTerminator(data, index);
    applyOsc(screen, parsed.payload);
    return parsed.endIndex;
  }
}

function parseNumericParams(params: string): number[] {
  if (params.length === 0) return [];
  return params.split(";").map((part) => Number.parseInt(part, 10));
}

function parseSgrParams(params: string): number[] {
  if (params.length === 0) return [0];
  return params.split(";").map((part) => {
    if (part.length === 0) return 0;
    const parsed = Number.parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function positiveParam(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberParam(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function applyPrivateMode(
  screen: TerminalScreen,
  modes: readonly number[],
  enabled: boolean,
): void {
  for (const mode of modes) {
    if (mode === 1) screen.setApplicationCursor(enabled);
    else if (mode === 47 || mode === 1047 || mode === 1049) screen.setAlternateScreen(enabled);
    else if (mode === 2004) screen.setBracketedPaste(enabled);
    else if (mode === 1000 || mode === 1002 || mode === 1003 || mode === 1006) {
      screen.setMouseMode(mode, enabled);
    }
  }
}

function readUntilOscTerminator(
  text: string,
  start: number,
): { payload: string; endIndex: number } {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\u0007") {
      return { payload: text.slice(start, index), endIndex: index };
    }
    if (text[index] === "\x1b" && text[index + 1] === "\\") {
      return { payload: text.slice(start, index), endIndex: index + 1 };
    }
  }
  return { payload: text.slice(start), endIndex: text.length - 1 };
}

function applyOsc(screen: TerminalScreen, payload: string): void {
  const firstSeparator = payload.indexOf(";");
  if (firstSeparator === -1) return;
  const command = payload.slice(0, firstSeparator);
  if (command !== "8") return;

  const rest = payload.slice(firstSeparator + 1);
  const secondSeparator = rest.indexOf(";");
  if (secondSeparator === -1) return;
  const uri = rest.slice(secondSeparator + 1);
  screen.setHyperlink(uri.length > 0 ? uri : null);
}

function readPrintableCluster(text: string, start: number): { text: string; nextIndex: number } {
  const first = text.codePointAt(start);
  if (first === undefined) return { text: "", nextIndex: start + 1 };
  let end = start + codePointLength(first);

  while (end < text.length) {
    const next = text.codePointAt(end);
    if (next === undefined) break;
    if (isCombiningCodePoint(next) || isVariationSelector(next) || isEmojiModifier(next)) {
      end += codePointLength(next);
      continue;
    }
    if (next === 0x200d) {
      end += codePointLength(next);
      const joined = text.codePointAt(end);
      if (joined !== undefined) end += codePointLength(joined);
      continue;
    }
    break;
  }

  return { text: text.slice(start, end), nextIndex: end };
}

function codePointLength(value: number): number {
  return value > 0xffff ? 2 : 1;
}

function isCombiningCodePoint(value: number): boolean {
  return (
    (value >= 0x0300 && value <= 0x036f) ||
    (value >= 0x1ab0 && value <= 0x1aff) ||
    (value >= 0x1dc0 && value <= 0x1dff) ||
    (value >= 0x20d0 && value <= 0x20ff)
  );
}

function isVariationSelector(value: number): boolean {
  return (value >= 0xfe00 && value <= 0xfe0f) || (value >= 0xe0100 && value <= 0xe01ef);
}

function isEmojiModifier(value: number): boolean {
  return value >= 0x1f3fb && value <= 0x1f3ff;
}
