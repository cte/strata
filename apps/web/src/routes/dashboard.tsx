import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type ConnectorSummary, getConnectors } from "@/lib/api";

export function DashboardPage(): React.ReactElement {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getConnectors().then(
      (items) => {
        if (!cancelled) {
          setConnectors(items);
          setLoaded(true);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoaded(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const total = connectors.length;
  const ready = connectors.filter((c) => c.state === "ready").length;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">Overview</h1>
        <p className="mt-1 text-[13px] text-[var(--fg-dim)]">
          {loaded ? `${ready} of ${total} connectors ready.` : "Loading…"}
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3 text-[13px]">
          <span className="font-mono text-[12px] text-[var(--bad)]">api error</span>
          <p className="mt-1 text-[var(--fg-dim)]">{error}</p>
        </div>
      ) : null}

      <section>
        <div className="mb-3 flex items-end justify-between border-b border-[var(--hairline)] pb-2">
          <h2 className="text-[13px] font-medium tracking-tight text-[var(--fg)]">Connectors</h2>
          <Link
            to="/connectors"
            className="group inline-flex items-center gap-1 text-[12px] text-[var(--fg-dim)] transition-colors duration-150 hover:text-[var(--accent)]"
          >
            Configure
            <ArrowRight
              size={12}
              strokeWidth={1.75}
              className="transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </Link>
        </div>

        <ul className="divide-y divide-[var(--hairline)]">
          {!loaded
            ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
            : connectors.map((c) => <ConnectorRow key={c.name} connector={c} />)}
        </ul>
      </section>

      <section className="text-[12px] text-[var(--fg-mute)]">
        Raw snapshots write to <span className="font-mono text-[var(--fg-dim)]">wiki/raw/</span>
      </section>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: ConnectorSummary }): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
          {connector.displayName}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-[var(--fg-dim)]">{connector.message}</p>
      </div>
      <Badge tone={badgeTone(connector.state)} pulse={connector.state === "ready"}>
        {connector.state.replace("_", " ")}
      </Badge>
    </li>
  );
}

function SkeletonRow(): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 space-y-1.5">
        <div className="h-3 w-28 rounded-sm bg-[var(--surface-2)]" />
        <div className="h-2.5 w-48 rounded-sm bg-[var(--surface-2)]" />
      </div>
    </li>
  );
}

function badgeTone(state: ConnectorSummary["state"]): "ready" | "warning" | "muted" | "bad" {
  if (state === "ready") return "ready";
  if (state === "invalid") return "bad";
  if (state === "not_implemented") return "warning";
  return "muted";
}
