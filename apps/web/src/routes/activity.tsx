import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getIngestActivity,
  type IngestActivityDetail,
  type IngestActivityItem,
  type IngestActivityResultFilter,
  type IngestActivityRun,
  type IngestActivitySource,
  listIngestActivity,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_FILTERS: { label: string; value: IngestActivitySource }[] = [
  { label: "All", value: "all" },
  { label: "Granola", value: "granola" },
  { label: "Slack", value: "slack" },
  { label: "Notion", value: "notion" },
];

const RESULT_FILTER_OPTIONS: {
  value: IngestActivityResultFilter;
  label: string;
  description: string;
}[] = [
  {
    value: "raw_written",
    label: "New source files",
    description: "Pulls that saved new raw snapshots.",
  },
  {
    value: "wiki_indexed",
    label: "Wiki updates",
    description: "Raw sources organized into curated pages.",
  },
  {
    value: "search_indexed",
    label: "Search updates",
    description: "Retrieval index refresh jobs.",
  },
  {
    value: "skipped_or_previewed",
    label: "Skipped or previewed",
    description: "Dry-runs and already-seen source items.",
  },
  {
    value: "failed",
    label: "Failures",
    description: "Runs that need attention.",
  },
  {
    value: "other",
    label: "Other",
    description: "Completed runs without result counters.",
  },
];

const DEFAULT_RESULT_FILTERS: IngestActivityResultFilter[] = ["raw_written", "wiki_indexed"];
const ALL_RESULT_FILTERS = RESULT_FILTER_OPTIONS.map((option) => option.value);

export function ActivityPage(): React.ReactElement {
  const [source, setSource] = useState<IngestActivitySource>("all");
  const [resultFilters, setResultFilters] =
    useState<IngestActivityResultFilter[]>(DEFAULT_RESULT_FILTERS);
  const [runs, setRuns] = useState<IngestActivityRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, IngestActivityDetail>>({});
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const resultFilterKey = resultFilters.join(",");

  const refresh = useCallback(() => {
    setError(null);
    listIngestActivity({ limit: 50, source, resultFilters }).then(
      (nextRuns) => {
        setRuns(nextRuns);
        setLoaded(true);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoaded(true);
      },
    );
  }, [source, resultFilters]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    setExpandedSessionId(null);
    setDetailError(null);
    setLoadingDetailKey(null);
  }, [resultFilterKey]);

  const totals = useMemo(() => activityTotals(runs), [runs]);
  const showSearchMetric = resultFilters.includes("search_indexed");

  const handleRefresh = () => {
    startTransition(async () => {
      setError(null);
      try {
        setRuns(await listIngestActivity({ limit: 50, source, resultFilters }));
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const toggleRun = (run: IngestActivityRun) => {
    if (expandedSessionId === run.sessionId) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(run.sessionId);
    setDetailError(null);
    const detailKey = activityDetailKey(run.sessionId, resultFilterKey);
    if (details[detailKey] !== undefined) {
      return;
    }
    setLoadingDetailKey(detailKey);
    getIngestActivity(run.sessionId, 200, resultFilters).then(
      (detail) => {
        if (detail !== null) {
          setDetails((current) => ({ ...current, [detailKey]: detail }));
        }
        setLoadingDetailKey((current) => (current === detailKey ? null : current));
      },
      (cause: unknown) => {
        setDetailError(cause instanceof Error ? cause.message : String(cause));
        setLoadingDetailKey((current) => (current === detailKey ? null : current));
      },
    );
  };

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<Activity size={15} strokeWidth={1.75} />}
        title="Ingest Activity"
        description="Source pulls, raw-to-wiki indexing, schedules, and the trace sessions behind them."
        actions={
          <>
            <ResultFilterSelect value={resultFilters} onChange={setResultFilters} />
            <SourceFilter value={source} onChange={setSource} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleRefresh}
              disabled={isPending}
            >
              <RefreshCw size={13} strokeWidth={2} className={cn(isPending && "animate-spin")} />
              Refresh
            </Button>
          </>
        }
      />

      <ActivityStats runs={runs.length} totals={totals} />

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
          <p className="font-mono text-[12px] text-[var(--bad)]">activity error</p>
          <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{error}</p>
        </div>
      ) : null}

      <section className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
        {!loaded ? (
          <ActivitySkeleton />
        ) : runs.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-[var(--fg-dim)]">
            No ingest activity found.
          </div>
        ) : (
          runs.map((run) => {
            const expanded = expandedSessionId === run.sessionId;
            const detailKey = activityDetailKey(run.sessionId, resultFilterKey);
            return (
              <ActivityRunRow
                key={run.sessionId}
                run={run}
                expanded={expanded}
                detail={details[detailKey] ?? null}
                detailError={expanded ? detailError : null}
                loading={loadingDetailKey === detailKey}
                showSearchMetric={showSearchMetric}
                onToggle={() => toggleRun(run)}
              />
            );
          })
        )}
      </section>
    </PageContainer>
  );
}

