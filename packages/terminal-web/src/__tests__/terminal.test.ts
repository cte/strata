import { describe, expect, test } from "bun:test";
import { Terminal, type TerminalSnapshot } from "../index.js";
import { keySequence, pastePayload } from "../input.js";
import { HandwrittenVtParser } from "../parser.js";
import { TerminalScreen } from "../screen.js";

describe("Terminal", () => {
  test("stores plain text and scrolls", () => {
    const term = new Terminal({ cols: 4, rows: 2 });
    term.write("ab\r\ncd\r\nef");
    expect(term.size).toEqual({ cols: 4, rows: 2 });
    expect(lines(term.snapshot)).toEqual(["cd  ", "ef  "]);
  });

  test("emits keyboard input through onData", () => {
    const term = new Terminal();
    const seen: string[] = [];
    const sub = term.onData((data) => seen.push(data));
    sub.dispose();
    expect(seen).toEqual([]);
  });
});

describe("HandwrittenVtParser", () => {
  test("applies cursor movement and line erase fixtures", () => {
    const screen = new TerminalScreen(10, 3);
    const parser = new HandwrittenVtParser();

    parser.write("alpha\r\nbeta\r\ncharlie", screen);
    parser.write("\x1b[2;3HXX\x1b[K", screen);

    expect(lines(screen.snapshot())).toEqual(["alpha     ", "beXX      ", "charlie   "]);
  });

  test("applies display erase fixtures", () => {
    const screen = new TerminalScreen(8, 2);
    const parser = new HandwrittenVtParser();

    parser.write("one\r\ntwo\x1b[2Jtop", screen);

    expect(lines(screen.snapshot())).toEqual(["        ", "   top  "]);
  });

  test("applies SGR color and text attributes", () => {
    const screen = new TerminalScreen(12, 1);
    const parser = new HandwrittenVtParser();

    parser.write("\x1b[31;1mR\x1b[0mN\x1b[38;2;1;2;3mX", screen);

    const snapshot = screen.snapshot();
    expect(snapshot.cells[0]?.[0]?.style).toEqual({ foreground: "#ef4444", bold: true });
    expect(snapshot.cells[0]?.[1]?.style).toBeUndefined();
    expect(snapshot.cells[0]?.[2]?.style).toEqual({ foreground: "#010203" });
  });

  test("switches to alternate screen and restores primary content", () => {
    const screen = new TerminalScreen(8, 2);
    const parser = new HandwrittenVtParser();

    parser.write("main", screen);
    parser.write("\x1b[?1049halt", screen);

    expect(screen.snapshot().modes.alternateScreen).toBe(true);
    expect(lines(screen.snapshot())).toEqual(["alt     ", "        "]);

    parser.write("\x1b[?1049l", screen);

    expect(screen.snapshot().modes.alternateScreen).toBe(false);
    expect(lines(screen.snapshot())).toEqual(["main    ", "        "]);
    expect(screen.snapshot().cursor).toEqual({ x: 4, y: 0 });
  });

  test("scrolls inside the active scroll region", () => {
    const screen = new TerminalScreen(6, 4);
    const parser = new HandwrittenVtParser();

    parser.write("aa\r\nbb\r\ncc\r\ndd", screen);
    parser.write("\x1b[2;3r\x1b[3;1H\n", screen);

    expect(lines(screen.snapshot())).toEqual(["aa    ", "cc    ", "      ", "dd    "]);
  });

  test("tracks bracketed paste private mode", () => {
    const screen = new TerminalScreen(8, 2);
    const parser = new HandwrittenVtParser();

    parser.write("\x1b[?2004h", screen);
    expect(screen.snapshot().modes.bracketedPaste).toBe(true);

    parser.write("\x1b[?2004l", screen);
    expect(screen.snapshot().modes.bracketedPaste).toBe(false);
  });
});

describe("keySequence", () => {
  test("maps common shell control keys", () => {
    expect(keySequence(key("Enter"))).toBe("\r");
    expect(keySequence(key("Backspace"))).toBe("\x7f");
    expect(keySequence(key("ArrowUp"))).toBe("\x1b[A");
    expect(keySequence(key("c", { ctrlKey: true }))).toBe("\x03");
  });

  test("wraps paste payloads when bracketed paste is enabled", () => {
    expect(pastePayload("plain", false)).toBe("plain");
    expect(pastePayload("plain", true)).toBe("\x1b[200~plain\x1b[201~");
  });
});

function lines(snapshot: TerminalSnapshot): string[] {
  return snapshot.cells.map((row) => row.map((cell) => cell.char).join(""));
}

function key(
  value: string,
  options: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {},
): KeyboardEvent {
  return {
    key: value,
    altKey: options.altKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    shiftKey: options.shiftKey ?? false,
  } as KeyboardEvent;
}
