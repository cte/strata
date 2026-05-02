import { describe, expect, test } from "bun:test";
import { InputBuffer, type InputEvent } from "./keys.js";

function collect(buffer: InputBuffer, chunks: string[]): InputEvent[] {
  const events: InputEvent[] = [];
  for (const chunk of chunks) {
    events.push(...buffer.push(chunk));
  }
  return events;
}

describe("InputBuffer", () => {
  test("decodes printable text", () => {
    const events = collect(new InputBuffer(), ["abc"]);
    expect(events).toEqual([
      { type: "text", text: "a", raw: "a" },
      { type: "text", text: "b", raw: "b" },
      { type: "text", text: "c", raw: "c" },
    ]);
  });

  test("recognizes enter and backspace", () => {
    const events = collect(new InputBuffer(), ["\r\x7f"]);
    expect(events.map((e) => (e.type === "key" ? e.key : null))).toEqual(["enter", "backspace"]);
  });

  test("decodes arrow keys", () => {
    const events = collect(new InputBuffer(), ["\x1b[A\x1b[B\x1b[C\x1b[D"]);
    expect(events.map((e) => (e.type === "key" ? e.key : null))).toEqual([
      "up",
      "down",
      "right",
      "left",
    ]);
  });

  test("captures bracketed paste", () => {
    const events = collect(new InputBuffer(), ["\x1b[200~hello\x1b[201~"]);
    expect(events).toEqual([{ type: "paste", text: "hello", raw: "hello" }]);
  });

  test("survives split sequences across chunks", () => {
    const buffer = new InputBuffer();
    expect(buffer.push("\x1b")).toEqual([]);
    expect(buffer.push("[A")).toEqual([{ type: "key", key: "up", raw: "\x1b[A" }]);
  });

  test("captures ctrl combinations", () => {
    const events = collect(new InputBuffer(), ["\x03\x04\x15\x17"]);
    expect(events.map((e) => (e.type === "key" ? e.key : null))).toEqual([
      "ctrl+c",
      "ctrl+d",
      "ctrl+u",
      "ctrl+w",
    ]);
  });
});
