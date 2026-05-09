import type * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">): React.ReactElement {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-[var(--hairline)] bg-[var(--bg-elev)] px-3 text-[13px] text-[var(--fg)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[var(--fg-mute)] focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_var(--accent-soft)]",
        "font-mono",
        className,
      )}
      {...props}
    />
  );
}
