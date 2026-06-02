import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shared skeleton for top-level route pages. Standardizes the centered column,
 * width, vertical rhythm, and header so every page reads the same. The chat
 * surface is intentionally exempt — it is a full-bleed conversation view.
 */

type PageWidth = "narrow" | "default" | "wide";
type LinkTarget = NonNullable<React.ComponentProps<typeof Link>["to"]>;

const WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
};

export function PageContainer({
  width = "default",
  fill = false,
  className,
  children,
}: {
  width?: PageWidth;
  /** Full-height flex column for master/detail pages (e.g. the wiki browser). */
  fill?: boolean;
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  // The shell gives us a fixed-height flex slot (see SidebarInset). Standard
  // pages scroll inside this container; `fill` pages hand a full-height,
  // non-scrolling column to master/detail layouts that manage their own scroll.
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col", fill ? "overflow-hidden" : "overflow-y-auto")}
    >
      <div
        className={cn(
          "mx-auto w-full min-w-0 px-6 py-8 md:px-10 md:py-10",
          WIDTH_CLASS[width],
          fill ? "flex min-h-0 flex-1 flex-col gap-5" : "space-y-6",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  back,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { to: LinkTarget; label: string };
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("shrink-0 space-y-3", className)}>
      {back ? <PageBackLink to={back.to} label={back.label} /> : null}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {icon ? <span className="text-fg-mute">{icon}</span> : null}
            <h1 className="text-md font-medium tracking-tight text-fg">{title}</h1>
          </div>
          {description ? <p className="mt-1 max-w-2xl text-sm text-fg-dim">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
    </div>
  );
}

export function PageBackLink({ to, label }: { to: LinkTarget; label: string }): React.ReactElement {
  return (
    <Link
      to={to}
      className="group inline-flex items-center gap-1 text-xs text-fg-mute transition-colors duration-150 hover:text-fg-dim"
    >
      <ArrowLeft
        size={12}
        strokeWidth={1.75}
        className="transition-transform duration-150 group-hover:-translate-x-0.5"
      />
      {label}
    </Link>
  );
}
