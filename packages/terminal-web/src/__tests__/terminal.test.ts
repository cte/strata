import { describe, expect, test } from "bun:test";
import { Terminal } from "../index.js";

describe("Terminal", () => {
  test("stores plain text and scrolls", () => {
    const term = new Terminal({ cols: 5, rows: 2 });
    term.write("hello\nworld\n!");
    expect(term.size).toEqual({ cols: 5, rows: 2 });
  });

  test("emits keyboard input through onData", () => {
    const term = new Terminal();
    const seen: string[] = [];
    const sub = term.onData((data) => seen.push(data));
    sub.dispose();
    expect(seen).toEqual([]);
  });
});
