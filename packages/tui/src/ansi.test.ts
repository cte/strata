import { describe, expect, test } from "bun:test";
import {
  padToWidth,
  sliceByWidth,
  stripAnsi,
  truncateToWidth,
  visibleWidth,
  wrapText,
} from "./ansi.js";

describe("ansi", () => {
  test("stripAnsi removes escape sequences", () => {
    expect(stripAnsi("\x1b[31mhi\x1b[0m")).toBe("hi");
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

  test("wrapText preserves blank lines", () => {
    expect(wrapText("a\n\nb", 5)).toEqual(["a", "", "b"]);
  });

  test("sliceByWidth handles ANSI styling", () => {
    const out = sliceByWidth("\x1b[31mabcdef\x1b[0m", 3);
    expect(stripAnsi(out)).toBe("abc");
  });
});
