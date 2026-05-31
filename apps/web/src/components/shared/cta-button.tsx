import { ArrowUpRight } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ size?: number }>;

export interface CtaButtonProps extends React.ComponentProps<typeof Button> {
  /** Icon rendered inside the animated circle. Defaults to an up-right arrow. */
  icon?: IconComponent;
}

/**
 * Prominent call-to-action pill. The label sits left of a circular icon; on
 * hover the icon slides across to the left edge and rotates while the label
 * shifts right. Built on the shadcn primary <Button> so it keeps focus,
 * disabled, and the accent fill, and uses our operator-console tokens. Pass
 * `className="w-full"` to stretch it (e.g. the lock screen).
 */
export function CtaButton({
  children,
  className,
  icon: Icon = ArrowUpRight,
  ...props
}: CtaButtonProps): React.ReactElement {
  return (
    <Button
      className={cn(
        "group relative h-12 w-fit overflow-hidden rounded-full p-1 ps-6 pe-14 text-sm font-medium transition-all duration-500 hover:ps-14 hover:pe-6",
        className,
      )}
      {...props}
    >
      <span className="relative z-10 transition-all duration-500">{children}</span>
      <span className="absolute right-1 flex h-10 w-10 items-center justify-center rounded-full bg-bg text-fg transition-all duration-500 group-hover:right-[calc(100%-44px)] group-hover:rotate-45">
        <Icon size={16} />
      </span>
    </Button>
  );
}
