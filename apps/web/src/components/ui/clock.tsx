import type * as React from "react";
import { useEffect, useState } from "react";

function format(now: Date): string {
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function LiveClock(): React.ReactElement {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="label-eyebrow font-mono tabular-nums tracking-[0.14em] text-[var(--fg-dim)]"
      aria-label="Coordinated Universal Time"
    >
      {format(now)}
      <span className="ml-1 text-[var(--fg-mute)]">UTC</span>
    </span>
  );
}
