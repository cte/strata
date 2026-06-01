import { describe, expect, test } from "bun:test";
import { formatRunElapsed } from "../chatStreamingStatus.js";

describe("chat streaming status", () => {
  test("formats elapsed runtime compactly", () => {
    expect(
      formatRunElapsed("2026-06-01T12:00:00.000Z", Date.parse("2026-06-01T12:01:11.000Z")),
    ).toBe("1m 11s");
    expect(
      formatRunElapsed("2026-06-01T12:00:00.000Z", Date.parse("2026-06-01T12:00:05.000Z")),
    ).toBe("5s");
    expect(
      formatRunElapsed("2026-06-01T12:00:00.000Z", Date.parse("2026-06-01T14:03:05.000Z")),
    ).toBe("2h 3m");
    expect(formatRunElapsed("not a date", Date.parse("2026-06-01T12:00:05.000Z"))).toBeNull();
  });
});
