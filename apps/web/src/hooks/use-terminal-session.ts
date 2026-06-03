import { Terminal } from "@strata/terminal-web";
import * as React from "react";

export type TerminalStatus = "connecting" | "connected" | "reconnecting" | "closed" | "error";

interface TerminalSessionResponse {
  id: string;
  shell: string;
  cols: number;
  rows: number;
}

interface TerminalFrame {
  event: string;
  data: unknown;
}

const STREAM_STALE_MS = 45_000;
const STREAM_RECONNECT_DELAY_MS = 1_000;
const STREAM_MAX_RECONNECT_DELAY_MS = 10_000;

export interface TerminalSessionController {
  /** Attach to the element that should host the terminal viewport. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  status: TerminalStatus;
  /** The login shell reported by the backend, once connected. */
  shell: string | null;
  /** Tear down the current PTY session and start a fresh one. */
  restart: () => void;
  /** Clear the screen and redraw the prompt (sends Ctrl+L to the shell). */
  clear: () => void;
  /** Move keyboard focus into the terminal. */
  focus: () => void;
  /** Resize the rendered font and re-fit the PTY grid to the viewport. */
  setFontSize: (px: number) => void;
}

/**
 * Owns the lifecycle of a single backend PTY session and its browser-side
 * {@link Terminal} emulator: HTTP/SSE transport, fit-on-resize, and the
 * imperative controls (restart, clear, focus, font size) the panel exposes.
 */
