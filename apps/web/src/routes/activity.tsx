import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileText,
  GitBranch,
  ListFilter,
  RefreshCw,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Callout } from "@/components/shared/callout";
import { Chip } from "@/components/shared/chip";
import { StatCard } from "@/components/shared/stat-card";
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
import { Skeleton } from "@/components/ui/skeleton";
import type {
  IngestActivityDetail,
  IngestActivityItem,
  IngestActivityResultFilter,
  IngestActivityRun,
  IngestActivitySource,
} from "@/lib/api";
import { useIngestActivity, useIngestActivityDetail } from "@/lib/queries/activity";
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
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const resultFilterKey = resultFilters.join(",");

  const activityQuery = useIngestActivity({ source, resultFilters });
  const detailQuery = useIngestActivityDetail(expandedSessionId, resultFilters);

  const runs = useMemo(() => activityQuery.data ?? [], [activityQuery.data]);
  const loaded = !activityQuery.isPending;
  const error = activityQuery.error ? messageOf(activityQuery.error) : null;
  const isPending = activityQuery.isFetching;

  // Collapse the open row when the result-filter selection changes (the detail
  // is filter-scoped, so a stale expansion would show the wrong slice).
  // biome-ignore lint/correctness/useExhaustiveDependencies: collapse on filter-key change
  useEffect(() => {
    setExpandedSessionId(null);
  }, [resultFilterKey]);

  const totals = useMemo(() => activityTotals(runs), [runs]);
  const todayKey = useMemo(() => localDateKey(new Date()), []);
  const groups = useMemo(() => groupRunsByDay(runs, todayKey), [runs, todayKey]);

  const handleRefresh = () => {
    void activityQuery.refetch();
  };

  const toggleRun = useCallback((run: IngestActivityRun) => {
    setExpandedSessionId((current) => (current === run.sessionId ? null : run.sessionId));
  }, []);

  const renderRow = (run: IngestActivityRun, nested: boolean): React.ReactElement => {
    const expanded = expandedSessionId === run.sessionId;
    return (
      <ActivityRunRow
        key={run.sessionId}
        run={run}
        nested={nested}
        expanded={expanded}
        detail={expanded ? (detailQuery.data ?? null) : null}
        detailError={expanded && detailQuery.error ? messageOf(detailQuery.error) : null}
        loading={expanded && detailQuery.isFetching}
        onToggle={() => toggleRun(run)}
      />
    );
  };

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<Activity size={15} strokeWidth={1.75} />}
        title="Ingest Activity"
        description="Source pulls, raw-to-wiki indexing, schedules, and the trace sessions behind them."
        actions={
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
        }
      />

      <ActivityStats runs={runs.length} totals={totals} />

      <section className="flex flex-wrap items-center gap-2">
        <SourceFilter value={source} onChange={setSource} />
        <div className="w-full sm:ml-auto sm:w-auto">
          <ResultFilterSelect value={resultFilters} onChange={setResultFilters} />
        </div>
      </section>

      {error ? <Callout label="activity error">{error}</Callout> : null}

      {!loaded ? (
        <section className="border-y border-hairline">
          <ActivitySkeleton />
        </section>
      ) : runs.length === 0 ? (
        <section className="border-y border-hairline py-12 text-center text-sm text-fg-dim">
          No ingest activity found for this filter.
        </section>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-1.5">
              <div className="flex items-center gap-2 px-1">
                <h2 className="text-xs font-medium tracking-tight text-fg-dim">{group.label}</h2>
                <Badge tone="muted">{group.runCount}</Badge>
              </div>
              <div className="divide-y divide-hairline border-y border-hairline">
                {group.nodes.map((node) => (
                  <div key={node.run.sessionId}>
                    {renderRow(node.run, false)}
                    {node.children.length > 0 ? (
                      <div className="ml-[26px] border-l border-hairline pl-2">
                        {node.children.map((child) => renderRow(child, true))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
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
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full justify-between px-2.5 sm:w-auto sm:min-w-[190px]"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <ListFilter size={13} strokeWidth={2} />
              <span className="truncate">{label}</span>
            </span>
            <ChevronDown size={13} strokeWidth={2} className="text-fg-mute" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72 border-hairline bg-surface p-1.5 text-fg">
        <DropdownMenuLabel className="px-2 py-1 label-eyebrow">Result type</DropdownMenuLabel>
        {RESULT_FILTER_OPTIONS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={selected.has(option.value)}
            onCheckedChange={(checked) => toggleFilter(option.value, checked === true)}
            closeOnClick={false}
            className="items-start rounded-md py-2 pr-2 text-sm data-highlighted:bg-surface-2"
          >
            <span className="grid gap-0.5">
              <span className="font-medium text-fg">{option.label}</span>
              <span className="text-xs leading-snug text-fg-mute">{option.description}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator className="my-1 bg-hairline" />
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_RESULT_FILTERS)}
            className="h-7 rounded-sm px-2 text-xs font-medium text-fg-dim hover:bg-surface-2 hover:text-fg"
          >
            Default
          </button>
          <button
            type="button"
            onClick={() => onChange(ALL_RESULT_FILTERS)}
            className="h-7 rounded-sm px-2 text-xs font-medium text-fg-dim hover:bg-surface-2 hover:text-fg"
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
    <div className="flex flex-wrap rounded-md border border-hairline p-0.5">
      {SOURCE_FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => onChange(filter.value)}
          className={cn(
            "h-8 min-w-16 flex-1 rounded-[5px] px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === filter.value ? "bg-surface-2 text-fg" : "text-fg-dim hover:text-fg",
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
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Runs" value={runs} icon={GitBranch} />
        <StatCard label="Files added" value={totals.rawWritten} icon={Database} />
        <StatCard label="Wiki updates" value={totals.rawIndexed} icon={FileText} />
        <StatCard label="Failures" value={totals.failures} icon={AlertTriangle} danger />
      </div>
      {totals.skipped > 0 ? (
        <p className="px-1 text-xs text-fg-mute">
          {totals.skipped.toLocaleString()} already-seen items skipped across these runs.
        </p>
      ) : null}
    </div>
  );
}

function ActivityRunRow({
  run,
  nested,
  expanded,
  detail,
  detailError,
  loading,
  onToggle,
}: {
  run: IngestActivityRun;
  nested: boolean;
  expanded: boolean;
  detail: IngestActivityDetail | null;
  detailError: string | null;
  loading: boolean;
  onToggle(): void;
}): React.ReactElement {
  const StageIcon = stageIcon(run);
  const outcome = runOutcome(run);
  const statusChip = nonDefaultStatusLabel(run.status);
  return (
    <div className={cn(nested ? "py-2.5" : "py-3")}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-start gap-2.5 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="pt-0.5 text-fg-mute">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span
          aria-hidden="true"
          className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", statusDotClass(run.status))}
        />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <StageIcon size={13} strokeWidth={2} className="shrink-0 text-fg-mute" />
            <span
              className={cn(
                "min-w-0 truncate font-medium tracking-tight text-fg",
                nested ? "text-sm" : "text-base",
              )}
            >
              {run.title}
            </span>
            {run.source && run.source !== "all" && run.source !== "unknown" ? (
              <Chip>{titleCase(run.source)}</Chip>
            ) : null}
            {run.dryRun === true ? <Chip tone="warning">preview</Chip> : null}
            {statusChip ? <Chip tone={statusChipTone(run.status)}>{statusChip}</Chip> : null}
          </span>
          <span className="mt-1 block truncate text-xs text-fg-mute">
            <span className={outcomeClass(outcome.tone)}>{outcome.text}</span>
          </span>
        </span>
        <span
          className="shrink-0 whitespace-nowrap pt-0.5 text-xs text-fg-mute"
          title={formatAbsolute(run.startedAt)}
        >
          {relativeTime(run.startedAt)}
        </span>
      </button>

      {expanded ? (
        <div className="ml-[26px] mt-3">
          {loading ? (
            <ActivityDetailSkeleton />
          ) : detailError ? (
            <p className="rounded-sm bg-bad/10 px-2 py-1.5 font-mono text-2xs text-bad">
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
  const duration = runDuration(detail.startedAt, detail.endedAt);
  return (
    <div className="space-y-4">
      <dl className="grid gap-x-6 gap-y-2 rounded-md border border-hairline bg-surface p-3 sm:grid-cols-2">
        <MetaRow label="Operation" value={detail.operation} mono />
        {duration ? <MetaRow label="Duration" value={duration} /> : null}
        <MetaCopyRow label="Session" value={detail.sessionId} />
        {detail.parentSessionId ? (
          <MetaCopyRow label="Parent run" value={detail.parentSessionId} />
        ) : null}
        {detail.scheduleId ? (
          <MetaCopyRow
            label="Schedule"
            value={detail.scheduleId}
            display={detail.scheduleName ?? detail.scheduleId}
          />
        ) : null}
        <MetaCopyRow label="Trace file" value={detail.tracePath} className="sm:col-span-2" />
      </dl>

      {detail.errorMessage ? (
        <p className="rounded-md border border-bad/40 bg-bad/[0.06] px-3 py-2 text-sm text-bad">
          {detail.errorMessage}
        </p>
      ) : null}

      {detail.items.length === 0 ? (
        <p className="rounded-md border border-hairline bg-surface px-3 py-3 text-sm text-fg-dim">
          No item-level activity was recorded for this run.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-hairline">
          <div className="hidden grid-cols-[110px_minmax(160px,1fr)_minmax(160px,1fr)_120px] gap-3 border-b border-hairline bg-surface px-3 py-2 label-eyebrow md:grid">
            <span>Status</span>
            <span>Source</span>
            <span>Organized</span>
            <span>Time</span>
          </div>
          <div className="divide-y divide-hairline">
            {detail.items.map((item) => (
              <ActivityItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {detail.itemsTruncated ? (
        <p className="font-mono text-xs text-fg-mute">
          Showing the first {detail.items.length.toLocaleString()} item events.
        </p>
      ) : null}
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-24 shrink-0 label-eyebrow">{label}</dt>
      <dd className={cn("min-w-0 truncate text-sm text-fg-dim", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function MetaCopyRow({
  label,
  value,
  display,
  className,
}: {
  label: string;
  value: string;
  display?: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex items-baseline gap-2", className)}>
      <dt className="w-24 shrink-0 label-eyebrow">{label}</dt>
      <dd className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate font-mono text-xs text-fg-dim" title={value}>
          {display ?? value}
        </span>
        <CopyButton value={value} label={label} />
      </dd>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable (non-secure context); silently ignore.
    }
  }, [value]);
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
      className="flex size-5 shrink-0 items-center justify-center rounded text-fg-mute transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? (
        <Check size={12} strokeWidth={2} className="text-good" />
      ) : (
        <Copy size={12} strokeWidth={2} />
      )}
    </button>
  );
}

function ActivityItemRow({ item }: { item: IngestActivityItem }): React.ReactElement {
  const sourceLabel = item.title ?? item.rawPath ?? item.sourceId ?? item.stage;
  const organized =
    item.primaryPath ?? firstPath(item.writtenPaths) ?? item.reason ?? item.message ?? "";
  return (
    <div className="grid gap-2 px-3 py-3 text-sm md:grid-cols-[110px_minmax(160px,1fr)_minmax(160px,1fr)_120px] md:gap-3">
      <div>
        <Badge tone={itemTone(item.status)}>{item.status}</Badge>
      </div>
      <div className="min-w-0">
        <p className="truncate text-fg">{sourceLabel}</p>
        <p className="mt-1 truncate font-mono text-2xs text-fg-mute">
          {item.rawPath ?? item.sourceId ?? item.operation}
        </p>
      </div>
      <div className="min-w-0">
        <p className={cn("truncate", item.status === "failed" ? "text-bad" : "text-fg-dim")}>
          {organized || "no path"}
        </p>
        {item.projectPaths.length > 0 || item.peoplePaths.length > 0 ? (
          <p className="mt-1 truncate font-mono text-2xs text-fg-mute">
            {[...item.projectPaths, ...item.peoplePaths].slice(0, 3).join("  ")}
          </p>
        ) : null}
        {item.classificationReasons.length > 0 ? (
          <p className="mt-1 truncate font-mono text-2xs text-fg-mute">
            {item.classificationReasons.slice(0, 2).map(classificationReasonLabel).join("  ")}
          </p>
        ) : null}
      </div>
      <div className="font-mono text-2xs text-fg-mute">{formatTime(item.ts)}</div>
    </div>
  );
}

function classificationReasonLabel(
  reason: IngestActivityItem["classificationReasons"][number],
): string {
  const source = reason.source === "taxonomy" ? "taxonomy" : "generic";
  return `${source}:${reason.kind}:${reason.label}`;
}

function ActivitySkeleton(): React.ReactElement {
  return (
    <div className="divide-y divide-hairline">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-start gap-2.5 px-1 py-3">
          <Skeleton className="mt-0.5 size-3.5" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-64 max-w-full" />
            <Skeleton className="h-2.5 w-40" />
          </div>
          <Skeleton className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

function ActivityDetailSkeleton(): React.ReactElement {
  return (
    <div className="space-y-2 rounded-md border border-hairline p-3">
      <Skeleton className="h-2.5 w-56" />
      <Skeleton className="h-2.5 w-full" />
      <Skeleton className="h-2.5 w-3/4" />
    </div>
  );
}

type RunNode = { run: IngestActivityRun; children: IngestActivityRun[] };
type DayGroup = { key: string; label: string; nodes: RunNode[]; runCount: number };

function groupRunsByDay(runs: IngestActivityRun[], todayKey: string): DayGroup[] {
  const byId = new Map(runs.map((run) => [run.sessionId, run]));
  const dayOf = (run: IngestActivityRun): string => localDateKey(new Date(run.startedAt));
  // Walk up to the topmost ancestor that is present in the set and shares the
  // run's day, so a scheduled job and its child index runs group together while
  // a filtered-out parent gracefully leaves the child as its own root.
  const rootOf = (run: IngestActivityRun): IngestActivityRun => {
    let current = run;
    const guard = new Set<string>();
    while (current.parentSessionId && !guard.has(current.sessionId)) {
      guard.add(current.sessionId);
      const parent = byId.get(current.parentSessionId);
      if (parent === undefined || dayOf(parent) !== dayOf(run)) {
        break;
      }
      current = parent;
    }
    return current;
  };

  const childrenByRoot = new Map<string, IngestActivityRun[]>();
  const roots: IngestActivityRun[] = [];
  for (const run of runs) {
    const root = rootOf(run);
    if (root.sessionId === run.sessionId) {
      roots.push(run);
      if (!childrenByRoot.has(run.sessionId)) {
        childrenByRoot.set(run.sessionId, []);
      }
    } else {
      const list = childrenByRoot.get(root.sessionId);
      if (list === undefined) {
        childrenByRoot.set(root.sessionId, [run]);
      } else {
        list.push(run);
      }
    }
  }

  const groups: DayGroup[] = [];
  const groupByKey = new Map<string, DayGroup>();
  for (const root of roots) {
    const key = dayOf(root);
    let group = groupByKey.get(key);
    if (group === undefined) {
      group = { key, label: dayLabel(key, todayKey), nodes: [], runCount: 0 };
      groupByKey.set(key, group);
      groups.push(group);
    }
    const children = childrenByRoot.get(root.sessionId) ?? [];
    group.nodes.push({ run: root, children });
    group.runCount += 1 + children.length;
  }
  return groups;
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

function runOutcome(run: IngestActivityRun): { text: string; tone: "bad" | "fg" | "muted" } {
  const counts = run.counts;
  if (run.status === "failed" || counts.failures > 0) {
    return {
      text: counts.failures > 0 ? `${pluralize(counts.failures, "failure")}` : "Failed",
      tone: "bad",
    };
  }
  if (run.status === "running") {
    return { text: "Running…", tone: "muted" };
  }
  const parts: string[] = [];
  if (counts.rawWritten > 0) {
    parts.push(pluralize(counts.rawWritten, "new file"));
  }
  if (counts.rawIndexed > 0) {
    parts.push(`${counts.rawIndexed.toLocaleString()} indexed`);
  }
  if (counts.wikiPagesTouched > 0) {
    parts.push(pluralize(counts.wikiPagesTouched, "wiki page"));
  }
  if (counts.searchIndexed > 0) {
    parts.push(pluralize(counts.searchIndexed, "search doc"));
  }
  if (parts.length > 0) {
    return { text: parts.join(" · "), tone: "fg" };
  }
  const skipped = counts.rawSkipped + counts.rawIndexSkipped;
  if (skipped > 0) {
    return { text: `No changes · ${skipped.toLocaleString()} already seen`, tone: "muted" };
  }
  const summary = run.summary?.trim();
  return { text: summary && summary.length > 0 ? summary : "No changes", tone: "muted" };
}

function outcomeClass(tone: "bad" | "fg" | "muted"): string {
  if (tone === "bad") return "text-bad";
  if (tone === "fg") return "text-fg-dim";
  return "text-fg-mute";
}

function stageIcon(
  run: IngestActivityRun,
): React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> {
  if (run.stage === "job") return GitBranch;
  if (run.stage === "connector") return Database;
  return FileText;
}

function statusChipTone(status: IngestActivityRun["status"]): "bad" | "neutral" | "warning" {
  if (status === "failed") return "bad";
  if (status === "interrupted") return "warning";
  return "neutral";
}

function statusDotClass(status: IngestActivityRun["status"]): string {
  if (status === "completed") return "bg-good";
  if (status === "failed") return "bg-bad";
  if (status === "interrupted") return "bg-warn";
  return "bg-fg-mute";
}

// Status words worth showing as a chip. "completed" is the common case and is
// already conveyed by the green dot, so it is omitted to cut repetition.
function nonDefaultStatusLabel(status: IngestActivityRun["status"]): string | null {
  if (status === "completed") return null;
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  if (status === "running") return "running";
  return status;
}

function itemTone(status: IngestActivityItem["status"]): "bad" | "muted" | "ready" | "warning" {
  if (status === "failed") return "bad";
  if (status === "skipped") return "warning";
  if (status === "written" || status === "indexed" || status === "completed") return "ready";
  return "muted";
}

function pluralize(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function firstPath(paths: string[]): string | null {
  return paths[0] ?? null;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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

function runDuration(startedAt: string, endedAt: string | null): string | null {
  if (endedAt === null) {
    return null;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return null;
  }
  const ms = end - start;
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return value;
  }
  const diff = Date.now() - then;
  const seconds = Math.round(diff / 1000);
  if (seconds < 45) {
    return "just now";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(then),
  );
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) {
    return "Today";
  }
  const date = new Date(`${key}T00:00:00`);
  const today = new Date(`${todayKey}T00:00:00`);
  const diffDays = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (diffDays === 1) {
    return "Yesterday";
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAbsolute(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
