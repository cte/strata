import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type ConnectorSummary, getConnectors } from "@/lib/api";

export function ConnectorsSlackPage(): React.ReactElement {
  const [connector, setConnector] = useState<ConnectorSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    getConnectors().then(
      (items) => {
        if (!cancelled) {
          setConnector(items.find((c) => c.name === "slack") ?? null);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink />

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-medium tracking-tight text-[var(--fg)]">Slack</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-dim)]">
            Capture Slack channels and threads into{" "}
            <span className="font-mono text-[var(--fg)]">wiki/raw/slack/</span> through the shared
            checkpointed connector runner. Setup controls are still pending.
          </p>
        </div>
        <Badge tone={connector?.configured ? "warning" : "muted"}>
          {(connector?.state ?? "not_configured").replace("_", " ")}
        </Badge>
      </header>

      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4 text-[13px] text-[var(--fg-dim)]">
        <p>
          Strata now supports explicit thread pulls and checkpointed channel sync from the CLI. Next
          we need to expose token setup, channel filters, dry-runs, and schedules here, then add
          Socket Mode event tailing for near-real-time updates.
        </p>
        <pre className="mt-4 overflow-x-auto rounded border border-[var(--hairline)] bg-[var(--bg)] p-3 font-mono text-[12px] text-[var(--fg)]">
          {`bun run strata ingest slack sync --since 2026-05-01 --channels engineering`}
        </pre>
      </div>
    </div>
  );
}

function BackLink(): React.ReactElement {
  return (
    <Link
      to="/connectors"
      className="group inline-flex items-center gap-1 text-[12px] text-[var(--fg-mute)] transition-colors duration-150 hover:text-[var(--fg-dim)]"
    >
      <ArrowLeft
        size={12}
        strokeWidth={1.75}
        className="transition-transform duration-150 group-hover:-translate-x-0.5"
      />
      Connectors
    </Link>
  );
}
