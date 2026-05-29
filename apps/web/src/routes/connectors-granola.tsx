import { Cable, Unplug } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { ConnectorOperationPanel } from "@/components/connector-operation-panel";
import { ConnectorSchedulePanel } from "@/components/connector-schedule-panel";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  configureGranola,
  disconnectGranola,
  type GranolaStatus,
  getGranolaStatus,
} from "@/lib/api";
import {
  type ConnectorConfigDraft,
  useConnectorDefaultConfig,
} from "@/lib/useConnectorDefaultConfig";

export function ConnectorsGranolaPage(): React.ReactElement {
  const [status, setStatus] = useState<GranolaStatus | null>(null);
  const [apiToken, setApiToken] = useState("");
  const [since, setSince] = useState("");
  const [pageSize, setPageSize] = useState("30");
  const [maxPages, setMaxPages] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const applyDefaultConfig = useCallback((config: ConnectorConfigDraft) => {
    setSince(configString(config.since));
    setPageSize(configString(config.pageSize, "30"));
    setMaxPages(configString(config.maxPages, "3"));
  }, []);
  const defaults = useConnectorDefaultConfig("granola", applyDefaultConfig);

  useEffect(() => {
    let cancelled = false;
    getGranolaStatus().then(
      (next) => {
        if (!cancelled) {
          setStatus(next);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function connect(): void {
    setError(null);
    startTransition(async () => {
      try {
        const next = await configureGranola({ apiToken: apiToken.trim() });
        setStatus(next);
        setApiToken("");
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  function disconnect(): void {
    setError(null);
    startTransition(async () => {
      try {
        const next = await disconnectGranola();
        setStatus(next);
        setApiToken("");
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  }

  const connected = status?.state === "connected";
  const canSubmit = apiToken.trim() !== "" && !isPending;
  const backfillConfig = compactConfig({
    since,
    pageSize,
    maxPages,
  });

  return (
    <PageContainer width="default">
      <PageHeader
        back={{ to: "/connectors", label: "Connectors" }}
        title="Granola"
        description={
          <>
            Strata pulls meeting transcripts via Granola’s personal API into{" "}
            <span className="font-mono text-[var(--fg)]">wiki/raw/granola/</span>. Your key is
            stored locally at{" "}
            <span className="font-mono text-[var(--fg)]">.strata/secrets/granola.json</span>.
          </>
        }
      />

      <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hairline)] pb-3">
          <div>
            <p className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
              Personal API key
            </p>
            {status ? (
              <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{status.message}</p>
            ) : null}
          </div>
          <Badge tone={connected ? "ready" : "muted"} pulse={connected}>
            {(status?.state ?? "unknown").replace("_", " ")}
          </Badge>
        </div>

        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              connect();
            }
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-[12px] text-[var(--fg-dim)]">API key</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              placeholder={connected ? "•••••• stored locally" : "grn_…"}
            />
            <span className="block text-[11px] text-[var(--fg-mute)]">
              Strata sends a single GET to{" "}
              <span className="font-mono text-[var(--fg-dim)]">public-api.granola.ai/v1/notes</span>{" "}
              to validate.
            </span>
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={!canSubmit} size="sm">
              <Cable size={13} strokeWidth={2} />
              {connected ? "Replace key" : "Validate & save"}
            </Button>
            {connected ? (
              <Button
                type="button"
                disabled={isPending}
                onClick={disconnect}
                variant="secondary"
                size="sm"
              >
                <Unplug size={13} strokeWidth={2} />
                Disconnect
              </Button>
            ) : null}
          </div>
        </form>

        {status?.validatedAt ? (
          <p className="mt-4 border-t border-[var(--hairline)] pt-3 text-[11px] text-[var(--fg-mute)]">
            last validated{" "}
            <span className="font-mono text-[var(--fg-dim)]">
              {new Date(status.validatedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
            </span>
          </p>
        ) : null}
      </div>

      <ConnectorSchedulePanel connector="granola" />

      <ConnectorOperationPanel
        connector="granola"
        title="One-off backfill"
        description={
          <>
            Pull a bounded meeting window into{" "}
            <span className="font-mono text-[var(--fg)]">wiki/raw/granola/</span>, then optionally
            create curated wiki pages and refresh retrieval.
          </>
        }
        runTitle="Pull Granola meetings"
        config={backfillConfig}
        canRun={connected}
        disabledReason={connected ? undefined : "Connect Granola before pulling meetings."}
        defaults={{
          label: "Saved backfill defaults",
          profileLabel: defaults.defaultProfile?.label ?? null,
          updatedAt: defaults.defaultProfile?.updatedAt ?? null,
          error: defaults.error,
          isLoading: defaults.isPending,
          canLoad: defaults.defaultProfile !== null,
          canSave: Object.keys(backfillConfig).length > 0,
          onLoad: defaults.loadDefault,
          onSave: () =>
            defaults.saveDefault({
              id: "default",
              label: "Granola backfill defaults",
              config: backfillConfig,
            }),
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_120px]">
          <label className="space-y-1.5">
            <span className="text-[12px] text-[var(--fg-dim)]">Since</span>
            <Input
              value={since}
              onChange={(event) => setSince(event.target.value)}
              placeholder="2026-05-01T00:00:00.000Z"
              spellCheck={false}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[12px] text-[var(--fg-dim)]">Page size</span>
            <Input
              inputMode="numeric"
              value={pageSize}
              onChange={(event) => setPageSize(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[12px] text-[var(--fg-dim)]">Max pages</span>
            <Input
              inputMode="numeric"
              value={maxPages}
              onChange={(event) => setMaxPages(event.target.value)}
            />
          </label>
        </div>
      </ConnectorOperationPanel>

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
          <p className="font-mono text-[12px] text-[var(--bad)]">Validation failed</p>
          <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{error}</p>
        </div>
      ) : null}
    </PageContainer>
  );
}

function configString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function compactConfig(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const trimmed = value.trim();
    if (trimmed !== "") {
      output[key] = trimmed;
    }
  }
  return output;
}
