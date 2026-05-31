import { RotateCcw, X } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  type TerminalSessionController,
  type TerminalStatus,
  useTerminalSession,
} from "@/hooks/use-terminal-session";
import { cn } from "@/lib/utils";

const DEFAULT_FONT = 13;

const STATUS_META: Record<TerminalStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "bg-warn animate-pulse" },
  connected: { label: "Connected", dot: "bg-good" },
  closed: { label: "Session ended", dot: "bg-fg-mute" },
  error: { label: "Connection error", dot: "bg-bad" },
};

/**
 * Bottom-docked terminal, styled after the browser DevTools drawer: a full-width
 * panel that fills whatever height its `ResizablePanel` host gives it. The PTY
 * grid auto-fits to the container via {@link useTerminalSession}'s ResizeObserver,
 * so dragging the panel divider re-fits the shell with no extra wiring here.
 */
export function TerminalPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const terminal = useTerminalSession(DEFAULT_FONT);
  const meta = STATUS_META[terminal.status];

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-t border-hairline bg-bg-elev"
      aria-label="Terminal"
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-hairline border-b pr-1.5 pl-3">
        <span
          className={cn("size-2 shrink-0 rounded-full", meta.dot)}
          title={meta.label}
          aria-hidden
        />
        <span className="text-xs font-medium text-fg">Terminal</span>
        {terminal.shell !== null ? (
          <span className="min-w-0 truncate text-2xs text-fg-mute" title={terminal.shell}>
            {terminal.shell}
          </span>
        ) : (
          <span className="text-2xs text-fg-mute">{meta.label}</span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          <ToolbarButton label="Restart session" onClick={terminal.restart}>
            <RotateCcw size={14} strokeWidth={1.75} />
          </ToolbarButton>
          <ToolbarButton label="Close terminal" onClick={onClose}>
            <X size={14} strokeWidth={1.75} />
          </ToolbarButton>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <div ref={terminal.containerRef} className="absolute inset-0 overflow-hidden" />
        <SessionOverlay status={terminal.status} onRestart={terminal.restart} />
      </div>
    </aside>
  );
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "size-7 text-fg-dim hover:text-fg disabled:opacity-40 [&>svg]:!size-3.5",
        className,
      )}
    >
      {children}
    </Button>
  );
}

function SessionOverlay({
  status,
  onRestart,
}: {
  status: TerminalStatus;
  onRestart: TerminalSessionController["restart"];
}): React.ReactElement | null {
  if (status !== "closed" && status !== "error") return null;
  const ended = status === "closed";
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg/70 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-3 rounded-lg border border-hairline bg-bg-elev px-6 py-5 text-center shadow-lg">
        <p className="text-sm font-medium text-fg">
          {ended ? "Session ended" : "Connection error"}
        </p>
        <p className="max-w-56 text-xs leading-5 text-fg-dim">
          {ended
            ? "The shell process exited. Start a fresh session to keep working."
            : "The terminal lost its connection to the local backend."}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onRestart} className="gap-1.5">
          <RotateCcw size={13} strokeWidth={1.75} />
          Restart session
        </Button>
      </div>
    </div>
  );
}
