# Strata Web Terminal Plan

Status: clean-room PTY prototype live; transport is HTTP/SSE plus POST input/resize.

This plan covers the experimental terminal surface inside `apps/web`. It is subordinate to [roadmap.md](./roadmap.md), [web-chat-plan.md](./web-chat-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md).

## Direction

Strata should own a small terminal stack rather than import, fork, or vendor `ghostty-web`/xterm.js. Use `/home/exedev/Documents/ghostty-web` as a reference implementation only. The implementation should be clean-room Strata code, with similar architectural ideas where useful (WASM-backed VT parser boundary, xterm-like browser API, renderer/input split), but no copied source or vendored package. The first pass is deliberately timeboxed:

- `packages/terminal-web`: browser terminal emulator API, parser/screen model, renderer, and input mapper; eventually reimplemented around a Ghostty/libghostty-style WASM VT parser boundary.
- `packages/terminal-backend`: local PTY shell session management plus HTTP/SSE bridge primitives.
- `packages/web-api`: thin local HTTP route mounting for the terminal bridge.
- `apps/web`: chat-side terminal panel.

The terminal is a local operations surface, not an agent tool and not part of the agent loop. It must not automatically write terminal input/output into wiki pages, traces, memory, or proposals.

## Current Prototype

The initial prototype provides:

- a minimal xterm-like `Terminal` class owned by Strata, currently handwritten and not yet Ghostty/libghostty-backed;
- a Strata-owned parser/screen/DOM-renderer/input split with focused ANSI/input tests and a `GhosttyWasmParserBoundary` placeholder;
- DOM rendering with cursor, SGR text attributes/colors, basic scrolling, CR/LF/backspace/tab handling, erase modes, DEC alternate-screen switching, scroll regions, bracketed paste mode, and a still-small CSI/private-mode subset;
- browser keyboard input mapped to shell-ish byte sequences, with paste wrapped when the shell enables bracketed paste;
- `@strata/terminal-backend` local PTY-backed shell sessions, PTY resize, and SSE-friendly output frames;
- local web API terminal routes: `POST /api/terminal/sessions`, `GET /api/terminal/sessions/:sessionId/stream`, `POST /api/terminal/sessions/:sessionId/input`, `POST /api/terminal/sessions/:sessionId/resize`, and `DELETE /api/terminal/sessions/:sessionId`, mounted as a thin adapter over `@strata/terminal-backend`;
- a chat toolbar button that opens a terminal side panel using the HTTP/SSE transport.

Transport note: a WebSocket bridge was attempted first, but the public exe.dev/Vite proxy path did not reliably upgrade WebSocket connections. The current prototype deliberately uses HTTPS-compatible requests: SSE for output and POST for input, and the old WebSocket route has been removed.

Known limitations:

- the backend uses a Unix PTY host under Bun; portability beyond the current Linux VM still needs validation;
- full-screen/curses programs are still limited by the browser emulator; mouse, selection/copy polish, OSC hyperlinks, richer keyboard modes, robust clipboard UX, and Unicode-width correctness are incomplete;
- no durable reconnect/session model exists; a browser refresh loses the ephemeral terminal session;
- no command/output audit UI exists.

## Next Slices

1. Add broader tests against ANSI fixtures, shell transcript fixtures, and full-screen command traces over the PTY backend.
2. Continue expanding the emulator/parser: Unicode width, selection/copy polish, mouse modes, richer keyboard/application-cursor modes, OSC hyperlinks, and more complete alternate-screen/full-screen behavior.
3. Validate PTY portability beyond the current Linux exe.dev VM and decide whether to replace the embedded PTY helper with a native module or WASM-backed PTY abstraction later.
4. Decide whether to expose terminal session metadata in the web UI beyond the current ephemeral panel.

## Safety Rules

- Bind through the existing local-only web API defaults.
- Start in repo root by default.
- Show the user that this is a privileged local shell.
- Do not persist terminal scrollback unless the user explicitly asks for capture/export.
- Keep terminal code separate from `@strata/agent`; agent runs may observe terminal output only through explicit user action later, such as "send selection to chat".
