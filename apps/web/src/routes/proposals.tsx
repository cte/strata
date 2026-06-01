import { Check, Clock, FileText, RefreshCw, Split, X } from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProposalDetail, ProposalStatusFilter, ProposalSummary } from "@/lib/api";
import {
  useAcceptProposal,
  useDeferProposal,
  useProposal,
  useProposals,
  useRejectProposal,
} from "@/lib/queries/proposals";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { label: string; value: ProposalStatusFilter }[] = [
  { label: "Pending", value: "pending" },
  { label: "Deferred", value: "deferred" },
  { label: "Applied", value: "applied" },
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

type ProposalAction = "accept" | "reject" | "defer";

/**
 * The staged-change review body (wiki / memory / skill / schema proposals).
 * Rendered as a section inside the unified `/review` inbox alongside the
 * classification review queue — it owns its own toolbar but not the page chrome.
 */
export function ProposalsReview(): React.ReactElement {
  const [status, setStatus] = useState<ProposalStatusFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const proposalsQuery = useProposals(status);
  const detailQuery = useProposal(selectedId);
  const acceptMutation = useAcceptProposal();
  const rejectMutation = useRejectProposal();
  const deferMutation = useDeferProposal();

  const proposals = useMemo(() => proposalsQuery.data ?? [], [proposalsQuery.data]);
  const detail = detailQuery.data ?? null;
  const loaded = !proposalsQuery.isPending;
  const listError = proposalsQuery.error ? messageOf(proposalsQuery.error) : null;
  const detailError = detailQuery.error ? messageOf(detailQuery.error) : null;
  const actionBusy: ProposalAction | null = acceptMutation.isPending
    ? "accept"
    : rejectMutation.isPending
      ? "reject"
      : deferMutation.isPending
        ? "defer"
        : null;

  // Keep the selection valid as the filtered list changes; clear stale action
  // feedback when the user moves to a different proposal.
  useEffect(() => {
    setSelectedId((current) => {
      if (current !== null && proposals.some((proposal) => proposal.id === current)) {
        return current;
      }
      return proposals[0]?.id ?? null;
    });
  }, [proposals]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset feedback when the selected proposal changes
  useEffect(() => {
    setActionError(null);
    setActionMessage(null);
  }, [selectedId]);

  const totals = useMemo(() => summarizeProposals(proposals), [proposals]);

  const handleRefresh = () => {
    void proposalsQuery.refetch();
  };

  const runAction = useCallback(
    async (action: ProposalAction) => {
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

      setActionError(null);
      setActionMessage(null);
      try {
        if (action === "accept") {
          const fingerprint = detail?.apply.previewFingerprint;
          const result = await acceptMutation.mutateAsync({
            id: selectedId,
            ...(fingerprint === undefined ? {} : { previewFingerprint: fingerprint }),
          });
          setActionMessage(result.message);
        } else if (action === "reject") {
          const result = await rejectMutation.mutateAsync({
            id: selectedId,
            ...(reason === undefined ? {} : { reason }),
          });
          setActionMessage(`Rejected ${result.proposal.path}.`);
        } else {
          const result = await deferMutation.mutateAsync({
            id: selectedId,
            ...(reason === undefined ? {} : { reason }),
          });
          setActionMessage(`Deferred ${result.proposal.path}.`);
        }
      } catch (cause: unknown) {
        setActionError(messageOf(cause));
      }
    },
    [acceptMutation, rejectMutation, deferMutation, selectedId, detail],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium tracking-tight text-fg">Proposals</h2>
          <p className="mt-1 text-xs text-fg-mute">
            Staged wiki, memory, skill, and taxonomy changes — approve before they touch durable
            state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProposalStatusFilter value={status} onChange={setStatus} />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleRefresh}
            disabled={proposalsQuery.isFetching}
          >
            <RefreshCw
              size={13}
              strokeWidth={2}
              className={cn(proposalsQuery.isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid h-[70vh] min-h-[28rem] grid-cols-1 overflow-hidden rounded-xl border border-hairline bg-surface lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-hairline bg-bg lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-3">
              <ProposalListHeader count={proposals.length} totals={totals} />
              {listError ? (
                <ErrorBlock label="proposal list error" message={listError} />
              ) : !loaded ? (
                <ProposalListSkeleton />
              ) : proposals.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-fg-dim">No proposals found.</p>
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

        <section className="min-h-0 min-w-0 bg-bg">
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
    </section>
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
    <div className="flex flex-wrap rounded-md border border-hairline p-0.5">
      {STATUS_FILTERS.map((filter) => (
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
        <p className="label-eyebrow text-fg-mute">staged changes</p>
        <p className="mt-1 text-sm text-fg-dim">{count.toLocaleString()} visible proposals</p>
      </div>
      <div className="flex items-center gap-3 font-mono text-2xs text-fg-mute">
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
              "flex w-full min-w-0 flex-col gap-2 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selectedId === proposal.id && "border-hairline bg-surface shadow-sm",
            )}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <span className="line-clamp-2 min-w-0 text-sm font-medium text-fg">
                {proposal.title}
              </span>
              <ProposalStatusBadge status={proposal.status} />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-mute">
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
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={detail.proposal.status} />
            <span className="label-eyebrow text-fg-mute">{detail.proposal.kind}</span>
          </div>
          <h2 className="mt-2 text-xl font-medium tracking-tight text-fg">
            {detail.proposal.title}
          </h2>
          <p className="mt-1 break-all font-mono text-xs text-fg-mute">{detail.proposal.path}</p>
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
        <div className="mb-4 rounded-md border border-good/30 bg-good/[0.06] p-3 text-sm text-fg-dim">
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
        <MessageContent className="max-w-none rounded-xl border border-hairline bg-surface px-5 py-5 shadow-sm md:px-7 md:py-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileText size={14} strokeWidth={1.75} className="shrink-0 text-fg-mute" />
              <span className="truncate text-sm text-fg-dim">{detail.apply.message}</span>
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
    <section className="mb-5 rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={tone}>{operationPlan.valid ? "valid plan" : "invalid plan"}</Badge>
            <Badge tone="muted">{operationPlan.readiness}</Badge>
            <span className="label-eyebrow text-fg-mute">{operationPlan.source}</span>
          </div>
          <p className="mt-2 text-sm text-fg-dim">{operationPlan.summary}</p>
        </div>
        <div className="text-right font-mono text-xs text-fg-mute">
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
    <div className="mt-4 border-t border-hairline pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="label-eyebrow text-fg-mute">mechanical diff previews</p>
        <span className="font-mono text-2xs text-fg-mute">
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
    <div className="rounded-md border border-hairline bg-bg p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={diffStatusTone(diff.status)}>{diff.status}</Badge>
        <span className="label-eyebrow text-fg-mute">{diff.operation}</span>
        <span className="min-w-0 truncate font-mono text-xs text-fg-dim">{diff.targetPath}</span>
      </div>
      <p className="mt-2 text-sm text-fg-dim">{diff.summary}</p>
      {diff.diff ? (
        <pre className="mt-3 max-h-72 overflow-auto rounded-sm border border-hairline bg-surface p-3 text-2xs leading-5 text-fg">
          {diff.diff}
        </pre>
      ) : null}
      {diff.truncated ? <p className="mt-2 font-mono text-2xs text-warn">diff truncated</p> : null}
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
      <ul className="mt-2 space-y-1 text-sm text-fg-dim">
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
    <div className="rounded-md border border-hairline bg-surface px-3 py-3">
      <div className="flex items-center gap-2">
        <Split size={13} strokeWidth={1.75} className="text-fg-mute" />
        <span className="label-eyebrow text-fg-mute">{label}</span>
      </div>
      <p
        className={cn("mt-2 truncate font-mono text-xs", muted ? "text-fg-mute" : "text-fg")}
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
    <div className="mb-4 rounded-md border border-bad/40 bg-bad/[0.06] p-3">
      <p className="font-mono text-xs text-bad">{label}</p>
      <p className="mt-1 text-sm text-fg-dim">{message}</p>
    </div>
  );
}

function ProposalListSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 10 }).map((_, index) => (
        <div key={index} className="rounded-md border border-hairline bg-surface px-3 py-3">
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

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
