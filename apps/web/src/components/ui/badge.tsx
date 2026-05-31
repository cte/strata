import type * as React from "react";
import { cn } from "@/lib/utils";

// Soft "tinted pill" status badges: a translucent fill in the tone color, a
// solid dot (inherits the tone via `.dot`'s currentColor), and sentence-case
// colored text. `muted` is the neutral grey variant.
const toneClasses = {
  ready: "bg-good/10 text-good",
  warning: "bg-warn/10 text-warn",
  bad: "bg-bad/10 text-bad",
  muted: "bg-surface-2 text-fg-dim",
};

export interface BadgeProps extends React.ComponentProps<"span"> {
  tone?: keyof typeof toneClasses;
  pulse?: boolean;
}

export function Badge({
  className,
  tone = "muted",
  pulse = false,
  children,
  ...props
}: BadgeProps): React.ReactElement {
  const showPulse = pulse && tone === "ready";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-2xs font-medium uppercase tracking-wide leading-none",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <span className={cn("dot", showPulse && "dot-pulse")} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
