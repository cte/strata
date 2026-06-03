import { Link } from "@tanstack/react-router";
import {
  Eye,
  FileDown,
  RefreshCw,
  RotateCcw,
  Save,
  SearchCheck,
  SlidersHorizontal,
} from "lucide-react";
import type * as React from "react";
import { useState, useTransition } from "react";
import { CheckToggle } from "@/components/shared/check-toggle";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type ConnectorRunInput, type ConnectorRunResult, runConnector } from "@/lib/api";

type ConnectorRunConfig = ConnectorRunInput["config"];

export function ConnectorOperationPanel({
  connector,
  title,
  description,
  runTitle,
  config,
  canRun = true,
  disabledReason,
  defaultIndex = true,
  defaultRefreshSearchIndex = true,
  defaults,
  children,
}: {
  connector: ConnectorRunInput["connector"];
  title: string;
  description: React.ReactNode;
  runTitle: string;
  config: ConnectorRunConfig;
  canRun?: boolean;
  disabledReason?: string | undefined;
  defaultIndex?: boolean;
  defaultRefreshSearchIndex?: boolean;
  defaults?: {
    label: string;
    profileLabel?: string | null;
    updatedAt?: string | null;
    error?: string | null;
    isLoading?: boolean;
    canLoad?: boolean;
    canSave?: boolean;
    onLoad(): void;
    onSave(): Promise<void>;
  };
  children: React.ReactNode;
}): React.ReactElement {
  const [indexRaw, setIndexRaw] = useState(defaultIndex);
  const [refreshSearchIndex, setRefreshSearchIndex] = useState(defaultRefreshSearchIndex);
  const [result, setResult] = useState<ConnectorRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultsNotice, setDefaultsNotice] = useState<string | null>(null);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDefaultsPending, startDefaultsTransition] = useTransition();

  const run = (operation: ConnectorRunInput["operation"]) => {
    setError(null);
    startTransition(async () => {
      try {
        setResult(
          await runConnector({
            connector,
            operation,
            config,
            index: indexRaw,
            refreshSearchIndex,
            title: runTitle,
          }),
        );
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const loadDefaults = () => {
    if (!defaults || defaults.canLoad === false) {
      return;
    }
    setDefaultsNotice("Loaded saved defaults.");
    setDefaultsError(null);
    defaults.onLoad();
  };

  const saveDefaults = () => {
    if (!defaults || defaults.canSave === false) {
      return;
    }
    setDefaultsNotice(null);
    setDefaultsError(null);
    startDefaultsTransition(async () => {
      try {
        await defaults.onSave();
        setDefaultsNotice("Saved defaults.");
      } catch (cause: unknown) {
        setDefaultsError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const busy = isPending || !canRun;
  const defaultsBusy = isDefaultsPending || defaults?.isLoading === true;

  return (
    <SectionCard
      icon={<FileDown size={14} strokeWidth={1.75} />}
      title={title}
      description={description}
      actions={
        result ? (
          <Badge tone={result.connectorResult.dryRun ? "muted" : "ready"}>
            {result.operation.replace("_", " ")}
          </Badge>
        ) : null
      }
      bodyClassName="space-y-4"
    >
      {children}

      {defaults ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline bg-surface-2 px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
            <SlidersHorizontal
              size={13}
              strokeWidth={1.75}
              className="mt-0.5 shrink-0 text-fg-mute"
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg">{defaults.label}</p>
              <p className="truncate text-2xs text-fg-mute">
                {defaults.profileLabel ?? "No saved defaults"}
                {defaults.updatedAt ? ` · ${formatTimestamp(defaults.updatedAt)}` : ""}
              </p>
              {defaultsNotice ? <p className="mt-1 text-2xs text-good">{defaultsNotice}</p> : null}
              {(defaultsError ?? defaults.error) ? (
                <p className="mt-1 font-mono text-2xs text-bad">
                  {defaultsError ?? defaults.error}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={defaultsBusy || defaults.canLoad === false}
              onClick={loadDefaults}
            >
              <RotateCcw size={13} strokeWidth={2} />
              Load
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={defaultsBusy || defaults.canSave === false}
              onClick={saveDefaults}
            >
              <Save size={13} strokeWidth={2} />
              Save
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 border-t border-hairline pt-3 sm:grid-cols-2">
        <CheckToggle
          checked={indexRaw}
          disabled={isPending}
          label="Create wiki pages"
          onChange={setIndexRaw}
        />
        <CheckToggle
          checked={refreshSearchIndex}
          disabled={isPending}
          label="Refresh search index"
          onChange={setRefreshSearchIndex}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-fg-mute">{disabledReason ?? ""}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => run("dry_run")}
          >
            <Eye size={13} strokeWidth={2} />
            Dry run
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => run("pull")}>
            <RefreshCw size={13} strokeWidth={2} />
            Pull
          </Button>
        </div>
      </div>

      {result ? <ConnectorRunResultBlock result={result} /> : null}

      {error ? (
        <p className="rounded-sm bg-bad/10 px-2 py-1.5 font-mono text-2xs text-bad">{error}</p>
      ) : null}
    </SectionCard>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19);
}

function ConnectorRunResultBlock({ result }: { result: ConnectorRunResult }): React.ReactElement {
  return (
    <div className="rounded-md border border-hairline bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchCheck size={13} strokeWidth={1.75} className="text-fg-mute" />
        <p className="text-xs font-medium text-fg">{result.connectorResult.title}</p>
        <Badge tone={result.connectorResult.dryRun ? "muted" : "ready"}>
          {result.connectorResult.dryRun ? "preview" : "completed"}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
        <Metric label="Items" value={String(result.metrics.itemCount)} />
        <Metric label="Written" value={String(result.metrics.writtenCount)} />
        <Metric label="Skipped" value={String(result.metrics.skippedCount)} />
        <Metric label="Indexed" value={String(result.metrics.indexedCount)} />
        <Metric label="Index skipped" value={String(result.metrics.indexSkippedCount)} />
        <Metric label="Search docs" value={String(result.metrics.searchIndexed)} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline pt-3 font-mono text-2xs text-fg-mute">
        <Link to="/activity" className="text-accent hover:underline">
          {result.metrics.connectorSessionId}
        </Link>
        {result.metrics.rawToWikiSessionId ? (
          <Link to="/activity" className="text-accent hover:underline">
            {result.metrics.rawToWikiSessionId}
          </Link>
        ) : null}
        <span>{result.rawPaths.length} raw paths</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <dt className="text-2xs text-fg-mute">{label}</dt>
      <dd className="font-mono text-2xs text-fg-dim">{value}</dd>
    </div>
  );
}
