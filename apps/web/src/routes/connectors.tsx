import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type * as React from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import type { ConnectorSummary } from "@/lib/api";
import { useConnectors } from "@/lib/queries/connectors";

type ConnectorPath = "/connectors/notion" | "/connectors/granola" | "/connectors/slack";

const connectorPaths: Record<ConnectorSummary["name"], ConnectorPath> = {
  notion: "/connectors/notion",
  granola: "/connectors/granola",
  slack: "/connectors/slack",
};

export function ConnectorsPage(): React.ReactElement {
  const connectorsQuery = useConnectors();
  const connectors = connectorsQuery.data ?? [];
  const loaded = !connectorsQuery.isPending;
  const error = connectorsQuery.error
    ? connectorsQuery.error instanceof Error
      ? connectorsQuery.error.message
      : String(connectorsQuery.error)
    : null;

  return (
    <PageContainer width="narrow">
      <PageHeader title="Connectors" description="Connect sources Strata ingests into the wiki." />

      {error ? (
        <div className="rounded-md border border-bad/40 bg-bad/[0.06] p-3 text-sm">
          <span className="font-mono text-xs text-bad">api error</span>
          <p className="mt-1 text-fg-dim">{error}</p>
        </div>
      ) : null}

      <ul className="divide-y divide-hairline border-y border-hairline">
        {!loaded
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)
          : connectors.map((c) => <ConnectorRow key={c.name} connector={c} />)}
      </ul>
    </PageContainer>
  );
}

function ConnectorRow({ connector }: { connector: ConnectorSummary }): React.ReactElement {
  const to = connectorPaths[connector.name];
  return (
    <li>
      <Link
        to={to}
        className="group flex items-center justify-between gap-4 py-4 transition-colors duration-150 hover:bg-surface-2/40"
      >
        <div className="min-w-0 px-1">
          <p className="text-base font-medium tracking-tight text-fg">{connector.displayName}</p>
          <p className="mt-0.5 truncate text-sm text-fg-dim">{connector.description}</p>
        </div>
        <div className="flex items-center gap-4 px-1">
          <Badge tone={badgeTone(connector.state)} pulse={connector.state === "ready"}>
            {connector.state.replace("_", " ")}
          </Badge>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-fg-mute transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg"
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
        <div className="h-3 w-28 rounded-sm bg-surface-2" />
        <div className="h-2.5 w-48 rounded-sm bg-surface-2" />
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
