# Session/Model picker rendering bug — agent handoff

## TL;DR

Cortex's inline session picker (`/sessions`, `/resume`, double-Esc) renders
correctly in our `FakeTerminal` + VT-emulator harness at every terminal size
I've tested, but **on the user's real terminal (iTerm2 on macOS, 148×34, no
tmux) it produces visible duplication after ~11 navigation keypresses** —
two complete pickers stacked vertically, the older state below the newer
one. The model selector and auth dialog use the same render path and
presumably hit the same bug, but they aren't typically navigated long
enough to trigger it.

The same user has confirmed the editor's **slash-command autocomplete
picker does NOT have the bug**. That picker uses a different render path —
it's drawn inside `Editor.render()` after the prompt, as part of the
editor's own frame.

## The repository

- Cortex repo: `/home/exedev/Documents/cortex/`
- Pi reference (read-only): `/home/exedev/Documents/pi-mono/`
- Run cortex: `bun run cortex` (no build step; Bun reads `.ts` directly)
- Run tests: `bun test`
- Type check: `bun run check`

## What the user sees

`~/Pictures/bug.png` and `~/Pictures/bug2.png` are screenshots. Both show
the same pattern: after pressing Down/PgDn enough times, a previous render
of the picker remains visible **above** the newly-rendered picker. The
older picker shows an earlier `selectedIndex` (lower indicator value); the
newer one is below. Editor + footer render correctly at the bottom.

User-reported reproduction (their bug2.png): open `/sessions`, press Down
arrow exactly 11 times. The 11th press is when the glitch becomes visible.
(That number isn't load-bearing — it just happens to be when the bug
becomes obvious.)

User's terminal:

- iTerm2 (current version) on macOS.
- `tput lines && tput cols` → `34` rows × `148` cols.
- Not in tmux, not in a multiplexer.

## What I have NOT been able to reproduce

I built a small VT-state emulator (`VTScreen` class, used in a few
throwaway repro tests under `/tmp`) that replays the byte stream cortex
emits and tracks the resulting screen state cell-by-cell. I tested every
plausible terminal size (80×12, 80×24, 80×30, 80×34, 80×50, 148×34) with
the exact same input sequence (open picker, press Down N times). Every
state renders cleanly — no duplication.

So whatever the bug is, it depends on something my VT emulator is missing
that the user's real iTerm2 implements. Plausible candidates I have not
been able to confirm:

- iTerm2-specific quirks in synchronized output mode (`\x1b[?2026h`/`l`).
- iTerm2's handling of `\x1b[2J` differing from the standard.
- DECAWM (auto-wrap) edge cases at exactly column-width boundaries.
- Some interaction with cortex's enabled kitty keyboard protocol or
  bracketed paste.

## Architecture — cortex vs pi

### Cortex layout

Cortex is a Bun monorepo. The TUI lives in `packages/tui/`. Key files:

- `packages/tui/src/runtime.ts` — `TuiRuntime` class, ~470 lines. Owns the
  render loop, diff redraw, full redraw, cursor positioning. **Custom
  implementation**, not ported from pi.
- `packages/tui/src/keys.ts` — directly ported from pi (`packages/tui/src/keys.ts`).
- `packages/tui/src/stdinBuffer.ts` — directly ported from pi (`stdin-buffer.ts`).
- `packages/tui/src/terminal.ts` — `ProcessTerminal` startup follows pi's
  pattern (kitty-protocol query → flag-7 → 150ms modifyOtherKeys fallback).
- `packages/tui/src/app/app.ts` — `CortexApp` is the root component.
- `packages/tui/src/app/sessionSelector.ts` — the misbehaving picker.
- `packages/tui/src/app/modelSelector.ts` — same render path.
- `packages/tui/src/app/authDialog.ts` — same render path.
- `packages/tui/src/app/chrome.ts` — `renderInlinePicker<T>` shared helper.

### Pi layout

- `packages/tui/src/tui.ts` — pi's full runtime. ~1240 lines. Owns
  rendering. Substantially more complete than cortex's runtime.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts` —
  pi's session navigator (`TreeSelectorComponent`, `showTreeSelector` at
  line 4131). Modal-style, not inline.

### Key structural differences

1. **Pi has no inline list picker pattern.** Pi's session navigation is a
   full-screen `TreeSelectorComponent` inside its `chatContainer`; cortex
   tried to mimic the editor's slash-command autocomplete style and ended
   up with a pattern pi doesn't have.

