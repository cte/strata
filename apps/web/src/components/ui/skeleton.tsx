import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loading placeholder block. Size it with height/width utilities and use it for
 * every skeleton state instead of hand-rolling `bg-surface-2` divs, so loading
 * UIs stay visually consistent. Uses the operator-console surface tint.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={cn("rounded-sm bg-surface-2", className)} {...props} />;
}

export { Skeleton };
