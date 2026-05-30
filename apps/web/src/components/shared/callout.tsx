import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bordered notice block — the single source of truth for the error/status
 * banners that were previously copy-pasted across routes. Pass a short mono
 * `label` (e.g. "actions error") and the message as children.
 */

const toneClasses = {
  bad: "border-bad/40 bg-bad/[0.06]",
  warn: "border-warn/40 bg-warn/[0.06]",
  good: "border-good/40 bg-good/[0.06]",
  neutral: "border-hairline bg-surface",
} as const;

const labelColor = {
  bad: "text-bad",
  warn: "text-warn",
  good: "text-good",
  neutral: "text-fg-mute",
} as const;

export interface CalloutProps extends React.ComponentProps<"div"> {
  tone?: keyof typeof toneClasses;
  label?: React.ReactNode;
}

export function Callout({
  tone = "bad",
  label,
  className,
  children,
  ...props
}: CalloutProps): React.ReactElement {
  return (
    <div className={cn("rounded-md border p-3", toneClasses[tone], className)} {...props}>
      {label ? <p className={cn("font-mono text-xs", labelColor[tone])}>{label}</p> : null}
      {children !== undefined && children !== null ? (
        <div className={cn("text-sm text-fg-dim", label ? "mt-1" : undefined)}>{children}</div>
      ) : null}
    </div>
  );
}
