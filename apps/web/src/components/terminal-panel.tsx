import { Terminal } from "@strata/terminal-web";
import { Terminal as TerminalIcon, X } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface TerminalSessionResponse {
  id: string;
  shell: string;
}

interface TerminalFrame {
  event: string;
  data: unknown;
}

export function TerminalPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const abort = new AbortController();
    let disposed = false;
    let sessionId: string | null = null;
    let dataSub: { dispose: () => void } | null = null;
    const terminal = new Terminal({ cols: 96, rows: 24 });
    terminal.open(host);
    terminal.write("Strata experimental terminal\r\n");
    terminal.write("Connecting over HTTP stream\r\n");
    setStatus("connecting");

    const sendInput = async (data: string) => {
      if (disposed || sessionId === null) return;
      await fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data }),
        signal: abort.signal,
      }).catch(() => {
        if (!disposed) setStatus("input error");
      });
    };

    dataSub = terminal.onData((data) => {
      const echo = localEcho(data);
      if (echo.length > 0) terminal.write(echo);
      void sendInput(data);
    });

    void (async () => {
      try {
        const created = await fetch("/api/terminal/sessions", {
          method: "POST",
          signal: abort.signal,
        });
        if (!created.ok) throw new Error(`create failed ${created.status}`);
        const session = (await created.json()) as TerminalSessionResponse;
        if (disposed) return;
        sessionId = session.id;
        setStatus("connected");
        terminal.write(`Shell: ${session.shell}\r\n`);
        terminal.focus();
        await streamTerminal(session.id, abort.signal, (frame) => {
          if (disposed) return;
          if (frame.event === "stdout" || frame.event === "stderr") {
            if (typeof frame.data === "string") terminal.write(frame.data);
            return;
          }
          if (frame.event === "closed") {
            setStatus("closed");
          }
        });
      } catch (error: unknown) {
        if (disposed || abort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus("error");
        terminal.write(`\r\n[terminal connection error: ${message}]\r\n`);
      }
    })();

    return () => {
      disposed = true;
      dataSub?.dispose();
      abort.abort();
      const id = sessionId;
      if (id !== null) {
        void fetch(`/api/terminal/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      }
      terminal.dispose();
    };
  }, []);

  return (
    <aside className="flex min-h-0 w-full flex-col border-l border-hairline bg-bg-elev md:w-[42rem]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-hairline px-3">
        <div className="flex items-center gap-2 text-sm font-medium text-fg">
          <TerminalIcon size={14} strokeWidth={1.75} />
          Terminal
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-normal text-fg-dim">
            {status}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close terminal"
          className="h-7 w-7 text-fg-dim hover:text-fg [&>svg]:!size-3.5"
        >
          <X size={14} strokeWidth={1.75} />
        </Button>
      </header>
      <div className="border-b border-hairline px-3 py-2 text-xs leading-5 text-fg-dim">
        Clean-room prototype: subprocess pipes only, not a PTY yet. Interactive full-screen apps
        will be rough.
      </div>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
    </aside>
  );
}

async function streamTerminal(
  sessionId: string,
  signal: AbortSignal,
  onFrame: (frame: TerminalFrame) => void,
): Promise<void> {
  const response = await fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/stream`, {
    signal,
  });
  if (!response.ok) throw new Error(`stream failed ${response.status}`);
  if (response.body === null) throw new Error("stream body missing");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const frame = parseSseFrame(part);
      if (frame !== null) onFrame(frame);
    }
  }
}

function localEcho(data: string): string {
  let echo = "";
  for (const char of data) {
    if (char === "\r") {
      echo += "\r\n";
    } else if (char === "\x7f") {
      echo += "\b \b";
    } else if (char >= " " || char === "\t") {
      echo += char;
    }
  }
  return echo;
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
