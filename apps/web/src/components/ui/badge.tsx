import type * as React from "react";
import { cn } from "@/lib/utils";

const toneClasses = {
  ready: "text-[var(--good)]",
  warning: "text-[var(--warn)]",
  muted: "text-[var(--fg-mute)]",
  bad: "text-[var(--bad)]",
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
        "label-eyebrow inline-flex items-center gap-2 whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <span className={cn("dot", showPulse && "dot-pulse")} />
      <span>{children}</span>
    </span>
  );
}
