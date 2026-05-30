import { describe, expect, test } from "bun:test";
import { Terminal, type TerminalSnapshot } from "../index.js";
import { hasDocumentSelection, keySequence, pastePayload, sgrMouseSequence } from "../input.js";
import { HandwrittenVtParser } from "../parser.js";
import { TerminalScreen } from "../screen.js";
import { ANSI_TRANSCRIPT, FULLSCREEN_TRANSCRIPT, SHELL_TRANSCRIPT } from "./terminalFixtures.js";

describe("Terminal", () => {
  test("stores plain text and scrolls", () => {
    const term = new Terminal({ cols: 4, rows: 2 });
    term.write("ab\r\ncd\r\nef");
    expect(term.size).toEqual({ cols: 4, rows: 2 });
    expect(lines(term.snapshot)).toEqual(["cd  ", "ef  "]);
    expect(scrollbackLines(term.snapshot)).toEqual(["ab  "]);
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

  test("tracks application cursor and SGR mouse modes", () => {
    const screen = new TerminalScreen(8, 2);
    const parser = new HandwrittenVtParser();

    parser.write("\x1b[?1h\x1b[?1000h\x1b[?1006h", screen);
    expect(screen.snapshot().modes.applicationCursor).toBe(true);
    expect(screen.snapshot().modes.mouseTracking).toBe(true);
    expect(screen.snapshot().modes.sgrMouse).toBe(true);

    parser.write("\x1b[?1l\x1b[?1000l\x1b[?1006l", screen);
    expect(screen.snapshot().modes.applicationCursor).toBe(false);
    expect(screen.snapshot().modes.mouseTracking).toBe(false);
    expect(screen.snapshot().modes.sgrMouse).toBe(false);
  });

  test("stores OSC 8 hyperlinks on printed cells", () => {
    const screen = new TerminalScreen(12, 1);
    const parser = new HandwrittenVtParser();

    parser.write("\x1b]8;;https://example.com\x07go\x1b]8;;\x07 plain", screen);

    const snapshot = screen.snapshot();
    expect(snapshot.cells[0]?.[0]?.hyperlink).toBe("https://example.com");
    expect(snapshot.cells[0]?.[1]?.hyperlink).toBe("https://example.com");
    expect(snapshot.cells[0]?.[2]?.hyperlink).toBeUndefined();
  });

  test("keeps wide grapheme clusters in one leading cell", () => {
    const screen = new TerminalScreen(6, 1);
    const parser = new HandwrittenVtParser();

    parser.write("a界e\u0301", screen);

    const snapshot = screen.snapshot();
    expect(snapshot.cells[0]?.[0]?.char).toBe("a");
    expect(snapshot.cells[0]?.[1]?.char).toBe("界");
    expect(snapshot.cells[0]?.[1]?.width).toBe(2);
    expect(snapshot.cells[0]?.[2]?.continuation).toBe(true);
    expect(snapshot.cells[0]?.[3]?.char).toBe("e\u0301");
  });

  test("replays a mixed ANSI transcript fixture", () => {
    const screen = new TerminalScreen(32, 6);
    const parser = new HandwrittenVtParser();

    parser.write(ANSI_TRANSCRIPT, screen);

    const snapshot = screen.snapshot();
    expect(lines(snapshot)[0]).toContain("plain");
    expect(snapshot.cells[1]?.[0]?.style).toEqual({ foreground: "#ef4444", bold: true });
    expect(snapshot.cells[2]?.[0]?.hyperlink).toBe("https://example.com");
    expect(lines(snapshot)[3]).toContain("wide:界");
  });

  test("keeps shell transcript scrollback", () => {
    const screen = new TerminalScreen(40, 4);
    const parser = new HandwrittenVtParser();

    parser.write(SHELL_TRANSCRIPT, screen);

    expect(scrollbackLines(screen.snapshot()).join("\n")).toContain("one");
    expect(lines(screen.snapshot()).join("\n")).toContain("line-5");
  });

  test("restores primary content after full-screen transcript", () => {
    const screen = new TerminalScreen(24, 4);
    const parser = new HandwrittenVtParser();

    parser.write(FULLSCREEN_TRANSCRIPT, screen);

    const snapshot = screen.snapshot();
    expect(snapshot.modes.alternateScreen).toBe(false);
    expect(snapshot.modes.mouseTracking).toBe(true);
    expect(snapshot.modes.sgrMouse).toBe(true);
    expect(lines(snapshot)[0]).toContain("primary prompt");
  });

  test("captures primary scrollback and clears it with CSI 3J", () => {
    const screen = new TerminalScreen(4, 2);
    const parser = new HandwrittenVtParser();

    parser.write("a\r\nb\r\nc", screen);
    expect(scrollbackLines(screen.snapshot())).toEqual(["a   "]);

    parser.write("\x1b[3J", screen);
    expect(scrollbackLines(screen.snapshot())).toEqual([]);
  });

  test("does not capture alternate screen output as scrollback", () => {
    const screen = new TerminalScreen(4, 2);
    const parser = new HandwrittenVtParser();

    parser.write("a\r\nb\r\nc", screen);
    parser.write("\x1b[?1049h1\r\n2\r\n3", screen);

    expect(scrollbackLines(screen.snapshot())).toEqual(["a   "]);
    expect(screen.snapshot().modes.alternateScreen).toBe(true);
  });
});

describe("keySequence", () => {
  test("maps common shell control keys", () => {
    expect(keySequence(key("Enter"))).toBe("\r");
    expect(keySequence(key("Backspace"))).toBe("\x7f");
    expect(keySequence(key("ArrowUp"))).toBe("\x1b[A");
    expect(keySequence(key("c", { ctrlKey: true }))).toBe("\x03");
  });

  test("maps richer keyboard and application cursor sequences", () => {
    expect(keySequence(key("ArrowUp"), { applicationCursor: true })).toBe("\x1bOA");
    expect(keySequence(key("PageDown"))).toBe("\x1b[6~");
    expect(keySequence(key("F5"))).toBe("\x1b[15~");
  });

  test("encodes SGR mouse packets", () => {
    expect(sgrMouseSequence(0, 4, 2, "M")).toBe("\x1b[<0;4;2M");
    expect(sgrMouseSequence(3, 4, 2, "m")).toBe("\x1b[<3;4;2m");
  });

  test("wraps paste payloads when bracketed paste is enabled", () => {
    expect(pastePayload("plain", false)).toBe("plain");
    expect(pastePayload("plain", true)).toBe("\x1b[200~plain\x1b[201~");
  });
});

describe("hasDocumentSelection", () => {
  test("only treats terminal-contained selections as copyable", () => {
    const inside = {} as Node;
    const outside = {} as Node;
    const root = {
      contains: (node: Node | null) => node === inside,
    } as Node;

    withSelection({ isCollapsed: false, anchorNode: inside, focusNode: inside }, () => {
      expect(hasDocumentSelection(root)).toBe(true);
    });

    withSelection({ isCollapsed: false, anchorNode: inside, focusNode: outside }, () => {
      expect(hasDocumentSelection(root)).toBe(false);
    });

    withSelection({ isCollapsed: true, anchorNode: inside, focusNode: inside }, () => {
      expect(hasDocumentSelection(root)).toBe(false);
    });
  });
});

function lines(snapshot: TerminalSnapshot): string[] {
  return snapshot.cells.map((row) => row.map((cell) => cell.char).join(""));
}

function scrollbackLines(snapshot: TerminalSnapshot): string[] {
  return snapshot.scrollbackCells.map((row) => row.map((cell) => cell.char).join(""));
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

function withSelection(
  selection: Pick<Selection, "isCollapsed" | "anchorNode" | "focusNode">,
  fn: () => void,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "getSelection");
  Object.defineProperty(globalThis, "getSelection", {
    configurable: true,
    value: () => selection,
  });
  try {
    fn();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, "getSelection");
    } else {
      Object.defineProperty(globalThis, "getSelection", descriptor);
    }
  }
}
