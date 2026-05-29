import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../ansi.js";
import { Markdown } from "../components.js";

function render(text: string, width = 60): string[] {
  return new Markdown(text)
    .render({ width, height: 0 })
    .lines.map((line) => stripAnsi(line).replace(/\s+$/, ""));
}

describe("Markdown", () => {
  test("renders headings with hierarchy", () => {
    const out = render("# H1\n\n## H2\n\n### H3\n");
    const joined = out.join("\n");
    expect(joined).toContain("H1");
    expect(joined).toContain("H2");
    expect(joined).toContain("H3");
  });

  test("renders fenced code with backtick markers", () => {
    const out = render("```ts\nconst x = 1;\n```");
    // Pi's renderer brackets code with literal ``` markers (styled muted),
    // not a Unicode box.
    expect(out.some((line) => line.startsWith("```ts"))).toBe(true);
    expect(out.some((line) => line === "```")).toBe(true);
    expect(out.some((line) => line.includes("const x = 1"))).toBe(true);
  });

  test("renders bulleted and numbered lists with nesting", () => {
    const out = render("- a\n- b\n  - nested\n\n1. first\n2. second");
    expect(out.some((line) => line.startsWith("- a"))).toBe(true);
    expect(out.some((line) => line.startsWith("- b"))).toBe(true);
    // Nested list items are indented; the inner bullet is also "-".
    expect(out.some((line) => /^\s+-\s+nested/.test(line))).toBe(true);
    expect(out.some((line) => line.startsWith("1. first"))).toBe(true);
    expect(out.some((line) => line.startsWith("2. second"))).toBe(true);
  });

  test("renders blockquotes with a vertical bar", () => {
    const out = render("> quoted\n> still quoted");
    expect(out.filter((line) => line.startsWith("│ ")).length).toBe(2);
  });

  test("renders horizontal rules", () => {
    const out = render("before\n\n---\n\nafter");
    expect(out.some((line) => line.startsWith("─"))).toBe(true);
  });

  test("does not corrupt the line when inline code precedes a link", () => {
    // Regression: link regex used to match `[` characters embedded in ANSI
    // escapes inserted by earlier transforms.
    const out = render("see `code`, then [link](https://example.com).");
    const joined = out.join("\n");
    expect(joined).toContain("`code`");
    expect(joined).toContain("link");
    expect(joined).toContain("(https://example.com)");
    // The literal "1m" tail of an ESC sequence must never leak through.
    expect(joined).not.toMatch(/\b1m`/);
  });
});
