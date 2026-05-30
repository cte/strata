# Strata Web Terminal Plan

Status: clean-room prototype live; transport is HTTP/SSE plus POST input.

This plan covers the experimental terminal surface inside `apps/web`. It is subordinate to [roadmap.md](./roadmap.md), [web-chat-plan.md](./web-chat-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md).

## Direction

Strata should own a small terminal stack rather than fork or vendor `ghostty-web`/xterm.js. The first pass is deliberately timeboxed and clean-room:

- `packages/terminal-web`: browser terminal emulator API and renderer.
- `packages/terminal-backend`: local shell session management plus HTTP/SSE bridge primitives.
- `packages/web-api`: thin local HTTP route mounting for the terminal bridge.
- `apps/web`: chat-side terminal panel.

The terminal is a local operations surface, not an agent tool and not part of the agent loop. It must not automatically write terminal input/output into wiki pages, traces, memory, or proposals.

## Current Prototype

The initial prototype provides:

- a minimal xterm-like `Terminal` class owned by Strata;
- plain text rendering with cursor, basic scrolling, CR/LF/backspace/tab handling, and a small CSI subset;
- browser keyboard input mapped to shell-ish byte sequences;
- `@strata/terminal-backend` local shell sessions and SSE-friendly output frames;
- local web API terminal routes: `POST /api/terminal/sessions`, `GET /api/terminal/sessions/:sessionId/stream`, `POST /api/terminal/sessions/:sessionId/input`, and `DELETE /api/terminal/sessions/:sessionId`, mounted as a thin adapter over `@strata/terminal-backend`;
- a chat toolbar button that opens a terminal side panel using the HTTP/SSE transport.

Transport note: a WebSocket bridge was attempted first, but the public exe.dev/Vite proxy path did not reliably upgrade WebSocket connections. The current prototype deliberately uses HTTPS-compatible requests: SSE for output and POST for input, and the old WebSocket route has been removed.

Known limitations:

- the backend currently uses subprocess pipes, not a true PTY;
- full-screen/curses programs, resize semantics, robust remote shell echo behavior, colors, mouse, clipboard, OSC hyperlinks, alternate screen, and Unicode-width correctness are incomplete;
- no durable reconnect/session model exists; a browser refresh loses the ephemeral terminal session;
- no command/output audit UI exists.

## Next Slices

1. Replace subprocess pipes with a true PTY backend that works under Bun on the target platforms.
2. Add terminal resize messages from the browser and propagate rows/cols to the PTY.
3. Expand the emulator/parser: SGR colors, erase modes, scroll regions, alternate screen, Unicode width, bracketed paste, and selection/copy.
4. Add tests against ANSI fixtures and shell transcript fixtures.
5. Decide whether to expose terminal session metadata in the web UI beyond the current ephemeral panel.

## Safety Rules

- Bind through the existing local-only web API defaults.
- Start in repo root by default.
- Show the user that this is a privileged local shell.
- Do not persist terminal scrollback unless the user explicitly asks for capture/export.
- Keep terminal code separate from `@strata/agent`; agent runs may observe terminal output only through explicit user action later, such as "send selection to chat".
