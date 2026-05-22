import { describe, expect, test } from "bun:test";
import {
  padToWidth,
  sanitizeTerminalText,
  sliceByWidth,
  stripAnsi,
  theme,
  truncateToWidth,
  visibleWidth,
  wrapText,
} from "./ansi.js";

describe("ansi", () => {
  test("stripAnsi removes escape sequences", () => {
    expect(stripAnsi("\x1b[31mhi\x1b[0m")).toBe("hi");
  });

  test("stripAnsi removes CSI-u and modified cursor sequences", () => {
    expect(stripAnsi("\x1b[99;5uhello\x1b[1;1:2B")).toBe("hello");
  });

  test("sanitizeTerminalText removes terminal controls from untrusted text", () => {
    expect(sanitizeTerminalText("bad \x1b[99;5u title \x1b]2;owned\x07 ok")).toBe("bad  title  ok");
  });

  test("visibleWidth ignores ANSI", () => {
    expect(visibleWidth("\x1b[31mabc\x1b[0m")).toBe(3);
  });

  test("visibleWidth counts CJK as 2", () => {
    expect(visibleWidth("漢字")).toBe(4);
  });

  test("visibleWidth ignores combining marks", () => {
    expect(visibleWidth("é")).toBe(1);
  });

  test("truncateToWidth adds ellipsis", () => {
    expect(truncateToWidth("hello world", 8)).toBe("hello w…");
  });

  test("truncateToWidth keeps under-width text", () => {
    expect(truncateToWidth("hi", 5)).toBe("hi");
  });

  test("padToWidth pads with spaces", () => {
    expect(padToWidth("hi", 5)).toBe("hi   ");
  });

  test("padToWidth respects ANSI", () => {
    const padded = padToWidth("\x1b[31mhi\x1b[0m", 4);
    expect(visibleWidth(padded)).toBe(4);
  });

  test("wrapText breaks long lines", () => {
    expect(wrapText("abcdef", 3)).toEqual(["abc", "def"]);
  });

  test("wrapText prefers word boundaries", () => {
    expect(wrapText("alpha beta gamma delta", 12)).toEqual(["alpha beta", "gamma delta"]);
  });

  test("wrapText does not start wrapped rows with whitespace", () => {
    expect(wrapText("alpha beta gamma", 10)).toEqual(["alpha beta", "gamma"]);
  });

  test("wrapText preserves ANSI style across wrapped rows without empty control rows", () => {
    const wrapped = wrapText(theme.accent("alpha supercalifragilistic"), 5);
    expect(wrapped.map((line) => stripAnsi(line))).toEqual([
      "alpha",
      "super",
      "calif",
      "ragil",
      "istic",
    ]);
  });

  test("wrapText preserves blank lines", () => {
    expect(wrapText("a\n\nb", 5)).toEqual(["a", "", "b"]);
  });

  test("sliceByWidth handles ANSI styling", () => {
    const out = sliceByWidth("\x1b[31mabcdef\x1b[0m", 3);
    expect(stripAnsi(out)).toBe("abc");
  });
});
