import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A compact inline checkbox + label row. This is the shared replacement for the
 * `Toggle` helper that was copy-pasted into the connector operation panel and
 * the Slack connector page. Use it for the many small "include X" / "allow Y"
 * boolean options where a full Radix `Switch` would be too heavy. For a single
 * prominent enabled/disabled control prefer `Switch`.
 */
export function CheckToggle({
  checked,
  label,
  onChange,
  disabled = false,
  className,
}: {
  checked: boolean;
  label: React.ReactNode;
  onChange(value: boolean): void;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-xs text-fg-dim",
        disabled && "opacity-50",
        className,
      )}
    >
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}
