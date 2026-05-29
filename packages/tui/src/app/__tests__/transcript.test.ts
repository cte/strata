import { describe, expect, test } from "bun:test";
import { stripAnsi, visibleWidth } from "../../ansi.js";
import { Transcript } from "../transcript.js";

describe("Transcript", () => {
  test("wraps submitted user messages at word boundaries", () => {
    const width = 16;
    const frame = new Transcript([{ kind: "user", content: "alpha beta gamma delta" }]).render({
      width,
      height: 0,
    });
    const stripped = frame.lines.map((line) => stripAnsi(line));
    const contentRows = stripped.map((line) => line.trim()).filter((line) => line !== "");

    expect(contentRows).toEqual(["alpha beta", "gamma delta"]);
    expect(contentRows).not.toContain("alpha beta gamm");
    expect(contentRows).not.toContain("a delta");
    for (const line of stripped) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });
});
