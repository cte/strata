import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

export interface ToolProps extends React.ComponentProps<"details"> {
  status?: "running" | "complete" | "error";
}

export function Tool({ status = "running", className, ...props }: ToolProps): React.ReactElement {
  return (
    <details
      className={cn(
        "group/tool border border-hairline bg-bg text-xs",
        status === "running" && "border-warn/35",
        className,
      )}
      {...props}
    />
  );
}

export function ToolHeader({
  className,
  children,
  ...props
}: React.ComponentProps<"summary">): React.ReactElement {
  return (
    <summary
      className={cn(
        "flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-fg-dim marker:hidden",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown
        size={13}
        strokeWidth={1.75}
        className="shrink-0 transition-transform duration-150 group-open/tool:rotate-180"
      />
    </summary>
  );
}

export function ToolContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "border-t border-hairline px-3 py-2 font-mono text-xs leading-5 text-fg-dim",
        className,
      )}
      {...props}
    />
  );
}