function ResultFilterSelect({
  value,
  onChange,
}: {
  value: IngestActivityResultFilter[];
  onChange(value: IngestActivityResultFilter[]): void;
}): React.ReactElement {
  const selected = new Set(value);
  const label = resultFilterLabel(value);
  const toggleFilter = (filter: IngestActivityResultFilter, checked: boolean): void => {
    const next = checked
      ? [...value, filter]
      : value.filter((selectedFilter) => selectedFilter !== filter);
    onChange(orderResultFilters(next));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-w-[190px] justify-between px-2.5"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <ListFilter size={13} strokeWidth={2} />
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown size={13} strokeWidth={2} className="text-[var(--fg-mute)]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 border-[var(--hairline)] bg-[var(--surface)] p-1.5 text-[var(--fg)]"
      >
        <DropdownMenuLabel className="px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--fg-mute)]">
          Result type
        </DropdownMenuLabel>
        {RESULT_FILTER_OPTIONS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            onCheckedChange={(checked) => toggleFilter(option.value, checked === true)}
            onSelect={(event) => event.preventDefault()}
            className="items-start rounded-md py-2 pr-2 text-[13px] focus:bg-[var(--surface-2)]"
          >
            <span className="grid gap-0.5">
              <span className="font-medium text-[var(--fg)]">{option.label}</span>
              <span className="text-[11.5px] leading-snug text-[var(--fg-mute)]">
                {option.description}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator className="my-1 bg-[var(--hairline)]" />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_RESULT_FILTERS)}
            className="h-7 rounded-sm px-2 text-[11.5px] font-medium text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
          >
            Default
          </button>
          <button
            type="button"
            onClick={() => onChange(ALL_RESULT_FILTERS)}
            className="h-7 rounded-sm px-2 text-[11.5px] font-medium text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
          >
            All
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SourceFilter({
  value,
  onChange,
}: {
  value: IngestActivitySource;
  onChange(value: IngestActivitySource): void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-4 rounded-md border border-[var(--hairline)] p-0.5">
      {SOURCE_FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => onChange(filter.value)}
          className={cn(
            "h-8 min-w-16 rounded-[5px] px-2 text-[12px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            value === filter.value
              ? "bg-[var(--surface-2)] text-[var(--fg)]"
              : "text-[var(--fg-dim)] hover:text-[var(--fg)]",
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function ActivityStats({
  runs,
  totals,
}: {
  runs: number;
  totals: ReturnType<typeof activityTotals>;
}): React.ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <ActivityStat label="runs" value={runs} icon={GitBranch} />
      <ActivityStat label="raw written" value={totals.rawWritten} icon={Database} />
      <ActivityStat label="indexed" value={totals.rawIndexed} icon={FileText} />
      <ActivityStat label="skipped" value={totals.skipped} icon={ChevronRight} />
      <ActivityStat label="failures" value={totals.failures} icon={AlertTriangle} danger />
    </div>
  );
}

function ActivityStat({
  label,
  value,
  icon: Icon,
  danger = false,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  danger?: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="label-eyebrow text-[var(--fg-mute)]">{label}</span>
        <Icon
          size={14}
          strokeWidth={1.75}
          className={danger && value > 0 ? "text-[var(--bad)]" : "text-[var(--fg-mute)]"}
        />
      </div>
      <p
        className={cn(
          "mt-2 font-mono text-[20px] leading-none",
          danger && value > 0 ? "text-[var(--bad)]" : "text-[var(--fg)]",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function ActivityRunRow({
  run,
  expanded,
  detail,
  detailError,
  loading,
  showSearchMetric,
  onToggle,
}: {
  run: IngestActivityRun;
  expanded: boolean;
  detail: IngestActivityDetail | null;
  detailError: string | null;
  loading: boolean;
  showSearchMetric: boolean;
  onToggle(): void;
}): React.ReactElement {
  return (
    <div className="py-4">
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] md:grid-cols-[20px_minmax(0,1fr)_minmax(170px,0.35fr)]"
      >
        <span className="pt-1.5 text-[var(--fg-mute)]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-medium tracking-tight text-[var(--fg)]">
              {run.title}
            </span>
            <Badge tone={statusTone(run.status)}>{run.status}</Badge>
            {run.source ? <Badge tone="muted">{run.source}</Badge> : null}
            {run.dryRun === true ? <Badge tone="warning">dry-run</Badge> : null}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] text-[var(--fg-mute)]">
            <span>{run.operation}</span>
            <span>{shortSessionId(run.sessionId)}</span>
            {run.scheduleId ? <span>{run.scheduleId}</span> : null}
            {run.parentSessionId ? <span>parent {shortSessionId(run.parentSessionId)}</span> : null}
          </span>
          <span className="mt-2 flex flex-wrap gap-2 text-[12px] text-[var(--fg-dim)]">
            <MetricPill label="written" value={run.counts.rawWritten} />
            <MetricPill label="indexed" value={run.counts.rawIndexed} />
            <MetricPill
              label="skipped"
              value={run.counts.rawSkipped + run.counts.rawIndexSkipped}
            />
            {showSearchMetric && run.counts.searchIndexed > 0 ? (
              <MetricPill label="search" value={run.counts.searchIndexed} />
            ) : null}
            {run.counts.failures > 0 ? (
              <MetricPill label="failures" value={run.counts.failures} bad />
            ) : null}
          </span>
        </span>
        <span className="hidden text-right text-[12px] text-[var(--fg-dim)] md:block">
          <span>{formatTime(run.startedAt)}</span>
          <span className="mt-1 block font-mono text-[11px] text-[var(--fg-mute)]">
            {run.tracePath}
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="mt-4 ml-8">
          {loading ? (
            <ActivityDetailSkeleton />
          ) : detailError ? (
            <p className="rounded-sm bg-[var(--bad)]/10 px-2 py-1.5 font-mono text-[11px] text-[var(--bad)]">
              {detailError}
            </p>
          ) : detail ? (
            <ActivityDetail detail={detail} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ActivityDetail({ detail }: { detail: IngestActivityDetail }): React.ReactElement {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-l border-[var(--hairline-strong)] pl-3 font-mono text-[11.5px] text-[var(--fg-mute)]">
        <span>{detail.sessionId}</span>
        {detail.relatedSessionIds.map((sessionId) => (
          <span key={sessionId}>related {shortSessionId(sessionId)}</span>
        ))}
        {detail.errorMessage ? (
          <span className="text-[var(--bad)]">{detail.errorMessage}</span>
        ) : null}
      </div>

      {detail.items.length === 0 ? (
        <p className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-3 text-[12.5px] text-[var(--fg-dim)]">
          No item-level activity was recorded for this run.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-[var(--hairline)]">
          <div className="hidden grid-cols-[110px_minmax(160px,1fr)_minmax(160px,1fr)_120px] gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-[var(--fg-mute)] md:grid">
            <span>Status</span>
            <span>Source</span>
            <span>Organized</span>
            <span>Time</span>
          </div>
          <div className="divide-y divide-[var(--hairline)]">
            {detail.items.map((item) => (
              <ActivityItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {detail.itemsTruncated ? (
        <p className="font-mono text-[11.5px] text-[var(--fg-mute)]">
          Showing the first {detail.items.length.toLocaleString()} item events.
        </p>
      ) : null}
    </div>
  );
}

function ActivityItemRow({ item }: { item: IngestActivityItem }): React.ReactElement {
  const sourceLabel = item.title ?? item.rawPath ?? item.sourceId ?? item.stage;
  const organized =
    item.primaryPath ?? firstPath(item.writtenPaths) ?? item.reason ?? item.message ?? "";
  return (
    <div className="grid gap-2 px-3 py-3 text-[12.5px] md:grid-cols-[110px_minmax(160px,1fr)_minmax(160px,1fr)_120px] md:gap-3">
      <div>
        <Badge tone={itemTone(item.status)}>{item.status}</Badge>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[var(--fg)]">{sourceLabel}</p>
        <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-mute)]">
          {item.rawPath ?? item.sourceId ?? item.operation}
        </p>
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "truncate",
            item.status === "failed" ? "text-[var(--bad)]" : "text-[var(--fg-dim)]",
          )}
        >
          {organized || "no path"}
        </p>
        {item.projectPaths.length > 0 || item.peoplePaths.length > 0 ? (
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-mute)]">
            {[...item.projectPaths, ...item.peoplePaths].slice(0, 3).join("  ")}
          </p>
        ) : null}
        {item.classificationReasons.length > 0 ? (
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-mute)]">
            {item.classificationReasons.slice(0, 2).map(classificationReasonLabel).join("  ")}
          </p>
        ) : null}
        {item.extractionRunIds.length > 0 || item.actionCandidateIds.length > 0 ? (
          <p className="mt-1 truncate font-mono text-[11px] text-[var(--fg-mute)]">
            daily.todo {item.extractionRunIds.map(shortSessionId).join("  ")}
            {item.actionCandidateIds.length > 0
              ? `  ${item.actionCandidateIds.length} candidate${
                  item.actionCandidateIds.length === 1 ? "" : "s"
                }`
              : ""}
          </p>
        ) : null}
      </div>
      <div className="font-mono text-[11px] text-[var(--fg-mute)]">{formatTime(item.ts)}</div>
    </div>
  );
}

function classificationReasonLabel(
  reason: IngestActivityItem["classificationReasons"][number],
): string {
  const source = reason.source === "taxonomy" ? "taxonomy" : "generic";
  return `${source}:${reason.kind}:${reason.label}`;
}

function MetricPill({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: number;
  bad?: boolean;
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-[var(--hairline)] px-1.5 py-0.5 font-mono text-[11px]",
        bad ? "text-[var(--bad)]" : "text-[var(--fg-dim)]",
      )}
    >
      <span>{label}</span>
      <span>{value.toLocaleString()}</span>
    </span>
  );
}

function ActivitySkeleton(): React.ReactElement {
  return (
    <div className="space-y-3 py-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="space-y-2 px-1">
          <div className="h-3 w-64 rounded-sm bg-[var(--surface-2)]" />
          <div className="h-2.5 w-96 max-w-full rounded-sm bg-[var(--surface-2)]" />
        </div>
      ))}
    </div>
  );
}

function ActivityDetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-2 rounded-md border border-[var(--hairline)] p-3">
      <div className="h-2.5 w-56 rounded-sm bg-[var(--surface-2)]" />
      <div className="h-2.5 w-full rounded-sm bg-[var(--surface-2)]" />
      <div className="h-2.5 w-3/4 rounded-sm bg-[var(--surface-2)]" />
    </div>
  );
}

function activityTotals(runs: IngestActivityRun[]) {
  return runs.reduce(
    (totals, run) => ({
      rawWritten: totals.rawWritten + run.counts.rawWritten,
      rawIndexed: totals.rawIndexed + run.counts.rawIndexed,
      skipped: totals.skipped + run.counts.rawSkipped + run.counts.rawIndexSkipped,
      failures: totals.failures + run.counts.failures,
    }),
    { rawWritten: 0, rawIndexed: 0, skipped: 0, failures: 0 },
  );
}

function statusTone(status: IngestActivityRun["status"]): "bad" | "muted" | "ready" | "warning" {
  if (status === "completed") return "ready";
  if (status === "failed") return "bad";
  if (status === "interrupted") return "warning";
  return "muted";
}

function itemTone(status: IngestActivityItem["status"]): "bad" | "muted" | "ready" | "warning" {
  if (status === "failed") return "bad";
  if (status === "skipped") return "warning";
  if (status === "written" || status === "indexed" || status === "completed") return "ready";
  return "muted";
}

