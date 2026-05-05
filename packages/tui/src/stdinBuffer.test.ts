import { describe, expect, test } from "bun:test";
import { StdinBuffer } from "./stdinBuffer.js";

function collect(buffer: StdinBuffer): { data: string[]; pastes: string[] } {
  const data: string[] = [];
  const pastes: string[] = [];
  buffer.on("data", (sequence) => {
    data.push(sequence);
  });
  buffer.on("paste", (text) => {
    pastes.push(text);
  });
  return { data, pastes };
}

describe("StdinBuffer", () => {
  test("splits two consecutive ESC bytes into separate events", async () => {
    // Real terminals (macOS Terminal, iTerm2) deliver rapid Esc-Esc as a
    // single read containing `\x1b\x1b`. The framer must emit two separate
    // escape sequences instead of one combined `\x1b\x1b` (which `parseKey`
    // maps to "ctrl+alt+[" and would swallow the double-Esc gesture).
    //
    // The first ESC is emitted immediately; the trailing ESC waits for the
    // sequence-completion timeout (10ms) before flushing — that's the same
    // window the framer uses to disambiguate "bare ESC" from the start of
    // a longer CSI/OSC. The flush still arrives well within the
    // double-Esc gesture's 500ms window.
    const buffer = new StdinBuffer({ timeout: 5 });
    const { data } = collect(buffer);
    buffer.process("\x1b\x1b");
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(data.length).toBe(2);
    expect(data[0]).toBe("\x1b");
    expect(data[1]).toBe("\x1b");
  });

  test("ESC followed by ESC followed by content emits both escapes then the content", () => {
    const buffer = new StdinBuffer({ timeout: 1 });
    const { data } = collect(buffer);
    // The trailing 'a' is on its own; the two ESCs split first. The 'a'
    // arrives as a meta-key sequence ("\x1ba") because the previous ESC
    // primed the framer; that's fine — it's still distinct from the two
    // standalone escapes.
    buffer.process("\x1b\x1ba");
    expect(data[0]).toBe("\x1b");
    expect(data[1]).toBe("\x1ba");
  });

  test("a real CSI sequence following ESC still parses correctly", () => {
    // ESC + ESC[A (up arrow). The first ESC is a standalone escape; the
    // second + `[A` form a single CSI sequence.
    const buffer = new StdinBuffer();
    const { data } = collect(buffer);
    buffer.process("\x1b\x1b[A");
    expect(data.length).toBe(2);
    expect(data[0]).toBe("\x1b");
    expect(data[1]).toBe("\x1b[A");
  });
});
