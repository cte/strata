import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type ConnectorSummary, getConnectors } from "@/lib/api";

type ConnectorPath = "/connectors/notion" | "/connectors/granola" | "/connectors/slack";

const connectorPaths: Record<ConnectorSummary["name"], ConnectorPath> = {
  notion: "/connectors/notion",
  granola: "/connectors/granola",
  slack: "/connectors/slack",
};

export function ConnectorsPage(): React.ReactElement {
  const [connectors, setConnectors] = useState<ConnectorSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">Connectors</h1>
      </header>

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3 text-[13px]">
          <span className="font-mono text-[12px] text-[var(--bad)]">api error</span>
          <p className="mt-1 text-[var(--fg-dim)]">{error}</p>
        </div>
      ) : null}

      <ul className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
        {!loaded
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
          : connectors.map((c) => <ConnectorRow key={c.name} connector={c} />)}
      </ul>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: ConnectorSummary }): React.ReactElement {
  const to = connectorPaths[connector.name];
  return (
    <li>
      <Link
        to={to}
        className="group flex items-center justify-between gap-4 py-4 transition-colors duration-150 hover:bg-[var(--surface-2)]/40"
      >
        <div className="min-w-0 px-1">
          <p className="text-[14px] font-medium tracking-tight text-[var(--fg)]">
            {connector.displayName}
          </p>
          <p className="mt-0.5 truncate text-[12.5px] text-[var(--fg-dim)]">
            {connector.description}
          </p>
        </div>
        <div className="flex items-center gap-4 px-1">
          <Badge tone={badgeTone(connector.state)} pulse={connector.state === "ready"}>
            {connector.state.replace("_", " ")}
          </Badge>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-[var(--fg-mute)] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--fg)]"
          />
        </div>
      </Link>
    </li>
  );
}

function SkeletonRow(): React.ReactElement {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0 space-y-1.5 px-1">
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
