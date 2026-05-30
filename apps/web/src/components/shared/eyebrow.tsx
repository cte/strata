import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The canonical small uppercase "overline" label (operator-console mono style).
 * Use this for section/field/stat labels and other terse muted captions instead
 * of hand-rolled `uppercase tracking-[...]` class strings. Renders the shared
 * `.label-eyebrow` style (Geist Mono, 0.18em tracking, muted) so every
 * eyebrow across the app looks identical.
 */
export function Eyebrow({ className, ...props }: React.ComponentProps<"span">): React.ReactElement {
  return <span className={cn("label-eyebrow", className)} {...props} />;
}