export function useTerminalSession(initialFontSize: number): TerminalSessionController {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = React.useState<TerminalStatus>("connecting");
  const [shell, setShell] = React.useState<string | null>(null);
  const [generation, setGeneration] = React.useState(0);

  const terminalRef = React.useRef<Terminal | null>(null);
  const sendInputRef = React.useRef<(data: string) => void>(() => {});
  const fitRef = React.useRef<() => void>(() => {});
  const fontSizeRef = React.useRef(initialFontSize);

  React.useEffect(() => {
    const host = containerRef.current;
    if (host === null) return;

    const abort = new AbortController();
    let disposed = false;
    let sessionId: string | null = null;
    let lastSentSizeKey: string | null = null;
    let latestSize = { cols: 96, rows: 24 };
    let terminalClosed = false;

    const terminal = new Terminal({
      cols: 96,
      rows: 24,
      emulator: "ghostty",
      fontSize: fontSizeRef.current,
      // Drives the DOM renderer's inline `font-family`. The CSS var (defined in
      // globals.css) uses the self-hosted "GeistMono Nerd Font Mono" so shell
      // prompt glyphs (Powerline/Nerd Font icons) render, falling back to the
      // Google-hosted Geist Mono for ordinary text.
      fontFamily: "var(--font-mono-terminal)",
      // The docked panel paints its own backdrop; keep the emulator root
      // transparent so it shows through.
      rootBackground: "transparent",
    });
    terminalRef.current = terminal;
    terminal.open(host);
    setStatus("connecting");
    setShell(null);

    const sendInput = async (data: string) => {
      if (disposed || sessionId === null) return;
      await fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data }),
        signal: abort.signal,
        credentials: "same-origin",
      }).catch(() => {
        if (!disposed) setStatus("error");
      });
    };
    sendInputRef.current = (data) => {
      void sendInput(data);
    };

    const sendResize = async (size: { cols: number; rows: number }) => {
      if (disposed || sessionId === null) return;
      await fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/resize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(size),
        signal: abort.signal,
        credentials: "same-origin",
      }).catch(() => {
        if (!disposed) setStatus("error");
      });
    };

    const fitAndSyncResize = () => {
      if (disposed) return;
      // While the panel is minimized (collapsed to a zero-height host) the PTY
      // session stays alive; skip fitting so we don't push a 0-row resize that
      // would reflow the shell. We re-fit when the host regains size.
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      latestSize = terminal.fit();
      const nextKey = sizeKey(latestSize);
      if (sessionId === null || nextKey === lastSentSizeKey) return;
      lastSentSizeKey = nextKey;
      void sendResize(latestSize);
    };
    fitRef.current = fitAndSyncResize;

    const dataSub = terminal.onData((data) => {
      void sendInput(data);
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => fitAndSyncResize());
      resizeObserver.observe(host);
    }
    window.addEventListener("resize", fitAndSyncResize);
    window.requestAnimationFrame(fitAndSyncResize);

    void (async () => {
      try {
        latestSize = terminal.fit();
        const created = await fetch("/api/terminal/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(latestSize),
          signal: abort.signal,
          credentials: "same-origin",
        });
        if (!created.ok) throw new Error(`create failed ${created.status}`);
        const session = (await created.json()) as TerminalSessionResponse;
        if (disposed) return;
        sessionId = session.id;
        lastSentSizeKey = sizeKey({ cols: session.cols, rows: session.rows });
        setShell(session.shell);
        fitAndSyncResize();
        setStatus("connected");
        terminal.focus();
        await streamTerminalWithReconnect(
          session.id,
          abort.signal,
          (frame) => {
            if (disposed) return;
            if (frame.event === "stdout" || frame.event === "stderr") {
              if (typeof frame.data === "string") terminal.write(frame.data);
              return;
            }
            if (frame.event === "closed") {
              terminalClosed = true;
              setStatus("closed");
            }
          },
          (state) => {
            if (disposed || terminalClosed) return;
            setStatus(state);
          },
          () => terminalClosed,
        );
      } catch (error: unknown) {
        if (disposed || abort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus("error");
        terminal.write(`\r\n[terminal connection error: ${message}]\r\n`);
      }
    })();

    return () => {
      disposed = true;
      dataSub.dispose();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", fitAndSyncResize);
      abort.abort();
      const id = sessionId;
      if (id !== null) {
        void fetch(`/api/terminal/sessions/${encodeURIComponent(id)}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
      }
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [generation]);

  const restart = React.useCallback(() => setGeneration((value) => value + 1), []);
  const clear = React.useCallback(() => sendInputRef.current("\f"), []);
  const focus = React.useCallback(() => terminalRef.current?.focus(), []);
  const setFontSize = React.useCallback((px: number) => {
    fontSizeRef.current = px;
    terminalRef.current?.setFontSize(px);
    fitRef.current();
  }, []);

  return { containerRef, status, shell, restart, clear, focus, setFontSize };
}

async function streamTerminalWithReconnect(
  sessionId: string,
  signal: AbortSignal,
  onFrame: (frame: TerminalFrame) => void,
  onState: (state: "connected" | "reconnecting") => void,
  shouldStop: () => boolean,
): Promise<void> {
  let retryDelay = STREAM_RECONNECT_DELAY_MS;
  while (!signal.aborted && !shouldStop()) {
    try {
      await streamTerminal(sessionId, signal, (frame) => {
        if (frame.event === "ready") {
          retryDelay = STREAM_RECONNECT_DELAY_MS;
          onState("connected");
        }
        onFrame(frame);
      });
      if (!signal.aborted && !shouldStop()) onState("reconnecting");
    } catch (error: unknown) {
      if (signal.aborted || shouldStop()) return;
      if (isTerminalSessionGone(error)) throw error;
      onState("reconnecting");
    }
    if (signal.aborted || shouldStop()) break;
    await delay(retryDelay, signal);
    retryDelay = Math.min(retryDelay * 2, STREAM_MAX_RECONNECT_DELAY_MS);
  }
}

async function streamTerminal(
  sessionId: string,
  signal: AbortSignal,
  onFrame: (frame: TerminalFrame) => void,
): Promise<void> {
  const response = await fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/stream`, {
    signal,
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`stream failed ${response.status}`);
  if (response.body === null) throw new Error("stream body missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetStaleTimer = () => {
    if (staleTimer !== undefined) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      void reader.cancel(new Error("terminal stream heartbeat timed out"));
    }, STREAM_STALE_MS);
  };
  resetStaleTimer();
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      resetStaleTimer();
      buffer += decoder.decode(next.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const frame = parseSseFrame(part);
        if (frame !== null) onFrame(frame);
      }
    }
  } finally {
    if (staleTimer !== undefined) clearTimeout(staleTimer);
    reader.releaseLock();
  }
}

function isTerminalSessionGone(error: unknown): boolean {
  return error instanceof Error && /stream failed 404/.test(error.message);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function sizeKey(size: { cols: number; rows: number }): string {
  return `${size.cols}x${size.rows}`;
}

function parseSseFrame(frame: string): TerminalFrame | null {
  const event = frame
    .split("\n")
    .find((line) => line.startsWith("event: "))
    ?.slice("event: ".length);
  const data = frame
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  if (event === undefined || data === undefined) return null;
  return { event, data: JSON.parse(data) as unknown };
}
