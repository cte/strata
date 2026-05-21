import { FileText, FolderClosed, Terminal } from "lucide-react";
import type * as React from "react";
import type { AutocompleteItem } from "@/lib/useAutocomplete";
import { cn } from "@/lib/utils";

export interface AutocompletePopoverProps {
  open: boolean;
  items: readonly AutocompleteItem[];
  selectedIndex: number;
  anchorRect: DOMRect | null;
  onAccept(index: number): void;
  onSelect(index: number): void;
}

const POPOVER_WIDTH = 520;

export function AutocompletePopover({
  open,
  items,
  selectedIndex,
  anchorRect,
  onAccept,
  onSelect,
}: AutocompletePopoverProps): React.ReactElement | null {
  if (!open || items.length === 0) {
    return null;
  }
  const style = popoverStyle(anchorRect);
  return (
    <div
      role="listbox"
      aria-label="Suggestions"
      className="fixed z-50 max-h-64 w-[min(520px,calc(100vw-2rem))] overflow-y-auto rounded-md border border-[var(--hairline-strong)] bg-[var(--surface)] p-1.5 shadow-2xl shadow-black/35"
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={`${item.value}:${index}`}
            type="button"
            role="option"
            aria-selected={selected}
            className={cn(
              "flex w-full min-w-0 items-center gap-2 rounded px-2.5 py-2 text-left transition-colors duration-100",
              selected
                ? "bg-[var(--accent-soft)] text-[var(--fg)]"
                : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]",
            )}
            onMouseEnter={() => onSelect(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onAccept(index);
            }}
          >
            <SuggestionIcon kind={item.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-5 text-[var(--fg)]">
                {item.label}
              </span>
              {item.description === undefined ? null : (
                <span className="block truncate font-mono text-[11px] leading-4 text-[var(--fg-mute)]">
                  {item.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SuggestionIcon({ kind }: { kind: string | undefined }): React.ReactElement {
  const className = "h-3.5 w-3.5 shrink-0 text-[var(--accent)]";
  if (kind === "directory") {
    return <FolderClosed className={className} strokeWidth={1.75} />;
  }
  if (kind === "command") {
    return <Terminal className={className} strokeWidth={1.75} />;
  }
  return <FileText className={className} strokeWidth={1.75} />;
}

function popoverStyle(anchorRect: DOMRect | null): React.CSSProperties {
  if (typeof window === "undefined" || anchorRect === null) {
    return { bottom: "5.75rem", left: "1rem" };
  }
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 32);
  const left = Math.min(
    Math.max(anchorRect.left, 16),
    Math.max(16, window.innerWidth - width - 16),
  );
  const top = Math.max(12, anchorRect.top - 10);
  return {
    left,
    top,
    transform: "translateY(-100%)",
  };
}
