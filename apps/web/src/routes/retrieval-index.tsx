import { Link } from "@tanstack/react-router";
import {
  CalendarClock,
  Database,
  FileText,
  Layers3,
  Link2,
  Play,
  RefreshCw,
  SearchCheck,
} from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Callout } from "@/components/shared/callout";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type {
  RetrievalIndexRefreshInput,
  RetrievalIndexRefreshResult,
  RetrievalIndexStatus,
} from "@/lib/api";
import { useRefreshRetrievalIndex, useRetrievalIndexStatus } from "@/lib/queries/retrieval-index";
import { cn } from "@/lib/utils";

type RetrievalIndexSource = NonNullable<RetrievalIndexRefreshInput["source"]>;

const SOURCE_OPTIONS: Array<{ value: RetrievalIndexSource; label: string }> = [
  { value: "all", label: "All sources" },
  { value: "granola", label: "Granola" },
  { value: "notion", label: "Notion" },
  { value: "slack", label: "Slack" },
];

export function RetrievalIndexPage(): React.ReactElement {
  const statusQuery = useRetrievalIndexStatus();
  const refreshMutation = useRefreshRetrievalIndex();
  const [source, setSource] = useState<RetrievalIndexSource>("all");
  const [includeRaw, setIncludeRaw] = useState(true);

  const status = statusQuery.data ?? emptyStatus();
  const isBusy = refreshMutation.isPending;
  const statusLoading = statusQuery.isPending;
  const schemaOutdated = !statusLoading && status.schema === "outdated";
  const indexEmpty = !statusLoading && !schemaOutdated && !status.indexed;

  function runRefresh(): void {
    refreshMutation.mutate({ source, includeRaw });
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Retrieval Index"
        description="Document, chunk, and link state behind wiki search and complex agent retrieval."
        icon={<Database size={16} strokeWidth={1.75} />}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => statusQuery.refetch()}
              disabled={statusQuery.isFetching || isBusy}
            >
              {statusQuery.isFetching ? <Spinner /> : <RefreshCw size={14} strokeWidth={1.75} />}
              Refresh
            </Button>
            <Button type="button" size="sm" onClick={runRefresh} disabled={isBusy}>
              {isBusy ? <Spinner /> : <Play size={14} strokeWidth={1.75} />}
              Reindex
            </Button>
          </>
        }
      />

      {statusQuery.error ? (
        <Callout tone="bad" label="index status error">
          {messageOf(statusQuery.error)}
        </Callout>
      ) : null}
      {refreshMutation.error ? (
        <Callout tone="bad" label="reindex error">
          {messageOf(refreshMutation.error)}
        </Callout>
      ) : null}

      {schemaOutdated ? (
        <Callout tone="warn" label="schema outdated">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              The retrieval index schema is out of date. Reindex to rebuild the derived tables.
            </span>
            <Button type="button" size="sm" onClick={runRefresh} disabled={isBusy}>
              {isBusy ? <Spinner /> : <Play size={13} strokeWidth={1.75} />}
              Reindex now
            </Button>
          </div>
        </Callout>
      ) : null}
      {indexEmpty ? (
        <Callout tone="neutral" label="no index yet">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              No retrieval index has been built yet. Reindex to populate it from the wiki.
            </span>
            <Button type="button" size="sm" onClick={runRefresh} disabled={isBusy}>
              {isBusy ? <Spinner /> : <Play size={13} strokeWidth={1.75} />}
              Build index
            </Button>
          </div>
        </Callout>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusLoading ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <MetricCard
              icon={<FileText size={15} strokeWidth={1.75} />}
              label="Documents"
              value={formatInteger(status.documents.total)}
              detail={`${formatInteger(status.documents.curated)} curated · ${formatInteger(status.documents.sources)} source · ${formatInteger(status.documents.raw)} raw`}
            />
            <MetricCard
              icon={<Layers3 size={15} strokeWidth={1.75} />}
              label="Chunks"
              value={formatInteger(status.chunks)}
              detail="Retrieval passages"
            />
            <MetricCard
              icon={<Link2 size={15} strokeWidth={1.75} />}
              label="Links"
              value={formatInteger(status.links)}
              detail="Graph expansion edges"
            />
            <MetricCard
              icon={<SearchCheck size={15} strokeWidth={1.75} />}
              label="State"
              value={statusLabel(status)}
              detail={
                status.lastIndexedAt === null
                  ? "Never indexed"
                  : `Indexed ${formatTimestamp(status.lastIndexedAt)}`
              }
              tone={status.indexed ? "ready" : status.schema === "outdated" ? "warning" : "muted"}
            />
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
        <Panel
          title="Manual reindex"
          description="Rebuilds derived SQLite retrieval tables from the current wiki."
          aside={
            <Badge tone={includeRaw ? "warning" : "muted"}>
              {includeRaw ? "raw included" : "curated only"}
            </Badge>
          }
        >
          <div className="grid gap-5 md:grid-cols-[minmax(220px,0.42fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <label className="block space-y-2">
                <Eyebrow>Source scope</Eyebrow>
                <Select
                  value={source}
                  onValueChange={(value) => setSource(value as RetrievalIndexSource)}
                  disabled={isBusy}
                >
                  <SelectTrigger className="border-hairline bg-bg-elev text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-bg-elev px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">Raw evidence</p>
                  <p className="text-xs text-fg-mute">Include immutable source snapshots.</p>
                </div>
                <Switch
                  checked={includeRaw}
                  onCheckedChange={setIncludeRaw}
                  disabled={isBusy}
                  aria-label="Include raw evidence"
                />
              </div>
            </div>

            <RefreshResultPanel result={refreshMutation.data ?? null} busy={isBusy} />
          </div>
        </Panel>

        <Panel
          title="Automation"
          description="Schedule index and hygiene refreshes as Routines."
          aside={
            <Button asChild variant="outline" size="sm">
              <Link to="/routines">
                <CalendarClock size={14} strokeWidth={1.75} />
                Routines
              </Link>
            </Button>
          }
        >
          <p className="rounded-md border border-dashed border-hairline bg-bg-elev px-3 py-4 text-sm text-fg-dim">
            Recurring index refreshes and wiki hygiene now run as Routines. Create one from the{" "}
            <span className="font-medium text-fg">Index refresh</span> or{" "}
            <span className="font-medium text-fg">Wiki hygiene</span> template on the Routines page,
            then add a trigger to run it on a schedule.
          </p>
        </Panel>
      </div>
    </PageContainer>
  );
}

