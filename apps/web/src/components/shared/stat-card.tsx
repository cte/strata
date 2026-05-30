import type * as React from "react";
import { Eyebrow } from "@/components/shared/eyebrow";
import { cn } from "@/lib/utils";

/**
 * A single metric tile: eyebrow label + icon, big mono number. The canonical
 * "stat card" so dashboards (activity, etc.) don't each hand-roll the layout.
 * Set `danger` for failure-style metrics that turn red when non-zero.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  danger?: boolean;
}): React.ReactElement {
  const alert = danger && value > 0;
  return (
    <div
      className={cn(
        "rounded-md border bg-surface px-3 py-3",
        alert ? "border-bad/40 bg-bad/[0.05]" : "border-hairline",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        {Icon ? (
          <Icon size={14} strokeWidth={1.75} className={alert ? "text-bad" : "text-fg-mute"} />
        ) : null}
      </div>
      <p className={cn("mt-2 font-mono text-2xl leading-none", alert ? "text-bad" : "text-fg")}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
