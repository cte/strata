import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-fg shadow hover:bg-accent/90",
        destructive: "bg-bad text-bg shadow-sm hover:bg-bad/90",
        outline: "border border-hairline bg-bg shadow-sm hover:bg-surface-2 hover:text-fg",
        secondary: "bg-surface-2 text-fg shadow-sm hover:bg-surface-2/80",
        ghost: "hover:bg-surface-2 hover:text-fg",
        link: "rounded-none text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-xs",
        lg: "h-12 px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Render the button as a different element (e.g. an anchor). Base UI's
   * composition primitive — replaces the old Radix `asChild`/`Slot` pattern.
   */
  render?: useRender.RenderProp;
  ref?: React.Ref<HTMLButtonElement>;
}

function Button({
  className,
  variant,
  size,
  render,
  ref,
  ...props
}: ButtonProps): React.ReactElement {
  return useRender({
    render: render ?? <button />,
    ref,
    props: {
      className: cn(buttonVariants({ variant, size, className })),
      ...props,
    },
  });
}

export { Button, buttonVariants };
