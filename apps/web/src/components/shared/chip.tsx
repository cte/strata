import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A quiet, sentence-case metadata chip.
 *
 * Unlike `Badge` (which forces the uppercase, letter-spaced "eyebrow" treatment
 * meant for terse status tags), `Chip` is for content metadata — owner, date,
 * source, confidence — where readability matters and the text may be a phrase.
 * It truncates gracefully and pairs with a leading icon.
 */

const toneClasses = {
  neutral: "border-hairline bg-surface-2 text-fg-dim",
  accent: "border-good/30 bg-good/[0.08] text-good",
  warning: "border-warn/30 bg-warn/[0.08] text-warn",
  bad: "border-bad/30 bg-bad/[0.08] text-bad",
} as const;

export interface ChipProps extends React.ComponentProps<"span"> {
  tone?: keyof typeof toneClasses;
  icon?: React.ReactNode;
}

export function Chip({
  className,
  tone = "neutral",
  icon,
  children,
  ...props
}: ChipProps): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full items-center gap-1 rounded border px-1.5 text-xs leading-none font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {icon ? <span className="shrink-0 [&_svg]:block">{icon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