2. **Pi's runtime tracks cursor in frame coordinates with explicit
   viewport math.** Pi's `tui.ts:898-902` defines:

   ```ts
   const computeLineDiff = (targetRow: number): number => {
     const currentScreenRow = hardwareCursorRow - prevViewportTop;
     const targetScreenRow = targetRow - viewportTop;
     return targetScreenRow - currentScreenRow;
   };
   ```

   Cortex's `runtime.ts:diffRedraw` uses just frame-relative deltas
   without the explicit screen-coord conversion. They're mathematically
   equivalent when `viewportTop === 0` (which is the steady state after a
   clear+home), so I don't think this is the root cause, but pi's
   bookkeeping is more disciplined.

3. **Cursor uses CURSOR_MARKER in pi, an explicit `Frame.cursor` field
   in cortex.** Pi's components emit a `CURSOR_MARKER` string in their
   rendered text where the cursor should go; the runtime extracts it via
   `extractCursorPosition` (`tui.ts:868`). Cortex returns
   `{ lines, cursor: { row, col } }`. Different conventions; both work.

## What I have changed in pursuit of the bug

These are roughly in chronological order. Some were partial fixes; some
were no-ops; the latest set is in place.

### 1. Picker layout: above editor → below editor

`packages/tui/src/app/app.ts:render()`. Originally the inline picker
rendered *between* `status` and `editorBorder`. The cursor was hidden
while the picker was active, and every navigation forced a big cursor
up-jump (often 15+ rows). Hypothesis: big upward `\x1b[NA` moves on real
terminals can drift relative to the actual cursor position. The slash
picker (which works) doesn't have this issue because it renders BELOW the
prompt cursor.

I moved the picker to render *below* the editor and kept the cursor
visible at the prompt:

```ts
const lines: string[] = [
  ...transcript.lines,
  ...status.lines,
  ...editorBorder.lines,
  ...editor.lines,
  ...overlayFrame.lines,  // ← picker now here
  ...footer.lines,
];
```

User report: still buggy.

### 2. `runtime.invalidate("clear")` mode

`packages/tui/src/runtime.ts:invalidate()`. Added a `"clear"` mode that
forces the next render to do a full clear+rewrite rather than a diff. The
picker's open/close path uses this:

```ts
this.runtime.invalidate("clear");
```

(See `app.ts` in `openSessionPicker`, the model open handler, and the auth
open handler.)

### 3. Multiple iterations of the clear sequence itself

I went through three versions:

- **v1**: `CLEAR_SCREEN` constant (`\x1b[2J\x1b[H`). Same as pre-fix.
- **v2**: Added explicit per-row clearing — emit `\x1b[H`, then walk every
  row emitting `\x1b[2K` + `\x1b[B` (to avoid `\r\n` scrolling at the
  bottom edge), then `\x1b[H` again.
- **v3 (current)**: Match pi's `tui.ts:921` exactly — `\x1b[2J\x1b[H\x1b[3J`.
  The crucial piece is `\x1b[3J` (Erase Saved Lines) which clears the
  scrollback buffer in addition to the visible viewport.

User report: still buggy with all three.

### 4. Cursor visibility moved outside the sync block

`packages/tui/src/runtime.ts:fullRedraw` and `diffRedraw`. Pi
(`tui.ts:920` and `:1071`) wraps only the content writes inside
`\x1b[?2026h`/`l`; cursor hide/show happens as separate writes outside
the sync block.

Cortex was bundling `HIDE_CURSOR` (`\x1b[?25l`) inside the sync block at
the start, and `SHOW_CURSOR` was being emitted by `applyCursor` inside
the sync too. iTerm2 has historically handled cursor-visibility
transitions inside a sync block unpredictably.

I now emit `HIDE_CURSOR` as a separate write before `SYNC_BEGIN`, and
`applyCursor` (which may emit `SHOW_CURSOR`) as a separate write after
`SYNC_END`.

User report: still buggy.

### 5. Brute-force per-keystroke clear (later reverted)

Tried calling `runtime.invalidate("clear")` on every input event the
picker consumes — guaranteed full clear+rewrite per arrow press. User
reported still buggy with this in place. I reverted it as part of the
pi-matching refactor since it should have been redundant with a working
diff path.

