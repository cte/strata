import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The canonical bordered "panel" — a hairline card on the `surface` token with
 * an optional header (icon + title + description on the left, `actions` on the
 * right) separated from the body by a hairline rule. This is the single source
 * of truth for the section cards that were hand-rolled across routes (retrieval
 * index panels, connector operation panel, MCP server cards). Omit every header
 * prop to render a plain padded card.
 */
export interface SectionCardProps extends Omit<React.ComponentProps<"section">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Small leading glyph shown before the title. */
  icon?: React.ReactNode;
  /** Right-aligned header slot for status badges, switches, or buttons. */
  actions?: React.ReactNode;
  /** Override padding/layout of the body wrapper. */
  bodyClassName?: string;
  /** Render the body without the default padding wrapper. */
  bare?: boolean;
}

export function SectionCard({
  title,
  description,
  icon,
  actions,
  className,
  bodyClassName,
  bare = false,
  children,
  ...props
}: SectionCardProps): React.ReactElement {
  const hasHeader = icon != null || title != null || description != null || actions != null;
  return (
    <section className={cn("rounded-md border border-hairline bg-surface", className)} {...props}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {icon ? <span className="text-fg-mute">{icon}</span> : null}
              {title ? (
                <h2 className="text-sm font-medium tracking-tight text-fg">{title}</h2>
              ) : null}
            </div>
            {description ? (
              <p className="mt-1 max-w-xl text-xs text-fg-dim">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {bare ? children : <div className={cn("p-4", bodyClassName)}>{children}</div>}
    </section>
  );
}