function shortSessionId(sessionId: string): string {
  return sessionId.length > 18 ? `${sessionId.slice(0, 12)}...${sessionId.slice(-4)}` : sessionId;
}

function firstPath(paths: string[]): string | null {
  return paths[0] ?? null;
}

function activityDetailKey(sessionId: string, resultFilterKey: string): string {
  return `${resultFilterKey || "none"}:${sessionId}`;
}

function orderResultFilters(filters: IngestActivityResultFilter[]): IngestActivityResultFilter[] {
  const selected = new Set(filters);
  return RESULT_FILTER_OPTIONS.map((option) => option.value).filter((value) => selected.has(value));
}

function resultFilterLabel(filters: IngestActivityResultFilter[]): string {
  if (filters.length === 0) {
    return "No result types";
  }
  if (filters.length === RESULT_FILTER_OPTIONS.length) {
    return "All";
  }
  if (sameResultFilters(filters, DEFAULT_RESULT_FILTERS)) {
    return "Source files + wiki updates";
  }
  if (filters.length === 1) {
    return RESULT_FILTER_OPTIONS.find((option) => option.value === filters[0])?.label ?? "Results";
  }
  return `${filters.length} result types`;
}

function sameResultFilters(
  left: IngestActivityResultFilter[],
  right: IngestActivityResultFilter[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const selected = new Set(left);
  return right.every((filter) => selected.has(filter));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
