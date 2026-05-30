import { describe, expect, test } from "bun:test";
import {
  cleanSourceText,
  decodeEntities,
  shortSourceLabel,
  sourceKindFromPath,
  sourceKindLabel,
} from "@/lib/sourceText";

describe("decodeEntities", () => {
  test("decodes named and numeric entities", () => {
    expect(decodeEntities("&gt; a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe(
      "> a & b <c> \"d\" 'e'",
    );
    expect(decodeEntities("&#128640;")).toBe("🚀");
    expect(decodeEntities("&#x1F680;")).toBe("🚀");
  });

  test("leaves unknown entities intact", () => {
    expect(decodeEntities("a &copy; b")).toBe("a &copy; b");
  });
});

describe("cleanSourceText", () => {
  test("resolves slack user mentions", () => {
    expect(cleanSourceText("<@U08R4UGEQQZ> can you give one of us access")).toBe(
      "@someone can you give one of us access",
    );
    expect(cleanSourceText("ping <@U123|alex> please")).toBe("ping @alex please");
  });

  test("resolves channel, broadcast, and link tokens", () => {
    expect(cleanSourceText("see <#C123|general>")).toBe("see #general");
    expect(cleanSourceText("<!here> heads up")).toBe("@here heads up");
    expect(cleanSourceText("docs <https://example.com|the spec>")).toBe("docs the spec");
    expect(cleanSourceText("raw <https://example.com>")).toBe("raw https://example.com");
  });

  test("drops emoji shortcodes but preserves clock times", () => {
    expect(cleanSourceText("prepare an app release :ship:")).toBe("prepare an app release");
    expect(cleanSourceText(":tada: shipped")).toBe("shipped");
    expect(cleanSourceText("standup at 12:30 today")).toBe("standup at 12:30 today");
  });

  test("strips blockquote markers and unwraps emphasis", () => {
    expect(cleanSourceText("&gt; *Review:* one issue")).toBe("Review: one issue");
    expect(cleanSourceText("ship _the_ release ~now~")).toBe("ship the release now");
  });

  test("leaves bullets, arithmetic, and identifiers intact", () => {
    expect(cleanSourceText("* todo item")).toBe("* todo item");
    expect(cleanSourceText("scale 2 * 3 * 4")).toBe("scale 2 * 3 * 4");
    expect(cleanSourceText("call render_view soon")).toBe("call render_view soon");
  });
});

describe("sourceKindFromPath", () => {
  test("classifies known connectors", () => {
    expect(sourceKindFromPath("wiki/raw/slack/2026-05-29-x-prepare.md:18")).toBe("slack");
    expect(sourceKindFromPath("wiki/raw/granola/meeting.md")).toBe("granola");
    expect(sourceKindFromPath("wiki/raw/notion/page.md")).toBe("notion");
    expect(sourceKindFromPath("wiki/actions/mine.md:640")).toBe("wiki");
    expect(sourceKindFromPath("something/else.md")).toBe("source");
  });

  test("labels are human friendly", () => {
    expect(sourceKindLabel(sourceKindFromPath("wiki/raw/slack/x.md"))).toBe("Slack");
  });
});

describe("shortSourceLabel", () => {
  test("prefers the connector name over the raw path", () => {
    expect(
      shortSourceLabel("wiki/raw/slack/2026-05-29-c0ahzr6fekg-1780073703308169-prepare.md:18"),
    ).toBe("Slack");
  });

  test("falls back to a cleaned label for unknown sources", () => {
    expect(shortSourceLabel("misc/notes.md", "<@U1> quick note")).toBe("@someone quick note");
  });
});
