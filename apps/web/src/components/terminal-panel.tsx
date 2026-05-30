import { ChevronDown, ChevronUp, GripVertical, RotateCcw, X } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { useFloatingWindow } from "@/hooks/use-floating-window";
import {
  type TerminalSessionController,
  type TerminalStatus,
  useTerminalSession,
} from "@/hooks/use-terminal-session";
import { cn } from "@/lib/utils";

const DEFAULT_FONT = 13;
const WINDOW_KEY = "strata.terminal.window";
const HEADER_HEIGHT = 40;

const STATUS_META: Record<TerminalStatus, { label: string; dot: string }> = {
  connecting: { label: "Connecting", dot: "bg-warn animate-pulse" },
  connected: { label: "Connected", dot: "bg-good" },
  closed: { label: "Session ended", dot: "bg-fg-mute" },
  error: { label: "Connection error", dot: "bg-bad" },
};

export function TerminalPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const terminal = useTerminalSession(DEFAULT_FONT);
  const win = useFloatingWindow({
    storageKey: WINDOW_KEY,
    minWidth: 380,
    minHeight: 260,
    headerHeight: HEADER_HEIGHT,
  });

  const meta = STATUS_META[terminal.status];

  return (
    <aside
      style={win.style}
      className={cn(
        "z-30 flex min-h-0 flex-col overflow-hidden rounded-xl border border-hairline-strong",
        // Translucent, frosted backdrop: the chat surface shows through.
        "bg-bg-elev/75 shadow-2xl shadow-black/40 backdrop-blur-xl backdrop-saturate-150",
        win.isDragging && "select-none",
      )}
      aria-label="Terminal window"
    >
      <header
        {...win.dragHandleProps}
        onDoubleClick={win.toggleCollapsed}
        className="flex h-10 shrink-0 items-center gap-2 border-hairline border-b pr-1.5 pl-2"
      >
        <GripVertical size={14} strokeWidth={1.75} className="shrink-0 text-fg-mute" aria-hidden />
        <span
          className={cn("size-2 shrink-0 rounded-full", meta.dot)}
          title={meta.label}
          aria-hidden
        />
        <span className="text-sm font-medium text-fg">Terminal</span>
        {terminal.shell !== null ? (
          <span className="min-w-0 truncate text-2xs text-fg-mute" title={terminal.shell}>
            {terminal.shell}
          </span>
        ) : (
          <span className="text-2xs text-fg-mute">{meta.label}</span>
        )}

        <div className="ml-auto flex items-center gap-0.5" data-no-drag>
          {!win.collapsed ? (
            <ToolbarButton label="Restart session" onClick={terminal.restart}>
              <RotateCcw size={14} strokeWidth={1.75} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            label={win.collapsed ? "Expand terminal" : "Collapse terminal"}
            onClick={win.toggleCollapsed}
          >
            {win.collapsed ? (
              <ChevronUp size={14} strokeWidth={1.75} />
            ) : (
              <ChevronDown size={14} strokeWidth={1.75} />
            )}
          </ToolbarButton>
          <ToolbarButton label="Close terminal" onClick={onClose}>
            <X size={14} strokeWidth={1.75} />
          </ToolbarButton>
        </div>
      </header>

      {/* Keep the session mounted while collapsed so the PTY survives. */}
      <div className={cn("relative min-h-0 flex-1", win.collapsed && "hidden")}>
        <div ref={terminal.containerRef} className="absolute inset-0 overflow-hidden" />
        <SessionOverlay status={terminal.status} onRestart={terminal.restart} />
      </div>

      {!win.collapsed ? (
        <button
          {...win.resizeHandleProps}
          type="button"
          aria-label="Resize terminal"
          className="group absolute right-0 bottom-0 z-10 flex size-4 cursor-nwse-resize items-end justify-end p-1 touch-none"
        >
          <svg
            viewBox="0 0 10 10"
            className="size-2.5 text-fg-mute/70 group-hover:text-fg-dim"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.25}
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M9 1 1 9" />
            <path d="M9 5 5 9" />
          </svg>
        </button>
      ) : null}
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
