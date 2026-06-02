import { describe, expect, test } from "bun:test";
import { isAtBottom, shouldRepinToBottom } from "../canvasRenderer.js";

describe("isAtBottom", () => {
  test("is true exactly at the bottom", () => {
    expect(isAtBottom(1000, 800, 200)).toBe(true);
  });

  test("tolerates sub-threshold rounding near the bottom", () => {
    // 1px short of the end stays pinned (subpixel layout, DPR rounding).
    expect(isAtBottom(1000, 799, 200)).toBe(true);
  });

  test("releases as soon as the user scrolls up past the threshold", () => {
    // A small, deliberate scroll up (>2px) must release follow.
    expect(isAtBottom(1000, 790, 200)).toBe(false);
  });

  test("is false when scrolled well up into scrollback", () => {
    expect(isAtBottom(1000, 0, 200)).toBe(false);
  });
});

describe("shouldRepinToBottom", () => {
  const base = { follow: true, grewOrResized: true, currentScrollTop: 0, targetScrollTop: 800 };

  test("re-pins when following and content grew or viewport resized", () => {
    expect(shouldRepinToBottom(base)).toBe(true);
  });

  test("does not fight a user-scroll repaint (nothing grew or resized)", () => {
    // The regression: a plain scroll repaint must not force scrollTop back down,
    // even while still nominally following near the bottom.
    expect(shouldRepinToBottom({ ...base, grewOrResized: false })).toBe(false);
  });

  test("never re-pins when the user has scrolled away from the bottom", () => {
    expect(shouldRepinToBottom({ ...base, follow: false })).toBe(false);
  });

  test("skips no-op re-pins already at the target", () => {
    expect(shouldRepinToBottom({ ...base, currentScrollTop: 800, targetScrollTop: 800 })).toBe(
      false,
    );
  });
});
