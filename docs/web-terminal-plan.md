# Strata Web Terminal Plan

Status: clean-room PTY prototype live; Ghostty/libghostty WASM is loaded by default in `/chat`; the browser renderer is a `<canvas>` renderer driven by libghostty's cells (windowed, only-changed-rows redraw); transport is HTTP/SSE plus POST input/resize.

This plan covers the experimental terminal surface inside `apps/web`. It is subordinate to [roadmap.md](./roadmap.md), [web-chat-plan.md](./web-chat-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md).

## Direction

Strata should own a small terminal stack rather than import, fork, or vendor `ghostty-web`/xterm.js. Use `/home/exedev/Documents/ghostty-web` as a reference implementation only. The implementation should be clean-room Strata code, with similar architectural ideas where useful (libghostty-style WASM ABI boundary, xterm-like browser API, renderer/input split), but no copied source, imported package, or vendored package. The first pass is deliberately timeboxed:

- `packages/terminal-web`: browser terminal emulator API, Ghostty/libghostty WASM loader and snapshot adapter, fallback parser/screen model, canvas renderer, input mapper, and a Strata-owned libghostty-style WASM ABI boundary.
- `packages/terminal-backend`: local PTY shell session management plus HTTP/SSE bridge primitives.
- `packages/web-api`: thin local HTTP route mounting for the terminal bridge.
- `apps/web`: chat-side terminal panel.

The terminal is a local operations surface, not an agent tool and not part of the agent loop. It must not automatically write terminal input/output into wiki pages, traces, memory, or proposals.

## Current Prototype

The current prototype provides:

- a minimal xterm-like `Terminal` class owned by Strata, now capable of loading a Strata-owned Ghostty/libghostty WASM artifact asynchronously and falling back to the handwritten emulator if that load fails;
- a Strata-owned parser/screen/canvas-renderer/input split with focused ANSI/input tests;
- a Strata-owned libghostty-style WASM ABI boundary (`GhosttyWasmTerminal`) that owns lifecycle, memory allocation, write forwarding, render-state viewport/scrollback decoding, grapheme/hyperlink lookups, terminal mode reads, and snapshot conversion against mocked exports plus the bundled real artifact;
- `packages/terminal-web/assets/ghostty-vt.wasm`, built reproducibly by `packages/terminal-web/scripts/build-ghostty-wasm.sh` from a pinned Ghostty commit (`GHOSTTY_COMMIT`), a vendored API patch (`scripts/ghostty-wasm-api.patch`), and the `.tool-versions`-pinned Zig (asserted at build time). The script shallow-fetches the pinned commit into a gitignored `.ghostty-build/` cache by default (override with `GHOSTTY_SOURCE_DIR` to reuse an existing Ghostty tree); a rebuild is byte-identical to the committed artifact. `ghostty-web` is no longer required to rebuild — see `packages/terminal-web/scripts/README.md`;
- canvas rendering (`TerminalCanvasRenderer`) that draws libghostty's authoritative cells to a `<canvas>`, repainting only the rows in view and only those whose content changed (windowed + incremental redraw — fast for full-screen apps and large scrollback alike), with cursor, SGR colors/text attributes, OSC 8 hyperlinks (Cmd/Ctrl-click to open), mouse-drag selection + clipboard copy, an inner content padding inset, DPI scaling, and a CSS-var-resolved monospace font (the self-hosted GeistMono Nerd Font, so Powerline/Nerd glyphs render). Follow-scroll keeps new output pinned to the bottom while scrolling up into history detaches. This replaced an earlier per-frame DOM renderer that rebuilt the whole scrollback each frame; `ghostty-web` (canvas + libghostty dirty rows) was the reference for the approach. The fallback handwritten emulator covers volatile in-memory scrollback, CR/LF/backspace/tab, erase modes, DEC alternate-screen switching, scroll regions, bracketed paste, application-cursor, and basic SGR mouse mode over a still-small CSI/private-mode subset;
- browser keyboard input mapped to shell-ish byte sequences, richer function/navigation key handling, application-cursor arrows, basic SGR mouse packets, paste wrapped when the shell enables bracketed paste, and Ctrl/Cmd+C copying the renderer's active selection (otherwise sending the normal control byte, e.g. Ctrl+C → SIGINT);
- `@strata/terminal-backend` local PTY-backed shell sessions, PTY resize, and SSE-friendly output frames;
- local web API terminal routes: `POST /api/terminal/sessions`, `GET /api/terminal/sessions/:sessionId/stream`, `POST /api/terminal/sessions/:sessionId/input`, `POST /api/terminal/sessions/:sessionId/resize`, and `DELETE /api/terminal/sessions/:sessionId`, mounted as a thin adapter over `@strata/terminal-backend`;
- a bottom-docked terminal drawer (DevTools-style) opened from a bottom-right toggle button on the chat surface. The chat surface is a vertical shadcn `ResizablePanelGroup` (over `react-resizable-panels@3`, pinned because v4 renamed the API); the chat and terminal are sibling `ResizablePanel`s split by a draggable `ResizableHandle`, with the split height persisted via the group's `autoSaveId`. The terminal panel has a restart-session control, a close control, a connection status dot with the shell path, and a session-ended/error overlay with an inline restart action; the PTY grid re-fits automatically when the panel is resized (the `useTerminalSession` hook observes the container and re-fits the canvas grid). Session lifecycle, transport, and imperative controls live in the `useTerminalSession` hook so `TerminalPanel` is layout-only.

