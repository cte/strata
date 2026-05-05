import { describe, expect, test } from "bun:test";
import { stripAnsi } from "./ansi.js";
import { FakeTerminal } from "./terminal.js";
import { TuiRuntime } from "./runtime.js";
import { Container, Text } from "./components.js";

function pump(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("TuiRuntime", () => {
  test("renders the root component into the terminal", async () => {
    const terminal = new FakeTerminal(20, 6);
    const root = new Container([new Text("Hello"), new Text("World")]);
    const runtime = new TuiRuntime({ terminal, root });
    runtime.start();
    await pump();
    runtime.stop();
    const output = stripAnsi(terminal.output);
    expect(output).toContain("Hello");
    expect(output).toContain("World");
  });

  test("invalidates render on resize", async () => {
    const terminal = new FakeTerminal(20, 6);
    const root = new Container([new Text("Hello")]);
    const runtime = new TuiRuntime({ terminal, root });
    runtime.start();
    await pump();
    const before = terminal.frames.length;
    terminal.resize(40, 8);
    await pump();
    runtime.stop();
    expect(terminal.frames.length).toBeGreaterThan(before);
  });

  test("restores the terminal when render throws", async () => {
    const terminal = new FakeTerminal(20, 6);
    const stopped: { value: boolean } = { value: false };
    const originalStop = terminal.stop.bind(terminal);
    terminal.stop = () => {
      stopped.value = true;
      originalStop();
    };
    const error = new Error("boom");
    const root = {
      render(): never {
        throw error;
      },
    };
    let captured: unknown;
    const runtime = new TuiRuntime({
      terminal,
      root,
      onFatalError: (err) => (captured = err),
    });
    runtime.start();
    await pump();
    expect(captured).toBe(error);
    expect(stopped.value).toBe(true);
  });

  test("does not enter alt-screen mode (transcript flows into native scrollback)", async () => {
    const terminal = new FakeTerminal(20, 6);
    const root = new Container([new Text("hi")]);
    const runtime = new TuiRuntime({ terminal, root });
    runtime.start();
    await pump();
    runtime.stop();
    expect(terminal.output).not.toContain("\x1b[?1049h");
    expect(terminal.output).not.toContain("\x1b[?1049l");
  });

  test("scrolls existing content into scrollback when new lines extend past viewport", async () => {
    const terminal = new FakeTerminal(20, 4);
    const lines = ["line1", "line2"];
    const root: { render: () => { lines: string[] } } = {
      render: () => ({ lines: lines.slice() }),
    };
    const runtime = new TuiRuntime({ terminal, root });
    runtime.start();
    await pump();
    const beforeOutput = terminal.output;
    expect(stripAnsi(beforeOutput)).toContain("line1");
    expect(stripAnsi(beforeOutput)).toContain("line2");

    // Grow content past the viewport (height=4) — runtime must write \r\n
    // to scroll older lines into native scrollback.
    lines.push("line3", "line4", "line5", "line6");
    runtime.invalidate();
    await pump();
    runtime.stop();

    const after = terminal.output.slice(beforeOutput.length);
    expect(stripAnsi(after)).toContain("line5");
    expect(stripAnsi(after)).toContain("line6");
    // Must use \r\n to scroll, not \x1b[2J full clear.
    expect(after).toContain("\r\n");
    expect(after).not.toContain("\x1b[2J");
  });

  test("falls back to a full redraw when an early-line change forces a scroll past it", async () => {
    // Regression for the scrollback-phantom bug: when the diff path inserts
    // new lines at a low absolute index AND the new content extends past the
    // previous viewport bottom, the planned scroll would push firstChanged
    // into scrollback. We must bail to a full redraw instead of writing into
    // scrollback (which the terminal silently clamps and leaves stale rows).
    const terminal = new FakeTerminal(20, 4);
    const lines = ["a", "b", "c"];
    const root: { render: () => { lines: string[] } } = {
      render: () => ({ lines: lines.slice() }),
    };
    const runtime = new TuiRuntime({ terminal, root });
    runtime.start();
    await pump();
    // Now insert two lines NEAR THE TOP and append more content at the
    // bottom — this is the pattern that triggered phantom scrollback rows
    // (the StatusLine's leading blank when an agent run started).
    lines.length = 0;
    lines.push("a", "X", "Y", "b", "c", "d", "e");
    const beforeFrames = terminal.frames.length;
    runtime.invalidate();
    await pump();
    runtime.stop();
    const newFrames = terminal.frames.slice(beforeFrames).join("");
    // Either a full-clear (now an explicit per-row \x1b[2K walk; previously
    // \x1b[2J) or a clean diff. The bug caused neither — content got
    // written into the wrong rows. Assert that a clear+rewrite fired by
    // looking for the per-row clear-line sequence.
    expect(newFrames.includes("\x1b[2K")).toBe(true);
    expect(stripAnsi(terminal.output)).toContain("X");
    expect(stripAnsi(terminal.output)).toContain("e");
  });

  test("dispatches input through the buffer", async () => {
    const terminal = new FakeTerminal(20, 4);
    const root = new Container([new Text("hi")]);
    const runtime = new TuiRuntime({ terminal, root });
    const events: string[] = [];
    runtime.onInput((event) => {
      events.push(event.type === "key" ? event.key : event.type);
    });
    runtime.start();
    terminal.feed("\r");
    await pump();
    runtime.stop();
    expect(events).toContain("enter");
  });
});
