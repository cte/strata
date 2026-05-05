import { describe, expect, test } from "bun:test";
import {
  detectCapabilities,
  encodeITerm2,
  encodeKitty,
  getPngDimensions,
  imageFallback,
  isImageLine,
  renderImage,
  setCapabilities,
} from "./terminalImage.js";

// A minimal 1×1 PNG (red pixel) — used to exercise format detection without
// shipping a binary fixture.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

describe("getPngDimensions", () => {
  test("reads dimensions from a real PNG header", () => {
    expect(getPngDimensions(TINY_PNG_BASE64)).toEqual({ widthPx: 1, heightPx: 1 });
  });

  test("returns null on garbage", () => {
    expect(getPngDimensions("not-a-png")).toBeNull();
  });
});

describe("encodeKitty / encodeITerm2", () => {
  test("kitty produces a single chunked escape for small payloads", () => {
    const seq = encodeKitty("AAAA", { columns: 10, rows: 2 });
    expect(seq).toContain("\x1b_G");
    expect(seq).toContain("c=10");
    expect(seq).toContain("r=2");
    expect(seq).toContain(";AAAA\x1b\\");
  });

  test("iterm2 wraps base64 with the 1337 OSC", () => {
    const seq = encodeITerm2("AAAA", { width: 10 });
    expect(seq).toContain("\x1b]1337;File=");
    expect(seq).toContain("inline=1");
    expect(seq).toContain("width=10");
    expect(seq.endsWith(":AAAA\x07")).toBe(true);
  });
});

describe("isImageLine", () => {
  test("flags kitty / iterm2 escape sequences in the line", () => {
    expect(isImageLine("\x1b_GAAAA\x1b\\")).toBe(true);
    expect(isImageLine("\x1b]1337;File=...\x07")).toBe(true);
    expect(isImageLine("regular text")).toBe(false);
  });
});

describe("renderImage", () => {
  test("returns null when terminal can't render images", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    try {
      const out = renderImage(TINY_PNG_BASE64, { widthPx: 1, heightPx: 1 });
      expect(out).toBeNull();
    } finally {
      setCapabilities(null);
    }
  });

  test("emits a kitty sequence and reserves at least one row when capable", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    try {
      const out = renderImage(TINY_PNG_BASE64, { widthPx: 100, heightPx: 50 }, {
        maxWidthCells: 40,
      });
      expect(out).not.toBeNull();
      expect(out!.sequence.startsWith("\x1b_G")).toBe(true);
      expect(out!.rows).toBeGreaterThanOrEqual(1);
    } finally {
      setCapabilities(null);
    }
  });
});

describe("imageFallback", () => {
  test("describes the attachment when inline rendering isn't available", () => {
    expect(imageFallback("image/png", { widthPx: 320, heightPx: 200 }, "shot.png")).toContain(
      "320×200",
    );
    expect(imageFallback("image/png", null, "shot.png")).toContain("shot.png");
  });
});

describe("detectCapabilities", () => {
  test("disables image protocols inside tmux", () => {
    const original = process.env.TMUX;
    process.env.TMUX = "/tmp/whatever";
    try {
      const caps = detectCapabilities();
      expect(caps.images).toBeNull();
      expect(caps.hyperlinks).toBe(false);
    } finally {
      if (original === undefined) delete process.env.TMUX;
      else process.env.TMUX = original;
    }
  });
});