Transport note: a WebSocket bridge was attempted first, but the public exe.dev/Vite proxy path did not reliably upgrade WebSocket connections. The current prototype deliberately uses HTTPS-compatible requests: SSE for output and POST for input, and the old WebSocket route has been removed.

Known limitations:

- the backend uses a Unix PTY host under Bun; portability beyond the current Linux VM still needs validation;
- rebuilding the bundled Ghostty/libghostty artifact still requires network access (Ghostty source at the pinned commit, its submodules, and Zig package dependencies) and the pinned Zig toolchain; the build is now self-contained and reproducible, but the cross-network clone path has not been exercised in the offline sandbox;
- full-screen/curses programs still need broader browser-level and PTY fixture coverage; mouse mode distinctions, wide/CJK glyph alignment and Unicode-width correctness, and richer selection/clipboard UX (word/line selection, auto-scroll while dragging) need more hardening (basic drag-select + copy and Cmd/Ctrl-click hyperlinks exist);
- no durable reconnect/session model exists; a browser refresh loses the ephemeral terminal session;
- no command/output audit UI exists.

## Next Slices

1. Add browser-level regression coverage for the `/chat` terminal smoke path: real WASM resource load, OSC 8 link rendering, Unicode/wide grapheme output, primary scrollback scrolling, resize propagation, restart, and a simple full-screen alternate-screen command.
2. Add broader tests against stable ANSI fixtures, shell transcript fixtures, and full-screen PTY command traces, comparing fallback snapshots against the Ghostty-backed behavior where practical.
3. Continue expanding terminal input behavior: selection/clipboard polish (word/line selection, auto-scroll while dragging), mouse mode distinctions (`1000`/`1002`/`1003`), non-SGR mouse fallback if needed, and richer keyboard/application-keypad modes. (Basic drag-select + copy, Cmd/Ctrl-click hyperlinks, and the canvas renderer are done.) Optional micro-opt: feed libghostty's exported `ghostty_render_state_is_row_dirty` into the canvas redraw instead of the JS per-row diff.
4. Done: the Ghostty/libghostty rebuild is self-contained — pinned commit + vendored patch + asserted Zig version, fetched into a gitignored cache, byte-identical on rebuild (`scripts/README.md`). Remaining: exercise the cross-network clone path on a clean machine, and consider checking the build into CI.
5. Validate PTY portability beyond the current Linux exe.dev VM and decide whether to replace the embedded PTY helper with a native module or WASM-backed PTY abstraction later.
6. Decide whether to expose terminal session metadata in the web UI beyond the current ephemeral panel.

## Safety Rules

- Bind through the existing local-only web API defaults.
- Start in repo root by default.
- Show the user that this is a privileged local shell.
- Do not persist terminal scrollback unless the user explicitly asks for capture/export.
- Keep terminal code separate from `@strata/agent`; agent runs may observe terminal output only through explicit user action later, such as "send selection to chat".
