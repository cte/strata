import { Check, Clock, FileCheck2, FileText, RefreshCw, Split, X } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import {
  acceptProposal,
  deferProposal,
  getProposal,
  listProposals,
  type ProposalDetail,
  type ProposalStatusFilter,
  type ProposalSummary,
  rejectProposal,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { label: string; value: ProposalStatusFilter }[] = [
  { label: "Pending", value: "pending" },
  { label: "Deferred", value: "deferred" },
  { label: "Applied", value: "applied" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

type ProposalAction = "accept" | "reject" | "defer";

export function ProposalsPage(): React.ReactElement {
  const [status, setStatus] = useState<ProposalStatusFilter>("pending");
  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<ProposalAction | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    setListError(null);
    const nextProposals = await listProposals({ status, limit: 100 });
    setProposals(nextProposals);
    setSelectedId((current) => {
      if (current !== null && nextProposals.some((proposal) => proposal.id === current)) {
        return current;
      }
      return nextProposals[0]?.id ?? null;
    });
    setLoaded(true);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setProposals([]);
    setSelectedId(null);
    setDetail(null);
    listProposals({ status, limit: 100 }).then(
      (nextProposals) => {
        if (!cancelled) {
          setProposals(nextProposals);
          setSelectedId(nextProposals[0]?.id ?? null);
          setLoaded(true);
          setListError(null);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setListError(cause instanceof Error ? cause.message : String(cause));
          setLoaded(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    getProposal(selectedId).then(
      (nextDetail) => {
        if (!cancelled) {
          setDetail(nextDetail);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setDetailError(cause instanceof Error ? cause.message : String(cause));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const totals = useMemo(() => summarizeProposals(proposals), [proposals]);

  const handleRefresh = () => {
    startTransition(async () => {
      try {
        await refresh();
      } catch (cause: unknown) {
        setListError(cause instanceof Error ? cause.message : String(cause));
        setLoaded(true);
      }
    });
  };

  const runAction = async (action: ProposalAction) => {
    if (selectedId === null) {
      return;
    }
    const reason =
      action === "accept"
        ? undefined
        : window.prompt(`${actionProposalVerb(action)} reason`)?.trim();
    if (action !== "accept" && reason === undefined) {
      return;
    }

    setActionBusy(action);
    setActionError(null);
    setActionMessage(null);
    try {
      if (action === "accept") {
        const result = await acceptProposal(
          selectedId,
          undefined,
          detail?.apply.previewFingerprint,
        );
        setActionMessage(result.message);
      } else if (action === "reject") {
        const result = await rejectProposal(selectedId, reason);
        setActionMessage(`Rejected ${result.proposal.path}.`);
      } else {
        const result = await deferProposal(selectedId, reason);
        setActionMessage(`Deferred ${result.proposal.path}.`);
      }
      await refresh();
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <PageContainer width="wide" fill>
      <PageHeader
        icon={<FileCheck2 size={15} strokeWidth={1.75} />}
        title="Proposals"
        description="Review staged wiki, memory, skill, and schema changes before they touch durable state."
        actions={
          <>
            <ProposalStatusFilter value={status} onChange={setStatus} />
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

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-[var(--hairline)] bg-[var(--bg)] lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-3">
              <ProposalListHeader count={proposals.length} totals={totals} />
              {listError ? (
                <ErrorBlock label="proposal list error" message={listError} />
              ) : !loaded ? (
                <ProposalListSkeleton />
              ) : proposals.length === 0 ? (
                <p className="px-2 py-8 text-center text-[12.5px] text-[var(--fg-dim)]">
                  No proposals found.
                </p>
              ) : (
                <ProposalList
                  proposals={proposals}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </div>
          </ScrollArea>
        </aside>

        <section className="min-h-0 min-w-0 bg-[var(--bg)]">
          <ScrollArea className="h-full">
            <ProposalDetailPanel
              detail={detail}
              selectedId={selectedId}
              error={detailError}
              actionBusy={actionBusy}
              actionError={actionError}
              actionMessage={actionMessage}
              onAction={runAction}
            />
          </ScrollArea>
        </section>
      </div>
    </PageContainer>
  );
}

function ProposalStatusFilter({
  value,
  onChange,
}: {
  value: ProposalStatusFilter;
  onChange(value: ProposalStatusFilter): void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-5 rounded-md border border-[var(--hairline)] p-0.5">
      {STATUS_FILTERS.map((filter) => (
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

function ProposalListHeader({
  count,
  totals,
}: {
  count: number;
  totals: ReturnType<typeof summarizeProposals>;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 px-2">
      <div>
        <p className="label-eyebrow text-[var(--fg-mute)]">review queue</p>
        <p className="mt-1 text-[12.5px] text-[var(--fg-dim)]">
          {count.toLocaleString()} visible proposals
        </p>
      </div>
      <div className="flex items-center gap-3 font-mono text-[11px] text-[var(--fg-mute)]">
        <span>{totals.wiki} wiki</span>
        <span>{totals.skill} skill</span>
        <span>{totals.schema} schema</span>
      </div>
    </div>
  );
}

function ProposalList({
  proposals,
  selectedId,
  onSelect,
}: {
  proposals: ProposalSummary[];
  selectedId: string | null;
  onSelect(id: string): void;
}): React.ReactElement {
  return (
    <ul className="flex flex-col gap-1">
      {proposals.map((proposal) => (
        <li key={proposal.id}>
          <button
            type="button"
            onClick={() => onSelect(proposal.id)}
            className={cn(
              "flex w-full min-w-0 flex-col gap-2 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              selectedId === proposal.id &&
                "border-[var(--hairline)] bg-[var(--surface)] shadow-sm",
            )}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="line-clamp-2 min-w-0 text-[13px] font-medium text-[var(--fg)]">
                {proposal.title}
              </span>
              <ProposalStatusBadge status={proposal.status} />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--fg-mute)]">
              <span className="font-mono">{proposal.kind}</span>
              <span className="truncate font-mono">{proposal.id}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProposalDetailPanel({
  detail,
  selectedId,
  error,
  actionBusy,
  actionError,
  actionMessage,
  onAction,
}: {
  detail: ProposalDetail | null;
  selectedId: string | null;
  error: string | null;
  actionBusy: ProposalAction | null;
  actionError: string | null;
  actionMessage: string | null;
  onAction(action: ProposalAction): void;
}): React.ReactElement {
  if (selectedId === null) {
    return (
      <Empty className="min-h-[420px] justify-center">
        <EmptyHeader>
          <EmptyTitle>Select a proposal</EmptyTitle>
          <EmptyDescription>Choose an item from the review queue.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (error !== null) {
    return (
      <div className="p-4 md:p-8">
        <ErrorBlock label="proposal detail error" message={error} />
      </div>
    );
  }

  if (detail === null) {
    return <ProposalDetailSkeleton />;
  }

  const canAccept = detail.proposal.status === "pending" || detail.proposal.status === "deferred";

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--hairline)] pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={detail.proposal.status} />
            <span className="label-eyebrow text-[var(--fg-mute)]">{detail.proposal.kind}</span>
          </div>
          <h2 className="mt-2 text-[18px] font-medium tracking-tight text-[var(--fg)]">
            {detail.proposal.title}
          </h2>
          <p className="mt-1 break-all font-mono text-[11.5px] text-[var(--fg-mute)]">
            {detail.proposal.path}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!canAccept || !detail.apply.supported || actionBusy !== null}
            onClick={() => onAction("accept")}
          >
            <Check size={13} strokeWidth={2} />
            Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!canAccept || actionBusy !== null}
            onClick={() => onAction("defer")}
          >
            <Clock size={13} strokeWidth={2} />
            Defer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canAccept || actionBusy !== null}
            onClick={() => onAction("reject")}
          >
            <X size={13} strokeWidth={2} />
            Reject
          </Button>
        </div>
      </div>

      {actionError ? <ErrorBlock label="proposal action error" message={actionError} /> : null}
      {actionMessage ? (
        <div className="mb-4 rounded-md border border-[var(--good)]/30 bg-[var(--good)]/[0.06] p-3 text-[13px] text-[var(--fg-dim)]">
          {actionMessage}
        </div>
      ) : null}

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <ProposalMeta label="session" value={detail.proposal.sessionId} />
        <ProposalMeta label="created" value={formatDateTime(detail.proposal.created)} />
        <ProposalMeta
          label="apply"
          value={detail.apply.supported ? (detail.apply.targetPath ?? detail.apply.mode) : "manual"}
          muted={!detail.apply.supported}
        />
      </div>

      {detail.operationPlan ? <OperationPlanPanel operationPlan={detail.operationPlan} /> : null}

      <Message from="assistant" className="block">
        <MessageContent className="max-w-none rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-5 py-5 shadow-sm md:px-7 md:py-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={14} strokeWidth={1.75} className="shrink-0 text-[var(--fg-mute)]" />
              <span className="truncate text-[12.5px] text-[var(--fg-dim)]">
                {detail.apply.message}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void navigator.clipboard.writeText(detail.proposal.path)}
            >
              Copy path
            </Button>
          </div>
          <MessageResponse className="wiki-markdown">
            {stripProposalFrontmatter(detail.content)}
          </MessageResponse>
        </MessageContent>
      </Message>
    </div>
  );
}

function OperationPlanPanel({
  operationPlan,
}: {
  operationPlan: NonNullable<ProposalDetail["operationPlan"]>;
}): React.ReactElement {
  const tone = operationPlan.valid ? "ready" : "bad";
  const plan = operationPlan.plan;
  return (
    <section className="mb-5 rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{operationPlan.valid ? "valid plan" : "invalid plan"}</Badge>
            <Badge tone="muted">{operationPlan.readiness}</Badge>
            <span className="label-eyebrow text-[var(--fg-mute)]">{operationPlan.source}</span>
          </div>
          <p className="mt-2 text-[13px] text-[var(--fg-dim)]">{operationPlan.summary}</p>
        </div>
        <div className="text-right font-mono text-[11.5px] text-[var(--fg-mute)]">
          {operationPlan.applySupported ? "auto-apply" : "manual apply"}
        </div>
      </div>
      {plan ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ProposalMeta label="canonical" value={plan.canonicalPath} />
          <ProposalMeta label="sources" value={plan.sourcePaths.join(", ")} />
        </div>
      ) : null}
      {operationPlan.issues.length > 0 ? (
        <OperationPlanMessages tone="bad" title="issues" messages={operationPlan.issues} />
      ) : null}
      {operationPlan.warnings.length > 0 ? (
        <OperationPlanMessages tone="warning" title="warnings" messages={operationPlan.warnings} />
      ) : null}
      {operationPlan.diffs.length > 0 ? <OperationPlanDiffs diffs={operationPlan.diffs} /> : null}
    </section>
  );
}

function OperationPlanDiffs({
  diffs,
}: {
  diffs: NonNullable<ProposalDetail["operationPlan"]>["diffs"];
}): React.ReactElement {
  return (
    <div className="mt-4 border-t border-[var(--hairline)] pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="label-eyebrow text-[var(--fg-mute)]">mechanical diff previews</p>
        <span className="font-mono text-[11px] text-[var(--fg-mute)]">
          {diffs.length.toLocaleString()} item{diffs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="space-y-3">
        {diffs.map((diff, index) => (
          <OperationPlanDiffCard
            key={`${diff.operation}:${diff.targetPath}:${index}`}
            diff={diff}
          />
        ))}
      </div>
    </div>
  );
}

function OperationPlanDiffCard({
  diff,
}: {
  diff: NonNullable<ProposalDetail["operationPlan"]>["diffs"][number];
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--bg)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={diffStatusTone(diff.status)}>{diff.status}</Badge>
        <span className="label-eyebrow text-[var(--fg-mute)]">{diff.operation}</span>
        <span className="min-w-0 truncate font-mono text-[11.5px] text-[var(--fg-dim)]">
          {diff.targetPath}
        </span>
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--fg-dim)]">{diff.summary}</p>
      {diff.diff ? (
        <pre className="mt-3 max-h-72 overflow-auto rounded-sm border border-[var(--hairline)] bg-[var(--surface)] p-3 text-[11px] leading-5 text-[var(--fg)]">
          {diff.diff}
        </pre>
      ) : null}
      {diff.truncated ? (
        <p className="mt-2 font-mono text-[11px] text-[var(--warn)]">diff truncated</p>
      ) : null}
    </div>
  );
}

function diffStatusTone(
  status: NonNullable<ProposalDetail["operationPlan"]>["diffs"][number]["status"],
): "ready" | "warning" | "muted" | "bad" {
  if (status === "ready") {
    return "ready";
  }
  if (status === "missing") {
    return "bad";
  }
  if (status === "ambiguous") {
    return "bad";
  }
  if (status === "noMatches") {
    return "warning";
  }
  return "muted";
}

function OperationPlanMessages({
  tone,
  title,
  messages,
}: {
  tone: "bad" | "warning";
  title: string;
  messages: string[];
}): React.ReactElement {
  const color = tone === "bad" ? "var(--bad)" : "var(--warn)";
  return (
    <div className="mt-3 rounded-md border p-3" style={{ borderColor: `${color}66` }}>
      <p className="label-eyebrow" style={{ color }}>
        {title}
      </p>
      <ul className="mt-2 space-y-1 text-[12.5px] text-[var(--fg-dim)]">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}

function ProposalMeta({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-3">
      <div className="flex items-center gap-2">
        <Split size={13} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
        <span className="label-eyebrow text-[var(--fg-mute)]">{label}</span>
      </div>
      <p
        className={cn(
          "mt-2 truncate font-mono text-[12px]",
          muted ? "text-[var(--fg-mute)]" : "text-[var(--fg)]",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function ProposalStatusBadge({
  status,
}: {
  status: ProposalSummary["status"];
}): React.ReactElement {
  const tone =
    status === "pending"
      ? "warning"
      : status === "applied"
        ? "ready"
        : status === "rejected"
          ? "bad"
          : "muted";
  return <Badge tone={tone}>{status}</Badge>;
}

function ErrorBlock({ label, message }: { label: string; message: string }): React.ReactElement {
  return (
    <div className="mb-4 rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
      <p className="font-mono text-[12px] text-[var(--bad)]">{label}</p>
      <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{message}</p>
    </div>
  );
}

function ProposalListSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 10 }).map((_, index) => (
        <div
          key={index}
          className="rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-3 py-3"
        >
          <Skeleton className={cn("h-4", index % 2 === 0 ? "w-4/5" : "w-2/3")} />
          <Skeleton className="mt-3 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function ProposalDetailSkeleton(): React.ReactElement {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-md" />
        ))}
      </div>
      <Skeleton className="mt-5 h-[420px] rounded-xl" />
    </div>
  );
}

function summarizeProposals(proposals: ProposalSummary[]): {
  wiki: number;
  skill: number;
  schema: number;
} {
  return {
    wiki: proposals.filter((proposal) => proposal.kind === "wiki").length,
    skill: proposals.filter((proposal) => proposal.kind === "skill").length,
    schema: proposals.filter((proposal) => proposal.kind === "schema").length,
  };
}

function stripProposalFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return content;
  }
  const after = content.indexOf("\n", end + 4);
  return after === -1 ? "" : content.slice(after + 1).trimStart();
}

function actionProposalVerb(action: ProposalAction): string {
  if (action === "reject") {
    return "Reject";
  }
  if (action === "defer") {
    return "Defer";
  }
  return "Accept";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
