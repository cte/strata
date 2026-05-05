import { describe, expect, test } from "bun:test";
import { stripAnsi } from "./ansi.js";
import { buildEditDiff, isUnifiedDiff, renderUnifiedDiff } from "./diff.js";

describe("buildEditDiff", () => {
  test("emits a unified diff with a hunk header and surrounding context", () => {
    const before = "line one\nline two\nline three\nline four\nline five";
    const oldText = "line three";
    const newText = "LINE THREE";
    const diff = buildEditDiff({ before, oldText, newText, path: "demo.md" });
    expect(diff).toContain("--- a/demo.md");
    expect(diff).toContain("+++ b/demo.md");
    expect(diff).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@/m);
    expect(diff).toMatch(/^-line three$/m);
    expect(diff).toMatch(/^\+LINE THREE$/m);
    expect(diff).toMatch(/^ line two$/m);
    expect(diff).toMatch(/^ line four$/m);
  });

  test("returns empty string when oldText is not present", () => {
    expect(buildEditDiff({ before: "abc", oldText: "z", newText: "Z" })).toBe("");
  });
});

describe("renderUnifiedDiff", () => {
  test("colorizes +/- and hunk header lines", () => {
    const diff = "@@ -1,2 +1,2 @@\n line one\n-old\n+new\n line two";
    const lines = renderUnifiedDiff(diff, 40).map(stripAnsi);
    expect(lines.find((l) => l.startsWith("@@"))).toBeDefined();
    expect(lines.find((l) => l.startsWith("-old"))).toBeDefined();
    expect(lines.find((l) => l.startsWith("+new"))).toBeDefined();
  });
});

describe("isUnifiedDiff", () => {
  test("recognizes hunk headers", () => {
    expect(isUnifiedDiff("@@ -1,3 +1,4 @@\n some context\n+added")).toBe(true);
    expect(isUnifiedDiff("just a string")).toBe(false);
    expect(isUnifiedDiff("")).toBe(false);
  });
});
