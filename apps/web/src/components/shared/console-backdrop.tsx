import type * as React from "react";

/**
 * Ambient operator-console backdrop for full-screen states: a drifting hairline
 * grid, two slow-breathing accent auroras, and a vignette. Decorative only
 * (pointer-events off, aria-hidden) and theme-aware via the runtime palette.
 * Styles live under `.strata-*` in globals.css.
 */
export function ConsoleBackdrop(): React.ReactElement {
  return (
    <div className="strata-backdrop" aria-hidden="true">
      <div className="strata-aurora strata-aurora-1" />
      <div className="strata-aurora strata-aurora-2" />
      <div className="strata-grid" />
      <div className="strata-vignette" />
    </div>
  );
}
