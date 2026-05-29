import { describe, expect, test } from "bun:test";
import type { DeleteSessionResult, SessionRecord } from "@strata/core";
import { stripAnsi } from "../../ansi.js";
import { SessionSelector } from "../sessionSelector.js";

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

function deleted(session: SessionRecord): DeleteSessionResult {
  return {
    id: session.id,
    title: session.title,
    tracePath: `/tmp/${session.id}.jsonl`,
    traceMethod: "unlink",
  };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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

    expect(seenAt(0)).toBe(true);

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

  test("sanitizes terminal controls from session titles before rendering", () => {
    const selector = new SessionSelector();
    selector.open(
      [makeSession("s1", "bad \x1b[99;5u title \x1b]2;owned\x07 ok")],
      () => {},
      () => {},
    );

    const rendered = selector.render({ width: 100, height: 24 }).lines.join("\n");
    expect(rendered).not.toContain("\x1b[99;5u");
    expect(rendered).not.toContain("\x1b]2;owned\x07");
    expect(stripAnsi(rendered)).toContain("bad title ok");
  });

  test("Ctrl+D asks for confirmation and Enter deletes the selected session", async () => {
    const sessions = [makeSession("s1", "first"), makeSession("s2", "second")];
    const selector = new SessionSelector();
    const deletedIds: string[] = [];
    selector.open(
      sessions,
      () => {},
      () => {},
      async (session) => {
        deletedIds.push(session.id);
        return deleted(session);
      },
    );

    selector.handleInput({ type: "key", key: "ctrl+d", raw: "\x04" });
    expect(renderSelector(selector, 80, 24).join("\n")).toContain("Delete session?");

    selector.handleInput({ type: "key", key: "enter", raw: "\r" });
    await flushPromises();

    expect(deletedIds).toEqual(["s1"]);
    expect(selector.sessions.map((session) => session.id)).toEqual(["s2"]);
    expect(renderSelector(selector, 80, 24).join("\n")).toContain("Session deleted");
  });

  test("does not delete the currently active session", async () => {
    const sessions = [makeSession("s1", "first")];
    const selector = new SessionSelector();
    let deleteCalls = 0;
    selector.open(
      sessions,
      () => {},
      () => {},
      async (session) => {
        deleteCalls += 1;
        return deleted(session);
      },
      "s1",
    );

    selector.handleInput({ type: "key", key: "ctrl+d", raw: "\x04" });
    selector.handleInput({ type: "key", key: "enter", raw: "\r" });
    await flushPromises();

    expect(deleteCalls).toBe(0);
    expect(selector.sessions).toEqual(sessions);
    expect(renderSelector(selector, 80, 24).join("\n")).toContain(
      "Cannot delete the currently active session",
    );
  });
});
