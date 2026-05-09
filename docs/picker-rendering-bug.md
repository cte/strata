# Session picker rendering bug

## Summary

The `/sessions` picker looked like a rendering/layout bug on a real terminal:
after repeated Down keypresses, stale picker rows appeared above the TUI
header. The fake terminal and VT-style tests did not reproduce it.

The root cause was not picker layout. Older stored session titles contained
raw terminal control/input sequences such as CSI-u keyboard bytes
(`ESC[99;5u`, `ESC[100;5u`) and OSC title-control bytes. When those sessions
entered the visible picker window, Strata wrote the stored bytes back to
stdout as display text. A real terminal interpreted them as controls; the fake
terminal treated them as inert bytes.

Fix:

- `packages/tui/src/ansi.ts` provides `sanitizeTerminalText()`.
- Session titles are sanitized before TUI display in
  `packages/tui/src/app/sessionSelector.ts` and before status/transcript
  display in `packages/tui/src/app/app.ts`.
- Generated session titles are sanitized before storage in
  `packages/agent/src/agentLoop.ts`.
- Regression tests cover CSI-u/OSC stripping, generated-title storage, the
  session selector render path, and the `/sessions` e2e command.

## What changed

Keep:

- Pi-style scrollback rendering: no alt-screen; content flows through the main
  terminal buffer.
- Pi-style selector replacement: focused session/model/auth selectors replace
  the editor slot while active.
- Pi-style renderer structure: synchronized output wraps frame content, while
  cursor visibility and final cursor positioning are outside the sync block.
- Sanitization of any untrusted string that may be written to the terminal.

Removed after diagnosis:

- Temporary JSONL TUI trace recorder and `STRATA_TUI_TRACE` runtime plumbing.
- Editor-attached `/sessions` picker workaround.
- Autowrap toggling and absolute-row patch experiments.
- Tests that asserted those temporary implementation details.

## Learnings

Do not assume a terminal emulator. The user explicitly corrected an iTerm2
assumption; the bug should be described as real-terminal behavior unless the
emulator is verified.

Exact byte tracing beats visual speculation. The useful trace recorded raw
input sequences, rendered frame lines, diff decisions, cursor bookkeeping, and
the exact bytes written to the terminal. The decisive evidence was the unsafe
title bytes appearing in a `terminal.write` chunk on the render where the
artifact appeared.

Compare against Pi, but keep the comparison specific. Pi helped identify
renderer and selector patterns worth preserving, but the root cause was
untrusted terminal bytes in Strata data, not a broad layout mismatch.

Remove diagnostic scaffolding after the root cause is fixed. Keeping trace
recorders or defensive renderer hacks in the product path makes future
rendering work harder to reason about.

## Future diagnostics

Use `.agents/skills/tui-rendering-diagnostics/SKILL.md` for the repeatable
debugging loop. The short version:

1. Reproduce with the smallest TUI state and exact terminal size.
2. Compare the code path to Pi before changing behavior.
3. Add temporary logging at the terminal boundary, not just component state.
4. Inspect written bytes for clears, scrolls, cursor moves, sync blocks, raw
   controls inside display text, and lines wider than the terminal.
5. Fix the minimal root cause and delete the temporary instrumentation.
