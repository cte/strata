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
