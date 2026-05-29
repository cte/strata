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
    <section className="rounded-md border border-[var(--hairline)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--hairline)] p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileDown size={14} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
            <h2 className="text-[13px] font-medium tracking-tight text-[var(--fg)]">{title}</h2>
          </div>
          <p className="mt-1 text-[12px] text-[var(--fg-dim)]">{description}</p>
        </div>
        {result ? (
          <Badge tone={result.connectorResult.dryRun ? "muted" : "ready"}>
            {result.operation.replace("_", " ")}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-4 p-4">
        {children}

        {defaults ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-3 py-2">
            <div className="flex min-w-0 items-start gap-2">
              <SlidersHorizontal
                size={13}
                strokeWidth={1.75}
                className="mt-0.5 shrink-0 text-[var(--fg-mute)]"
              />
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--fg)]">{defaults.label}</p>
                <p className="truncate text-[11px] text-[var(--fg-mute)]">
                  {defaults.profileLabel ?? "No saved defaults"}
                  {defaults.updatedAt ? ` · ${formatTimestamp(defaults.updatedAt)}` : ""}
                </p>
                {defaultsNotice ? (
                  <p className="mt-1 text-[11px] text-[var(--good)]">{defaultsNotice}</p>
                ) : null}
                {(defaultsError ?? defaults.error) ? (
                  <p className="mt-1 font-mono text-[11px] text-[var(--bad)]">
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

        <div className="grid gap-2 border-t border-[var(--hairline)] pt-3 sm:grid-cols-2">
          <Toggle
            checked={indexRaw}
            disabled={isPending}
            label="Create wiki pages"
            onChange={setIndexRaw}
          />
          <Toggle
            checked={refreshSearchIndex}
            disabled={isPending}
            label="Refresh search index"
            onChange={setRefreshSearchIndex}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 text-[12px] text-[var(--fg-mute)]">{disabledReason ?? ""}</p>
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
          <p className="rounded-sm bg-[var(--bad)]/10 px-2 py-1.5 font-mono text-[11px] text-[var(--bad)]">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function formatTimestamp(value: string): string {
  return new Date(value).toISOString().replace("T", " ").slice(0, 19);
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange(value: boolean): void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-[12px] text-[var(--fg-dim)]">
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        type="checkbox"
      />
      {label}
    </label>
  );
}

function ConnectorRunResultBlock({ result }: { result: ConnectorRunResult }): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchCheck size={13} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
        <p className="text-[12px] font-medium text-[var(--fg)]">{result.connectorResult.title}</p>
        <Badge tone={result.connectorResult.dryRun ? "muted" : "ready"}>
          {result.connectorResult.dryRun ? "preview" : "completed"}
        </Badge>
      </div>
      <dl className="mt-3 grid gap-2 text-[12px] sm:grid-cols-3">
        <Metric label="Items" value={String(result.metrics.itemCount)} />
        <Metric label="Written" value={String(result.metrics.writtenCount)} />
        <Metric label="Skipped" value={String(result.metrics.skippedCount)} />
        <Metric label="Indexed" value={String(result.metrics.indexedCount)} />
        <Metric label="Index skipped" value={String(result.metrics.indexSkippedCount)} />
        <Metric label="Search docs" value={String(result.metrics.searchIndexed)} />
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hairline)] pt-3 font-mono text-[11px] text-[var(--fg-mute)]">
        <Link to="/activity" className="text-[var(--accent)] hover:underline">
          {result.metrics.connectorSessionId}
        </Link>
        {result.metrics.rawToWikiSessionId ? (
          <Link to="/activity" className="text-[var(--accent)] hover:underline">
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
      <dt className="text-[11px] text-[var(--fg-mute)]">{label}</dt>
      <dd className="font-mono text-[11px] text-[var(--fg-dim)]">{value}</dd>
    </div>
  );
}