### 6. `\x1b[2B`/`\x1b[2A` interpretation as relative moves

I considered switching the diff redraw to absolute cursor positioning
(`\x1b[r;cH`) to eliminate any drift between the runtime's tracked
cursor row and the terminal's actual cursor. Did **not** ship this
because it requires the runtime to know the frame's anchor row in
absolute terminal coords, and on the very first render (clear=false) the
frame is anchored at whatever row the shell prompt cursor was on.
Tracking this needs a small refactor I didn't complete.

This is still on the table as a possible fix.

## Captured byte streams (current state)

For terminal 148×34, 30 sessions, after picker is open and cursor is at
the editor prompt (row 6), here is the byte stream emitted on the 11th
Down arrow press (selectedIndex 10 → 11). Format: ESC = `\x1b`, CR =
`\r`, LF = `\n`. ANSI codes broken out for clarity.

```
ESC[?25l                  ← HIDE_CURSOR (separate write, outside sync)
ESC[?2026h                ← SYNC_BEGIN
ESC[2B CR                 ← cursor down 2 (frame row 6 → 8), col 0
ESC[2K [content row 8]    ← clear line + write
CRLF ESC[2K [row 9]
... 9 more rows ...
CRLF ESC[2K [(12/30)]     ← indicator at row 18
ESC[?2026l                ← SYNC_END (separate write)
ESC[12A ESC[3G ESC[?25h   ← cursor up 12 (back to row 6, col 3), SHOW_CURSOR
                            (separate write, applyCursor's output)
```

In our VT emulator, this produces:

- Frame rows 8–17 contain the new picker session entries.
- Row 18 contains the new indicator `(12/30)`.
- Rows 6, 7, 19, 20–22 unchanged (editor prompt, picker.header, footer).
- No duplication, no stale rows.

On the user's real iTerm2, somehow, the rows 8–18 from the previous
render survive the new render's overwrite. **I don't know why.**

## Picker render shape

`SessionSelector.render(ctx)` produces a `Frame` of:

- Row 0: `Resume session — ↑/↓ select, Enter resume, Esc cancel`
  (muted, picker header).
- Rows 1..N: up to `maxVisible` session rows, prefixed `→ ` if selected,
  `  ` otherwise.
- Last row: `(selectedIndex+1/total)` indicator (only when window is
  clipped).

`maxVisible = max(3, min(10, floor(ctx.height / 3)))`. For ctx.height=34
that's 10. With 30 sessions, indicator is always shown.

`scoreEntry`-style window centering is from `chrome.ts:computeScrollWindow`:

```ts
const startIndex = Math.max(0, Math.min(
  selectedIndex - Math.floor(maxVisible / 2),
  total - maxVisible
));
```

For selIdx=11, that's `max(0, min(6, 20)) = 6`, window = `[6..15]`. The
window is constant size; the frame is constant size at every selectedIndex
when total > maxVisible.

## Hypotheses I haven't been able to disprove

1. **iTerm2 sync mode bug**: iTerm2's implementation of synchronized
   output mode may have edge cases that produce the artifact. Try
   running cortex with sync mode disabled and see if the bug persists.

2. **Auto-wrap at exactly column width**: If any rendered line exceeds
   `ctx.width` cells (due to a `visibleWidth` miscalculation around a
   special character), iTerm2 would auto-wrap, shifting subsequent rows
   down by 1. This would accumulate over multiple renders. Worth
   instrumenting `visibleWidth` to assert each line is exactly
   `ctx.width` cells before emitting.

3. **Kitty keyboard protocol response interference**: Cortex enables the
   kitty keyboard protocol with flag 7 (`\x1b[>7u`) at startup. Maybe
   one of the protocol-response sequences is being interpreted by the
   runtime as a cursor move, shifting the runtime's tracking out of sync
   with the actual cursor position. Worth dumping all stdin sequences
   while reproducing.

4. **A render is happening that I'm not accounting for**: maybe an extra
   `invalidate()` is fired between user keystrokes that I'm not seeing
   in tests. Worth instrumenting `runtime.renderNow()` to log every call.

## What pi clearly does differently

These are not necessarily related to the bug — they are pi's actual
patterns that cortex doesn't fully match yet:

- **Pi tracks `previousViewportTop` more carefully.** Pi maintains
  `previousViewportTop` across renders and uses it in the diff math.
  Cortex's `prevViewportTop` is updated similarly, but pi's
  `computeLineDiff` makes the screen-coord conversion explicit.

