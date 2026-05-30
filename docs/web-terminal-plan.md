# Strata Web Terminal Plan

Status: clean-room PTY prototype live; Ghostty/libghostty WASM is loaded by default in `/chat`; transport is HTTP/SSE plus POST input/resize.

This plan covers the experimental terminal surface inside `apps/web`. It is subordinate to [roadmap.md](./roadmap.md), [web-chat-plan.md](./web-chat-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md).

## Direction

Strata should own a small terminal stack rather than import, fork, or vendor `ghostty-web`/xterm.js. Use `/home/exedev/Documents/ghostty-web` as a reference implementation only. The implementation should be clean-room Strata code, with similar architectural ideas where useful (libghostty-style WASM ABI boundary, xterm-like browser API, renderer/input split), but no copied source, imported package, or vendored package. The first pass is deliberately timeboxed:

- `packages/terminal-web`: browser terminal emulator API, Ghostty/libghostty WASM loader and snapshot adapter, fallback parser/screen model, renderer, input mapper, and a Strata-owned libghostty-style WASM ABI boundary.
- `packages/terminal-backend`: local PTY shell session management plus HTTP/SSE bridge primitives.
- `packages/web-api`: thin local HTTP route mounting for the terminal bridge.
- `apps/web`: chat-side terminal panel.

The terminal is a local operations surface, not an agent tool and not part of the agent loop. It must not automatically write terminal input/output into wiki pages, traces, memory, or proposals.

## Current Prototype

The current prototype provides:

- a minimal xterm-like `Terminal` class owned by Strata, now capable of loading a Strata-owned Ghostty/libghostty WASM artifact asynchronously and falling back to the handwritten emulator if that load fails;
- a Strata-owned parser/screen/DOM-renderer/input split with focused ANSI/input tests;
- a Strata-owned libghostty-style WASM ABI boundary (`GhosttyWasmTerminal`) that owns lifecycle, memory allocation, write forwarding, render-state viewport/scrollback decoding, grapheme/hyperlink lookups, terminal mode reads, and snapshot conversion against mocked exports plus the bundled real artifact;
- `packages/terminal-web/assets/ghostty-vt.wasm`, generated from the sibling `../ghostty-web` reference checkout through `packages/terminal-web/scripts/build-ghostty-wasm.sh`; `ghostty-web` remains a reference/build source only, not an imported or vendored package;
- DOM rendering with cursor, volatile in-memory scrollback, SGR text attributes/colors, OSC 8 hyperlinks, basic scrolling, CR/LF/backspace/tab handling, erase modes, DEC alternate-screen switching, scroll regions, bracketed paste mode, application-cursor mode, basic SGR mouse mode, and a still-small CSI/private-mode subset for the fallback emulator;
- browser keyboard input mapped to shell-ish byte sequences, richer function/navigation key handling, application-cursor arrows, basic SGR mouse packets, paste wrapped when the shell enables bracketed paste, and Ctrl+C deferring to browser copy only for terminal-contained selections;
- `@strata/terminal-backend` local PTY-backed shell sessions, PTY resize, and SSE-friendly output frames;
- local web API terminal routes: `POST /api/terminal/sessions`, `GET /api/terminal/sessions/:sessionId/stream`, `POST /api/terminal/sessions/:sessionId/input`, `POST /api/terminal/sessions/:sessionId/resize`, and `DELETE /api/terminal/sessions/:sessionId`, mounted as a thin adapter over `@strata/terminal-backend`;
- a chat toolbar button that opens a terminal side panel using the HTTP/SSE transport. The chat surface is a shadcn `ResizablePanelGroup` (over `react-resizable-panels`); the chat and terminal are sibling `ResizablePanel`s split by a draggable `ResizableHandle`, with the split persisted via the group's `autoSaveId`. The chat panel is `collapsible`, so the panel's maximize/restore control collapses/expands it (kept in sync with manual drags via `onCollapse`/`onExpand`). The terminal panel itself carries in-panel font-size controls (persisted to `localStorage`, re-fits the PTY grid), clear-screen (Ctrl+L) and restart-session controls, a connection status dot with the shell path, and a session-ended/error overlay with an inline restart action. Session lifecycle, transport, and the imperative controls live in the `useTerminalSession` hook so `TerminalPanel` is layout-only. Note: the shadcn resizable component targets `react-resizable-panels@3` (v4 renamed the API), so that dependency is pinned to `3.0.6`.

Transport note: a WebSocket bridge was attempted first, but the public exe.dev/Vite proxy path did not reliably upgrade WebSocket connections. The current prototype deliberately uses HTTPS-compatible requests: SSE for output and POST for input, and the old WebSocket route has been removed.

Known limitations:

- the backend uses a Unix PTY host under Bun; portability beyond the current Linux VM still needs validation;
- the bundled Ghostty/libghostty artifact currently depends on the sibling `../ghostty-web` reference checkout plus its Ghostty submodule and Zig toolchain to rebuild; this is acceptable for now but should become a more explicit, repeatable Strata-owned build story;
- full-screen/curses programs still need broader browser-level and PTY fixture coverage; mouse mode distinctions, selection/copy polish, robust clipboard UX, and Unicode-width correctness need more hardening;
- no durable reconnect/session model exists; a browser refresh loses the ephemeral terminal session;
- no command/output audit UI exists.

## Next Slices

1. Add browser-level regression coverage for the `/chat` terminal smoke path: real WASM resource load, OSC 8 link rendering, Unicode/wide grapheme output, primary scrollback scrolling, resize propagation, restart, and a simple full-screen alternate-screen command.
2. Add broader tests against stable ANSI fixtures, shell transcript fixtures, and full-screen PTY command traces, comparing fallback snapshots against the Ghostty-backed behavior where practical.
3. Continue expanding terminal input behavior: selection/copy UX, mouse mode distinctions (`1000`/`1002`/`1003`), non-SGR mouse fallback if needed, richer keyboard/application-keypad modes, and robust clipboard behavior.
4. Make the Ghostty/libghostty rebuild path more repeatable inside Strata, including the exact Zig version and reference checkout assumptions.
5. Validate PTY portability beyond the current Linux exe.dev VM and decide whether to replace the embedded PTY helper with a native module or WASM-backed PTY abstraction later.
6. Decide whether to expose terminal session metadata in the web UI beyond the current ephemeral panel.

## Safety Rules

- Bind through the existing local-only web API defaults.
- Start in repo root by default.
- Show the user that this is a privileged local shell.
- Do not persist terminal scrollback unless the user explicitly asks for capture/export.
- Keep terminal code separate from `@strata/agent`; agent runs may observe terminal output only through explicit user action later, such as "send selection to chat".
