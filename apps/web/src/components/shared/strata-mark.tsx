import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The Strata brand glyph: an isometric stack of geological "strata" plates —
 * a literal read of the product name. The top plate carries the accent color
 * and the stack fades into the surface below it. Each plate floats on its own
 * slow cycle (disabled under prefers-reduced-motion). Used by the full-screen
 * console states (lock screen, 404).
 */
export function StrataMark({
  className,
  ...props
}: React.ComponentProps<"svg">): React.ReactElement {
  // Iso diamonds centered on x=60, stacked bottom→top with a 16px rise each.
  const halfW = 44;
  const halfH = 22;
  const plates = [
    { cy: 86, fill: "var(--surface-2)", stroke: "var(--hairline-strong)", delay: "0s" },
    { cy: 70, fill: "var(--surface-2)", stroke: "var(--hairline-strong)", delay: "0.4s" },
    { cy: 54, fill: "var(--bg-elev)", stroke: "var(--hairline-strong)", delay: "0.8s" },
    { cy: 38, fill: "var(--accent-soft)", stroke: "var(--accent)", delay: "1.2s" },
  ] as const;

  const diamond = (cx: number, cy: number): string =>
    `${cx},${cy - halfH} ${cx + halfW},${cy} ${cx},${cy + halfH} ${cx - halfW},${cy}`;

  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      role="img"
      aria-label="Strata"
      className={cn("h-16 w-16", className)}
      {...props}
    >
      <title>Strata</title>
      {plates.map((plate) => (
        <polygon
          key={plate.cy}
          className="strata-plate"
          style={{ animationDelay: plate.delay }}
          points={diamond(60, plate.cy)}
          fill={plate.fill}
          stroke={plate.stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