- **Pi uses `\x1b[3J` (Erase Saved Lines) on every full-clear render.**
  Cortex now does too (after fix #3), but only on `invalidate("clear")`
  paths.

- **Pi never enables alt-screen** but DOES erase scrollback aggressively,
  which is a different model from cortex's "preserve all scrollback"
  approach.

- **Pi keeps the cursor hidden by default** (`showHardwareCursor=false`).
  Cortex shows the cursor at the editor prompt. Pi's `positionHardwareCursor`
  hides at the end of every render.

- **Pi's render is two-phase**: render to lines first, composite overlays,
  extract cursor marker, apply line resets, THEN do the differential
  output. Cortex does it in one pass.

## Suggested next steps

1. **Reproduce in tmux/screen with `script` recording.** `script -fq /tmp/cortex.typescript bun run cortex`. After reproducing, examine the typescript file with `cat -v` or `xxd` to see the exact byte stream the user's terminal received. Compare against my captured byte stream (above) and look for any extra/missing/different bytes.

2. **Add a render counter and dump every render's byte stream.** A
   debug build of `runtime.ts` that writes each render's output to a
   side log (with `prevLines.length`, `lines.length`, `firstChanged`,
   `lastChanged`, and the actual buffer content) would tell us
   immediately whether the runtime is misbehaving or whether the
   terminal is.

3. **Try absolute cursor positioning.** Track `frameAnchorRow` in the
   runtime (set to 0 after `\x1b[2J\x1b[H\x1b[3J`); replace `\x1b[NA`/
   `\x1b[NB` with `\x1b[<row>;<col>H` everywhere. This eliminates one
   whole class of cursor-tracking-vs-actual drift bugs.

4. **Or, abandon the inline picker and do what pi does: a modal-style
   centered overlay** (cortex's old `centerModal` path). The user
   explicitly said they didn't like the modal because of truncation on
   short terminals; that could be solved with proper scrolling inside
   the modal. Pi's `TreeSelectorComponent` does exactly this.

5. **Or, render the picker INSIDE `Editor.render()`** the way the
   slash-command autocomplete works (which we know renders correctly).
   That would mean SessionSelector is no longer a sibling of the editor
   but a passenger of it. The cursor stays at the prompt; picker rows
   appear after the prompt; everything is inside the editor's frame.

## Where to start reading

- `packages/tui/src/runtime.ts` — entire file is ~470 lines.
  - `renderNow()` (line ~210) — render entry point.
  - `fullRedraw()` (line ~258) — clear+rewrite path.
  - `diffRedraw()` (line ~302) — incremental update path.
  - `applyCursor()` (line ~420) — cursor positioning.
  - `invalidate(forceFullRedraw)` (line ~120) — re-render trigger.

- `packages/tui/src/app/app.ts` — `CortexApp.render()` at line ~128 for
  frame layout; `handleInput()` at line ~157 for input routing;
  `openSessionPicker()` at line ~878 for the picker open path;
  `activeOverlay()` at line ~170 for overlay selection.

- `packages/tui/src/app/sessionSelector.ts` — full component, uses
  `renderInlinePicker<T>` from chrome.ts.

- `packages/tui/src/app/chrome.ts` — `renderInlinePicker` at line ~10ish
  and `computeScrollWindow` at line ~100ish.

- Pi reference for diffs:
  - `pi-mono/packages/tui/src/tui.ts:888-1200` — the `doRender` method
    that handles full and diff redraws.
  - `pi-mono/packages/tui/src/tui.ts:920-942` — pi's `fullRender` helper
    inside `doRender`.

## Tests

`bun test` — 157/157 passing on the current branch. The duplication bug
is **not** caught by any test because our `FakeTerminal` + VT emulator
produces clean output for the same byte stream that breaks on iTerm2.

Visual smoke tests of the inline picker are in
`packages/tui/src/app/sessionSelector.test.ts` and
`packages/tui/src/app/state.test.ts`.

## Contact / context

The user has expressed frustration that "we have a reference
implementation [pi] to copy" but cortex still has this bug. The user
explicitly does not want hand-rolled abstractions where pi has a
proven pattern — bug-for-bug compatibility with pi is preferred over
"clever" cortex-specific approaches.
