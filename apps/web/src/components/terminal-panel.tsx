import { Terminal } from "@strata/terminal-web";
import { Terminal as TerminalIcon, X } from "lucide-react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function TerminalPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const terminal = new Terminal({ cols: 96, rows: 24 });
    terminal.open(host);
    terminal.write("Strata experimental terminal\r\n");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/terminal/connect`);
    socket.binaryType = "arraybuffer";
    const dataSub = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    });
    socket.addEventListener("open", () => {
      setStatus("connected");
      terminal.focus();
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        terminal.write(event.data);
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
      }
    });
    socket.addEventListener("close", () => setStatus("closed"));
    socket.addEventListener("error", () => setStatus("error"));
    return () => {
      dataSub.dispose();
      socket.close();
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
