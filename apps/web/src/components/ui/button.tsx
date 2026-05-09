import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-2 rounded-md border text-[13px] font-medium tracking-tight transition-[background-color,border-color,color,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110",
        secondary:
          "border-[var(--hairline-strong)] bg-transparent text-[var(--fg)] hover:bg-[var(--surface-2)] hover:border-[var(--fg-mute)]",
        ghost:
          "border-transparent bg-transparent text-[var(--fg-dim)] hover:text-[var(--fg)] hover:bg-[var(--surface-2)]",
        accent:
          "border-[var(--hairline-strong)] bg-[var(--surface-2)] text-[var(--fg)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-11 px-6 text-sm",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends Omit<React.ComponentProps<typeof BaseButton>, "className">,
    VariantProps<typeof buttonVariants> {
  className?: string;
}

export function Button({ className, variant, size, ...props }: ButtonProps): React.ReactElement {
  return <BaseButton className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