/** Section shell with a header row (title + description + optional aside) and body. */
function Panel({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-md border border-hairline bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-4 border-hairline border-b p-5">
        <div className="min-w-0">
          <h2 className="text-sm font-medium tracking-tight text-fg">{title}</h2>
          <p className="mt-1 max-w-xl text-sm text-fg-dim">{description}</p>
        </div>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone = "muted",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: "ready" | "warning" | "muted";
}): React.ReactElement {
  return (
    <div className="rounded-md border border-hairline bg-surface px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{label}</Eyebrow>
        <span className="text-fg-mute">{icon}</span>
      </div>
      <p
        className={cn(
          "mt-2.5 font-mono text-2xl leading-none tracking-tight",
          tone === "ready" ? "text-good" : tone === "warning" ? "text-warn" : "text-fg",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-xs text-fg-dim">{detail}</p>
    </div>
  );
}

function MetricSkeleton(): React.ReactElement {
  return (
    <div className="rounded-md border border-hairline bg-surface px-4 py-3.5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-3.5 h-7 w-24" />
      <Skeleton className="mt-2.5 h-3 w-28" />
    </div>
  );
}

function RefreshResultPanel({
  result,
  busy,
}: {
  result: RetrievalIndexRefreshResult | null;
  busy: boolean;
}): React.ReactElement {
  if (busy) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-md border border-hairline bg-bg-elev text-sm text-fg-dim">
        <Spinner className="mr-2" />
        Rebuilding retrieval tables
      </div>
    );
  }

  if (result === null) {
    return (
      <div className="min-h-40 rounded-md border border-dashed border-hairline bg-bg-elev p-4">
        <Badge tone="muted">ready</Badge>
        <p className="mt-4 max-w-md text-sm text-fg-dim">
          Reindex runs as a trace-backed job and reports fresh document, chunk, and link counts
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-40 rounded-md border border-hairline bg-bg-elev p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={result.run.status === "completed" ? "ready" : "bad"}>
          {result.run.status}
        </Badge>
        <code className="rounded border border-hairline bg-surface-2 px-2 py-1 text-xs text-fg-dim">
          {result.run.sessionId}
        </code>
      </div>
      <p className="mt-4 text-sm text-fg">{result.run.summary}</p>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <ResultStat label="Docs" value={result.status.documents.total} />
        <ResultStat label="Chunks" value={result.status.chunks} />
        <ResultStat label="Links" value={result.status.links} />
      </dl>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <dt className="label-eyebrow text-fg-mute">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-fg">{formatInteger(value)}</dd>
    </div>
  );
}

function emptyStatus(): RetrievalIndexStatus {
  return {
    indexed: false,
    schema: "missing",
    lastIndexedAt: null,
    documents: { total: 0, curated: 0, sources: 0, raw: 0 },
    chunks: 0,
    links: 0,
    byKind: [],
    bySource: [],
  };
}

function statusLabel(status: RetrievalIndexStatus): string {
  if (status.schema === "outdated") {
    return "Upgrade";
  }
  return status.indexed ? "Ready" : "Empty";
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
