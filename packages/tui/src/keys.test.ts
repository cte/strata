import { describe, expect, test } from "bun:test";
import {
  decodePrintableKey,
  isKeyRelease,
  parseKey,
  sequenceToInputEvent,
  setKittyProtocolActive,
} from "./keys.js";
import { StdinBuffer } from "./stdinBuffer.js";

describe("parseKey", () => {
  test("decodes legacy printable keys and ctrl combinations", () => {
    expect(parseKey("a")).toBe("a");
    expect(parseKey("A")).toBe("A");
    expect(parseKey("\r")).toBe("enter");
    expect(parseKey("\t")).toBe("tab");
    expect(parseKey("\x7f")).toBe("backspace");
    expect(parseKey("\x03")).toBe("ctrl+c");
    expect(parseKey("\x04")).toBe("ctrl+d");
    expect(parseKey("\x1b")).toBe("escape");
  });

  test("decodes legacy arrow keys", () => {
    expect(parseKey("\x1b[A")).toBe("up");
    expect(parseKey("\x1b[B")).toBe("down");
    expect(parseKey("\x1b[C")).toBe("right");
    expect(parseKey("\x1b[D")).toBe("left");
  });

  test("decodes kitty CSI-u with modifiers", () => {
    expect(parseKey("\x1b[13;2u")).toBe("shift+enter");
    expect(parseKey("\x1b[9;2u")).toBe("shift+tab");
    expect(parseKey("\x1b[99;5u")).toBe("ctrl+c");
    expect(parseKey("\x1b[100;5u")).toBe("ctrl+d");
  });

  test("decodes xterm modifyOtherKeys form", () => {
    expect(parseKey("\x1b[27;2;13~")).toBe("shift+enter");
    expect(parseKey("\x1b[27;5;99~")).toBe("ctrl+c");
  });
});

describe("decodePrintableKey", () => {
  test("decodes plain CSI-u printable", () => {
    expect(decodePrintableKey("\x1b[97u")).toBe("a");
    expect(decodePrintableKey("\x1b[97:65;2u")).toBe("A");
  });

  test("falls back to ASCII shift for letters when alternate-key field is absent", () => {
    expect(decodePrintableKey("\x1b[97;2u")).toBe("A");
  });

  test("decodes modifyOtherKeys printable", () => {
    expect(decodePrintableKey("\x1b[27;2;65~")).toBe("A");
    expect(decodePrintableKey("\x1b[27;1;97~")).toBe("a");
  });

  test("rejects ctrl/alt-modified printable", () => {
    expect(decodePrintableKey("\x1b[97;5u")).toBeUndefined();
  });
});

describe("isKeyRelease", () => {
  test("flags kitty release events", () => {
    expect(isKeyRelease("\x1b[97;1:3u")).toBe(true);
    expect(isKeyRelease("\x1b[1;1:3A")).toBe(true);
  });

  test("does not flag press events or paste content", () => {
    expect(isKeyRelease("\x1b[97;1:1u")).toBe(false);
    expect(isKeyRelease("\x1b[97u")).toBe(false);
    expect(isKeyRelease("\x1b[200~3:3u\x1b[201~")).toBe(false);
  });
});

describe("sequenceToInputEvent", () => {
  test("returns key events for recognized KeyIds", () => {
    expect(sequenceToInputEvent("\r")).toEqual({ type: "key", key: "enter", raw: "\r" });
    expect(sequenceToInputEvent("\x03")).toEqual({ type: "key", key: "ctrl+c", raw: "\x03" });
    expect(sequenceToInputEvent("\x1b[13;2u")).toEqual({
      type: "key",
      key: "shift+enter",
      raw: "\x1b[13;2u",
    });
  });

  test("returns text events for printable input", () => {
    expect(sequenceToInputEvent("a")).toEqual({ type: "text", text: "a", raw: "a" });
    expect(sequenceToInputEvent("\x1b[97;2u")).toEqual({
      type: "text",
      text: "A",
      raw: "\x1b[97;2u",
    });
  });

  test("ignores keys cortex doesn't model that aren't printable", () => {
    expect(sequenceToInputEvent("\x1b[127;3u")).toBeUndefined();
  });
});

describe("StdinBuffer", () => {
  test("frames printable input one character at a time", () => {
    const buffer = new StdinBuffer({ timeout: 10 });
    const sequences: string[] = [];
    buffer.on("data", (s) => sequences.push(s));
    buffer.process("abc");
    expect(sequences).toEqual(["a", "b", "c"]);
  });

  test("buffers split escape sequences", () => {
    const buffer = new StdinBuffer({ timeout: 10 });
    const sequences: string[] = [];
    buffer.on("data", (s) => sequences.push(s));
    buffer.process("\x1b");
    expect(sequences).toEqual([]);
    buffer.process("[A");
    expect(sequences).toEqual(["\x1b[A"]);
  });

  test("emits paste content separately from data", () => {
    const buffer = new StdinBuffer({ timeout: 10 });
    const data: string[] = [];
    const pastes: string[] = [];
    buffer.on("data", (s) => data.push(s));
    buffer.on("paste", (s) => pastes.push(s));
    buffer.process("\x1b[200~hello\x1b[201~");
    expect(data).toEqual([]);
    expect(pastes).toEqual(["hello"]);
  });
});

// Confine kitty protocol state to this file so other tests aren't affected.
setKittyProtocolActive(false);
