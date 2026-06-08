import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card";
import type * as React from "react";

import { cn } from "@/lib/utils";

const HoverCard = PreviewCardPrimitive.Root;

const HoverCardTrigger = PreviewCardPrimitive.Trigger;

type HoverCardContentProps = React.ComponentProps<typeof PreviewCardPrimitive.Popup> & {
  align?: PreviewCardPrimitive.Positioner.Props["align"];
  side?: PreviewCardPrimitive.Positioner.Props["side"];
  sideOffset?: PreviewCardPrimitive.Positioner.Props["sideOffset"];
};

function HoverCardContent({
  className,
  align = "center",
  side,
  sideOffset = 4,
  ...props
}: HoverCardContentProps): React.ReactElement {
  return (
    <PreviewCardPrimitive.Portal>
      <PreviewCardPrimitive.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <PreviewCardPrimitive.Popup
          className={cn(
            "w-64 origin-[var(--transform-origin)] rounded-md border bg-surface p-4 text-fg shadow-md outline-none data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-closed:fill-mode-forwards data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            className,
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardContent, HoverCardTrigger };
