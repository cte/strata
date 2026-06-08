import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>): React.ReactElement {
  return (
    <ProgressPrimitive.Root value={value} {...props}>
      <ProgressPrimitive.Track
        className={cn("relative h-2 w-full overflow-hidden rounded-full bg-accent/20", className)}
      >
        <ProgressPrimitive.Indicator className="h-full bg-accent transition-all" />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
