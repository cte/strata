import type * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"section">): React.ReactElement {
  return (
    <section
      className={cn(
        "relative rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-6",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("mb-5 space-y-1.5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h2">): React.ReactElement {
  return (
    <h2
      className={cn("text-[15px] font-medium tracking-tight text-[var(--fg)]", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"p">): React.ReactElement {
  return <p className={cn("text-[13px] leading-6 text-[var(--fg-dim)]", className)} {...props} />;
}

export function CardContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return <div className={cn("space-y-4", className)} {...props} />;
}
