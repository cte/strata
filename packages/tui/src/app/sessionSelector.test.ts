import { describe, expect, test } from "bun:test";
import type { SessionRecord } from "@cortex/core";
import { stripAnsi } from "../ansi.js";
import { SessionSelector } from "./sessionSelector.js";

function makeSession(id: string, title: string): SessionRecord {
  return {
    id,
    kind: "query",
    title,
    model: "test-model",
    status: "completed",
    startedAt: "2026-05-05T12:00:00.000Z",
    endedAt: "2026-05-05T12:01:00.000Z",
    gitCommit: null,
  };
}

function renderSelector(selector: SessionSelector, width: number, height: number): string[] {
  const frame = selector.render({ width, height });
  return frame.lines.map((line) => stripAnsi(line));
}

describe("SessionSelector", () => {
  test("scrolls a long list so the selected entry stays visible past the visible window", () => {
    const sessions = Array.from({ length: 30 }, (_, i) => makeSession(`s${i}`, `session ${i}`));
    const selector = new SessionSelector();
    selector.open(
      sessions,
      () => {},
      () => {},
    );

    const seenAt = (idx: number): boolean => {
      const lines = renderSelector(selector, 80, 24);
      return lines.some((line) => line.includes(`session ${idx}`));
    };

    // Initially the selection sits at index 0, so the first entries are visible.
    expect(seenAt(0)).toBe(true);

    // Walk the selection past the visible window. With a 24-row terminal the
    // session list gets ~17 rows; before this fix, advancing past 11 silently
    // dropped the cursor "off-screen". Now the window slides with us, so the
    // selected entry must always render — including the very last item.
    for (let i = 0; i < sessions.length - 1; i += 1) {
      selector.handleInput({ type: "key", key: "down", raw: "" });
    }
    expect(selector.selectedIndex).toBe(29);
    expect(seenAt(29)).toBe(true);
  });

  test("End jumps to the final entry; Home returns to the first", () => {
    const sessions = Array.from({ length: 50 }, (_, i) => makeSession(`s${i}`, `session ${i}`));
    const selector = new SessionSelector();
    selector.open(
      sessions,
      () => {},
      () => {},
    );

    selector.handleInput({ type: "key", key: "end", raw: "" });
    expect(selector.selectedIndex).toBe(49);
    selector.handleInput({ type: "key", key: "home", raw: "" });
    expect(selector.selectedIndex).toBe(0);
  });

  test("PgDn/PgUp jump by 10", () => {
    const sessions = Array.from({ length: 50 }, (_, i) => makeSession(`s${i}`, `session ${i}`));
    const selector = new SessionSelector();
    selector.open(
      sessions,
      () => {},
      () => {},
    );

    selector.handleInput({ type: "key", key: "pagedown", raw: "" });
    expect(selector.selectedIndex).toBe(10);
    selector.handleInput({ type: "key", key: "pagedown", raw: "" });
    expect(selector.selectedIndex).toBe(20);
    selector.handleInput({ type: "key", key: "pageup", raw: "" });
    expect(selector.selectedIndex).toBe(10);
  });

  test("renders an `(i/total)` indicator only when the list overflows the window", () => {
    const fewSessions = Array.from({ length: 3 }, (_, i) => makeSession(`s${i}`, `s ${i}`));
    const small = new SessionSelector();
    small.open(
      fewSessions,
      () => {},
      () => {},
    );
    const fewLines = renderSelector(small, 80, 24).join("\n");
    expect(fewLines).not.toMatch(/\(\d+\/\d+\)/);

    const manySessions = Array.from({ length: 50 }, (_, i) => makeSession(`s${i}`, `s ${i}`));
    const big = new SessionSelector();
    big.open(
      manySessions,
      () => {},
      () => {},
    );
    const manyLines = renderSelector(big, 80, 24).join("\n");
    expect(manyLines).toMatch(/\(1\/50\)/);
  });
});
