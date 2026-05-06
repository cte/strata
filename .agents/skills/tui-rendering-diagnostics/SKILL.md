---
name: tui-rendering-diagnostics
description: Diagnose terminal TUI rendering, cursor, scrollback, synchronized-output, picker, and layout glitches with byte-level instrumentation and reference comparisons. Use when a TUI bug only reproduces in a real terminal, mentions artifacts, duplicated rows, scrollback loss, cursor drift, picker glitches, terminal control bytes, or differences from Pi rendering.
---

# TUI Rendering Diagnostics

## Quick Start

Treat real-terminal rendering bugs as byte-stream bugs until proven
otherwise. Reproduce the smallest case, compare the code path to Pi, instrument
the terminal boundary, fix the minimal cause, then remove the instrumentation.

## Workflow

1. Record the exact reproduction:
   - terminal columns and rows
   - emulator name only if verified
   - command sequence and keypress count
   - whether tmux/screen/SSH/Mosh is involved
   - screenshots only as symptoms, not evidence of byte behavior

2. Minimize the state:
   - use `FakeTerminal` or e2e tests for deterministic setup
   - seed only the records needed to make the visible UI fail
   - keep the real-terminal repro command separate from automated tests

3. Compare to Pi before editing:
   - identify whether Pi uses editor-slot replacement, overlay compositing, or
     inline transcript rendering for the same UI
   - compare synchronized output boundaries, clear sequences, cursor placement,
     scrollback strategy, and line-width handling
   - write down concrete divergences; avoid broad "port Pi" guesses

4. Instrument at the terminal boundary:
   - raw input sequences before parsing
   - parsed input events
   - rendered frame lines with visible widths
   - previous viewport/cursor bookkeeping
   - full-vs-diff redraw choice
   - exact bytes written to the terminal, escaped for inspection
   - terminal startup writes such as keyboard protocol and bracketed paste

5. Inspect for terminal hazards:
   - `ESC[2J`, `ESC[H`, `ESC[3J` clearing visible buffer or scrollback
   - unintended `\r\n` while the cursor may be on the bottom row
   - writes to the last column that could trigger pending autowrap behavior
   - cursor moves that assume stale hardware cursor state
   - raw CSI/OSC/DCS/C0 controls inside user- or model-sourced display text
   - rendered lines whose visible width exceeds terminal columns

6. Fix the root cause:
   - prefer data sanitization for untrusted terminal text
   - prefer local renderer bookkeeping fixes over broad redraw hacks
   - keep Pi-aligned structure unless there is evidence Cortex needs a
     deliberate divergence

7. Clean up:
   - remove temporary trace files, env flags, and trace exports
   - remove speculative renderer toggles or workaround UI paths
   - keep only focused regression tests and short documentation of the finding

## Useful Checks

- Search for raw controls in persisted data before assuming layout drift:
  `rg -n --pcre2 "\\x1b|\\x00|\\x07" .cortex docs packages`
- Validate emitted UI text with `sanitizeTerminalText()` before it reaches the
  terminal.
- Add tests that assert dangerous byte sequences are absent from terminal
  output, not only that stripped output looks right.

## Cortex Lessons

The `/sessions` glitch was caused by stored session titles containing terminal
control bytes. Fake terminals did not interpret those bytes, so visual diffing
looked clean. A temporary real-terminal JSONL trace exposed the unsafe title in
the exact `terminal.write` chunk where the artifact appeared.
