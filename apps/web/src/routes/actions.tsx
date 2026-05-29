import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  CirclePlus,
  FileText,
  Inbox,
  ListTodo,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  candidateDefaultActionText,
  candidateDefaultOwner,
  candidateReviewStats,
  type EditableActionOwner,
  sortReviewCandidates,
} from "@/lib/actionReview";
import {
  acceptDailyTodoCandidate,
  addWikiAction,
  type DailyTodoCandidate,
  type DailyTodoRunSummary,
  listDailyTodoCandidates,
  listDailyTodoRuns,
  listWikiActions,
  rejectDailyTodoCandidate,
  updateWikiAction,
  type WikiActionItem,
  type WikiActionOwnerFilter,
  type WikiActionStatusFilter,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type EditableOwner = EditableActionOwner;
type ActionScope = "today" | "open" | "all";

const ACTION_PAGE_SIZE = 40;

export function ActionsPage(): React.ReactElement {
  const [scope, setScope] = useState<ActionScope>("today");
  const [owner, setOwner] = useState<WikiActionOwnerFilter>("all");
  const [status, setStatus] = useState<WikiActionStatusFilter>("open");
  const [query, setQuery] = useState("");
  const [allActions, setAllActions] = useState<WikiActionItem[]>([]);
  const [reviewCandidates, setReviewCandidates] = useState<DailyTodoCandidate[]>([]);
  const [recentRuns, setRecentRuns] = useState<DailyTodoRunSummary[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(ACTION_PAGE_SIZE);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [candidateSavingIds, setCandidateSavingIds] = useState<Set<string>>(new Set());
  const [addOwner, setAddOwner] = useState<EditableOwner>("mine");
  const [addTitle, setAddTitle] = useState("");
  const [addContext, setAddContext] = useState("");
  const [isPending, startTransition] = useTransition();

  const todayKey = useMemo(() => localDateKey(new Date()), []);

  const loadActions = useCallback(async () => {
    return listWikiActions({ owner: "all", status: "all", query: "" });
  }, []);

  const loadReview = useCallback(async () => {
    const [candidates, runs] = await Promise.all([
      listDailyTodoCandidates({
        day: todayKey,
        status: "all",
        publication: "pending",
        source: "all",
        limit: 100,
      }),
      listDailyTodoRuns({ day: todayKey, limit: 5 }),
    ]);
    return { candidates, runs };
  }, [todayKey]);

  const refresh = useCallback(() => {
    setError(null);
    Promise.all([loadActions(), loadReview()]).then(
      ([nextActions, review]) => {
        setAllActions(nextActions);
        setReviewCandidates(review.candidates);
        setRecentRuns(review.runs);
        setLoaded(true);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoaded(true);
      },
    );
  }, [loadActions, loadReview]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    setVisibleLimit(ACTION_PAGE_SIZE);
  }, [owner, query, scope, status]);

  const stats = useMemo(() => actionStats(allActions, todayKey), [allActions, todayKey]);
  const reviewStats = useMemo(() => candidateReviewStats(reviewCandidates), [reviewCandidates]);
  const filteredActions = useMemo(
    () =>
      filterActions(allActions, {
        owner,
        query,
        scope,
        status,
        todayKey,
      }),
    [allActions, owner, query, scope, status, todayKey],
  );
  const visibleActions = filteredActions.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, filteredActions.length - visibleActions.length);
  const addDisabled = addTitle.trim().length === 0 || isPending;

  const setScopedView = (nextScope: ActionScope) => {
    setScope(nextScope);
    if (nextScope === "all") {
      setStatus("all");
    } else {
      setStatus("open");
    }
  };

  const handleRefresh = () => {
    startTransition(async () => {
      setError(null);
      try {
        const nextActions = await loadActions();
        const review = await loadReview();
        setAllActions(nextActions);
        setReviewCandidates(review.candidates);
        setRecentRuns(review.runs);
        setLoaded(true);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  const mutateAction = useCallback(
    async (id: string, input: { completed?: boolean; context?: string }) => {
      setSavingIds((current) => new Set(current).add(id));
      setError(null);
      try {
        await updateWikiAction({ id, ...input });
        setAllActions(await loadActions());
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSavingIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    },
    [loadActions],
  );

  const refreshAfterReviewMutation = useCallback(async () => {
    const [nextActions, review] = await Promise.all([loadActions(), loadReview()]);
    setAllActions(nextActions);
    setReviewCandidates(review.candidates);
    setRecentRuns(review.runs);
    setLoaded(true);
  }, [loadActions, loadReview]);

  const acceptCandidate = useCallback(
    async (
      candidate: DailyTodoCandidate,
      input: { owner: EditableOwner; actionText: string; context?: string },
    ) => {
      setCandidateSavingIds((current) => new Set(current).add(candidate.id));
      setError(null);
      try {
        await acceptDailyTodoCandidate({
          id: candidate.id,
          owner: input.owner,
          actionText: input.actionText,
          ...(input.context === undefined || input.context.trim().length === 0
            ? {}
            : { context: input.context.trim() }),
        });
        await refreshAfterReviewMutation();
        setScopedView("today");
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setCandidateSavingIds((current) => {
          const next = new Set(current);
          next.delete(candidate.id);
          return next;
        });
      }
    },
    [refreshAfterReviewMutation],
  );

  const rejectCandidate = useCallback(
    async (candidate: DailyTodoCandidate) => {
      setCandidateSavingIds((current) => new Set(current).add(candidate.id));
      setError(null);
      try {
        await rejectDailyTodoCandidate(candidate.id);
        await refreshAfterReviewMutation();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setCandidateSavingIds((current) => {
          const next = new Set(current);
          next.delete(candidate.id);
          return next;
        });
      }
    },
    [refreshAfterReviewMutation],
  );

  const handleAdd = () => {
    const title = addTitle.trim();
    if (title.length === 0) {
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        await addWikiAction({
          owner: addOwner,
          title,
          ...(addContext.trim().length === 0 ? {} : { context: addContext.trim() }),
        });
        setAddTitle("");
        setAddContext("");
        setAllActions(await loadActions());
        setLoaded(true);
        setScopedView("today");
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    });
  };

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<ListTodo size={15} strokeWidth={1.75} />}
        title="Action Items"
        description="Today-first action review backed by the wiki ledgers."
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

      <ActionStats stats={stats} reviewStats={reviewStats} />

      <ActionScopeTabs value={scope} stats={stats} onChange={setScopedView} />

      <section className="grid gap-3 border-y border-[var(--hairline)] py-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(160px,190px)_minmax(0,1fr)_auto]">
          <OwnerSelect value={addOwner} onChange={setAddOwner} />
          <Input
            value={addTitle}
            onChange={(event) => setAddTitle(event.target.value)}
            placeholder="Add an action item..."
            className="h-9 border-[var(--hairline)] bg-[var(--surface)] text-[13px]"
          />
          <Button type="button" size="sm" onClick={handleAdd} disabled={addDisabled}>
            <CirclePlus size={13} strokeWidth={2} />
            Add
          </Button>
        </div>
        <Textarea
          value={addContext}
          onChange={(event) => setAddContext(event.target.value)}
          placeholder="Context..."
          className="min-h-16 resize-y border-[var(--hairline)] bg-[var(--surface)] text-[13px]"
        />
      </section>

      <section className="grid gap-3 border-b border-[var(--hairline)] pb-4">
        <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_160px_160px]">
          <div className="relative">
            <Search
              aria-hidden="true"
              size={13}
              strokeWidth={2}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--fg-mute)]"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actions..."
              className="h-9 border-[var(--hairline)] bg-[var(--surface)] pl-8 text-[13px]"
            />
          </div>
          <OwnerFilterSelect value={owner} onChange={setOwner} />
          <StatusFilterSelect value={status} onChange={setStatus} />
        </div>
      </section>

      {error ? (
        <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-3">
          <p className="font-mono text-[12px] text-[var(--bad)]">actions error</p>
          <p className="mt-1 text-[13px] text-[var(--fg-dim)]">{error}</p>
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[var(--fg-mute)]">
              {scope === "today" ? (
                <CalendarDays size={14} strokeWidth={1.75} />
              ) : (
                <Inbox size={14} strokeWidth={1.75} />
              )}
            </span>
            <h2 className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
              {scopeTitle(scope)}
            </h2>
            <Badge tone="muted">{filteredActions.length}</Badge>
          </div>
          {scope === "today" ? (
            <span className="font-mono text-[11.5px] text-[var(--fg-mute)]">
              {formatDateKey(todayKey)}
            </span>
          ) : null}
        </div>

        <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
          {!loaded ? (
            <ActionSkeleton />
          ) : filteredActions.length === 0 ? (
            <ActionEmptyState
              scope={scope}
              todayKey={todayKey}
              onOpenAll={() => setScopedView("open")}
            />
          ) : (
            visibleActions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                todayKey={todayKey}
                saving={savingIds.has(action.id)}
                onUpdate={(input) => mutateAction(action.id, input)}
              />
            ))
          )}
        </div>

        {hiddenCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setVisibleLimit((current) => current + ACTION_PAGE_SIZE)}
            className="w-full justify-center"
          >
            <ChevronDown size={13} strokeWidth={2} />
            Show {Math.min(ACTION_PAGE_SIZE, hiddenCount)} More
          </Button>
        ) : null}
      </section>

      <DailyTodoReviewQueue
        candidates={reviewCandidates}
        loaded={loaded}
        runs={recentRuns}
        todayKey={todayKey}
        savingIds={candidateSavingIds}
        onAccept={acceptCandidate}
        onReject={rejectCandidate}
      />
    </PageContainer>
  );
}

function ActionStats({
  stats,
  reviewStats,
}: {
  stats: ReturnType<typeof actionStats>;
  reviewStats: ReturnType<typeof candidateReviewStats>;
}): React.ReactElement {
  return (
    <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-[var(--hairline)] bg-[var(--hairline)] md:grid-cols-4">
      <StatCell label="Today" value={stats.todayOpen} />
      <StatCell label="Review" value={reviewStats.pending} />
      <StatCell label="Open" value={stats.open} />
      <StatCell label="Done" value={stats.done} />
    </section>
  );
}

function StatCell({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="min-w-0 bg-[var(--surface)] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--fg-mute)]">{label}</div>
      <div className="mt-1 font-mono text-[20px] leading-none text-[var(--fg)]">{value}</div>
    </div>
  );
}

function ActionScopeTabs({
  value,
  stats,
  onChange,
}: {
  value: ActionScope;
  stats: ReturnType<typeof actionStats>;
  onChange(value: ActionScope): void;
}): React.ReactElement {
  const options: { value: ActionScope; label: string; count: number }[] = [
    { value: "today", label: "Today", count: stats.todayOpen },
    { value: "open", label: "Open", count: stats.open },
    { value: "all", label: "All", count: stats.total },
  ];
  return (
    <section className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? "default" : "secondary"}
          onClick={() => onChange(option.value)}
          className="h-8 gap-2 px-3 text-[12px]"
        >
          {option.label}
          <Badge tone={value === option.value ? "ready" : "muted"}>{option.count}</Badge>
        </Button>
      ))}
    </section>
  );
}

function ActionRow({
  action,
  todayKey,
  saving,
  onUpdate,
}: {
  action: WikiActionItem;
  todayKey: string;
  saving: boolean;
  onUpdate(input: { completed?: boolean; context?: string }): void;
}): React.ReactElement {
  const [context, setContext] = useState(action.context);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setContext(action.context);
    setEditing(false);
  }, [action.context]);

  const contextChanged = context.trim() !== action.context;
  const ownerIcon =
    action.owner === "mine" ? (
      <User size={12} strokeWidth={2} />
    ) : (
      <Users size={12} strokeWidth={2} />
    );
  const actionDate = actionDateLabel(action, todayKey);

  return (
    <article className="grid gap-3 py-3 [content-visibility:auto] [contain-intrinsic-size:104px] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            aria-label={action.completed ? "Mark open" : "Mark done"}
            disabled={saving}
            onClick={() => onUpdate({ completed: !action.completed })}
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              action.completed
                ? "border-[var(--good)]/40 bg-[var(--good)]/[0.08] text-[var(--good)]"
                : "border-[var(--hairline)] bg-[var(--surface)] text-[var(--fg-mute)] hover:text-[var(--fg)]",
            )}
          >
            {action.completed ? (
              <CheckCircle2 size={15} strokeWidth={2} />
            ) : (
              <Circle size={15} strokeWidth={2} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p
              title={action.title}
              className={cn(
                "text-wrap break-words text-[13.5px] leading-6 text-[var(--fg)]",
                !expanded && "line-clamp-2",
                action.completed &&
                  "text-[var(--fg-mute)] line-through decoration-[var(--fg-mute)]/50",
              )}
            >
              {action.title}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--fg-mute)]">
              <Badge
                tone="muted"
                className="h-5 gap-1 rounded border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 text-[11px]"
              >
                {ownerIcon}
                {action.ownerLabel}
              </Badge>
              {actionDate ? (
                <Badge
                  tone={actionDate === "Today" ? "ready" : "muted"}
                  className="h-5 gap-1 rounded border border-[var(--hairline)] px-1.5 text-[11px]"
                >
                  <CalendarDays size={11} strokeWidth={2} />
                  {actionDate}
                </Badge>
              ) : null}
              {action.source ? (
                <Badge
                  tone="muted"
                  className="h-5 max-w-full gap-1 rounded border-[var(--hairline)] px-1.5 text-[11px]"
                >
                  <FileText size={11} strokeWidth={2} />
                  <span className="truncate">{action.source.label}</span>
                </Badge>
              ) : null}
              <span className="font-mono">
                {action.path}:{action.line}
              </span>
            </div>
            {!editing && action.context.length > 0 ? (
              <p className="mt-2 line-clamp-2 break-words text-[12px] leading-5 text-[var(--fg-dim)]">
                {action.context}
              </p>
            ) : null}
          </div>
        </div>

        {editing ? (
          <form
            className="ml-10 mt-3 grid min-w-0 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (contextChanged) {
                onUpdate({ context: context.trim() });
              } else {
                setEditing(false);
              }
            }}
          >
            <Textarea
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Context..."
              disabled={saving}
              className="min-h-[72px] resize-y border-[var(--hairline)] bg-[var(--surface)] text-[12.5px]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-[11.5px] text-[var(--fg-mute)]">
                {action.contextUpdatedAt
                  ? formatDateTime(action.contextUpdatedAt)
                  : "No context saved"}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    setContext(action.context);
                    setEditing(false);
                  }}
                  className="h-7 px-2 text-[12px]"
                >
                  <X size={12} strokeWidth={2} />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={saving || !contextChanged}
                  className="h-7 px-2 text-[12px]"
                >
                  <Save size={12} strokeWidth={2} />
                  Save
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </div>

      <div className="ml-10 flex flex-wrap gap-2 lg:ml-0 lg:justify-end">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setExpanded((current) => !current)}
          className="h-7 px-2 text-[12px]"
        >
          <ChevronDown
            size={12}
            strokeWidth={2}
            className={cn("transition-transform", expanded && "rotate-180")}
          />
          {expanded ? "Less" : "More"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setEditing(true)}
          disabled={saving}
          className="h-7 px-2 text-[12px]"
        >
          <Pencil size={12} strokeWidth={2} />
          Context
        </Button>
      </div>
    </article>
  );
}

function DailyTodoReviewQueue({
  candidates,
  loaded,
  runs,
  todayKey,
  savingIds,
  onAccept,
  onReject,
}: {
  candidates: DailyTodoCandidate[];
  loaded: boolean;
  runs: DailyTodoRunSummary[];
  todayKey: string;
  savingIds: Set<string>;
  onAccept(
    candidate: DailyTodoCandidate,
    input: { owner: EditableOwner; actionText: string; context?: string },
  ): void;
  onReject(candidate: DailyTodoCandidate): void;
}): React.ReactElement {
  const sortedCandidates = useMemo(() => sortReviewCandidates(candidates), [candidates]);
  const latestRun = runs[0];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[var(--fg-mute)]">
            <Sparkles size={14} strokeWidth={1.75} />
          </span>
          <h2 className="text-[13px] font-medium tracking-tight text-[var(--fg)]">
            Extraction Review
          </h2>
          <Badge tone={sortedCandidates.length > 0 ? "warning" : "muted"}>
            {sortedCandidates.length}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--fg-mute)]">
          <span className="font-mono">{formatDateKey(todayKey)}</span>
          {latestRun ? <span className="font-mono">{latestRunLabel(latestRun)}</span> : null}
        </div>
      </div>

      <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
        {!loaded ? (
          <ActionSkeleton />
        ) : sortedCandidates.length === 0 ? (
          <div className="grid justify-items-center gap-3 py-9 text-center">
            <CheckCircle2 size={17} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
            <p className="max-w-md text-[13px] leading-5 text-[var(--fg-dim)]">
              No unpublished extracted action candidates for today.
            </p>
          </div>
        ) : (
          sortedCandidates.map((candidate) => (
            <CandidateReviewRow
              key={candidate.id}
              candidate={candidate}
              saving={savingIds.has(candidate.id)}
              onAccept={(input) => onAccept(candidate, input)}
              onReject={() => onReject(candidate)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function CandidateReviewRow({
  candidate,
  saving,
  onAccept,
  onReject,
}: {
  candidate: DailyTodoCandidate;
  saving: boolean;
  onAccept(input: { owner: EditableOwner; actionText: string; context?: string }): void;
  onReject(): void;
}): React.ReactElement {
  const [owner, setOwner] = useState<EditableOwner>(candidateDefaultOwner(candidate));
  const [actionText, setActionText] = useState(candidateDefaultActionText(candidate));
  const [context, setContext] = useState("");
  const canAccept = actionText.trim().length > 0 && !saving;

  useEffect(() => {
    setOwner(candidateDefaultOwner(candidate));
    setActionText(candidateDefaultActionText(candidate));
    setContext("");
  }, [candidate]);

  return (
    <article className="grid gap-3 py-4 [content-visibility:auto] [contain-intrinsic-size:180px] xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--fg-mute)]">
          <Badge
            tone={candidate.status === "confirmed" ? "ready" : "warning"}
            className="h-5 rounded border border-[var(--hairline)] px-1.5 text-[11px]"
          >
            {candidateStatusLabel(candidate)}
          </Badge>
          <Badge
            tone={candidate.owner === "unknown" ? "warning" : "muted"}
            className="h-5 gap-1 rounded border border-[var(--hairline)] bg-[var(--surface-2)] px-1.5 text-[11px]"
          >
            {candidate.owner === "theirs" ? (
              <Users size={11} strokeWidth={2} />
            ) : (
              <User size={11} strokeWidth={2} />
            )}
            {candidateOwnerLabel(candidate)}
          </Badge>
          <Badge
            tone={candidate.confidence >= 0.8 ? "ready" : "warning"}
            className="h-5 rounded border border-[var(--hairline)] px-1.5 text-[11px]"
          >
            {confidenceLabel(candidate.confidence)}
          </Badge>
          <Badge
            tone="muted"
            className="h-5 max-w-full gap-1 rounded border border-[var(--hairline)] px-1.5 text-[11px]"
          >
            <FileText size={11} strokeWidth={2} />
            <span className="truncate">{candidate.sourceLabel}</span>
          </Badge>
          <span className="font-mono">
            {candidate.sourcePath}:{candidate.lineStart}
          </span>
        </div>

        <div className="grid gap-2">
          <p className="break-words text-[13.5px] leading-6 text-[var(--fg)]">
            {candidate.actionText}
          </p>
          <blockquote className="border-l-2 border-[var(--hairline-strong)] pl-3 text-[12.5px] leading-5 text-[var(--fg-dim)]">
            <span className="line-clamp-4 break-words">{candidate.evidenceText}</span>
          </blockquote>
          <p className="flex items-start gap-2 text-[12px] leading-5 text-[var(--fg-mute)]">
            <AlertCircle size={12} strokeWidth={2} className="mt-1 shrink-0" />
            <span className="break-words">{candidate.rationale}</span>
          </p>
        </div>
      </div>

      <form
        className="grid min-w-0 gap-2 rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canAccept) {
            onAccept({
              owner,
              actionText: actionText.trim(),
              ...(context.trim().length === 0 ? {} : { context: context.trim() }),
            });
          }
        }}
      >
        <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
          <OwnerSelect value={owner} onChange={setOwner} />
          <Input
            value={actionText}
            onChange={(event) => setActionText(event.target.value)}
            disabled={saving}
            className="h-9 border-[var(--hairline)] bg-[var(--bg-elev)] text-[13px]"
          />
        </div>
        <Textarea
          value={context}
          onChange={(event) => setContext(event.target.value)}
          placeholder="Optional context..."
          disabled={saving}
          className="min-h-[70px] resize-y border-[var(--hairline)] bg-[var(--bg-elev)] text-[12.5px]"
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={onReject}
            className="h-7 px-2 text-[12px]"
          >
            <Trash2 size={12} strokeWidth={2} />
            Reject
          </Button>
          <Button type="submit" size="sm" disabled={!canAccept} className="h-7 px-2 text-[12px]">
            <CheckCircle2 size={12} strokeWidth={2} />
            Accept
          </Button>
        </div>
      </form>
    </article>
  );
}

function ActionEmptyState({
  scope,
  todayKey,
  onOpenAll,
}: {
  scope: ActionScope;
  todayKey: string;
  onOpenAll(): void;
}): React.ReactElement {
  return (
    <div className="grid justify-items-center gap-3 py-10 text-center">
      <Inbox size={18} strokeWidth={1.75} className="text-[var(--fg-mute)]" />
      <p className="max-w-md text-[13px] leading-5 text-[var(--fg-dim)]">
        {scope === "today"
          ? `No open action items surfaced for ${formatDateKey(todayKey)}.`
          : "No action items found."}
      </p>
      {scope === "today" ? (
        <Button type="button" size="sm" variant="secondary" onClick={onOpenAll}>
          Open Backlog
        </Button>
      ) : null}
    </div>
  );
}

function OwnerSelect({
  value,
  onChange,
}: {
  value: EditableOwner;
  onChange(value: EditableOwner): void;
}): React.ReactElement {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as EditableOwner)}>
      <SelectTrigger className="h-9 border-[var(--hairline)] bg-[var(--surface)] text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="mine">Mine</SelectItem>
        <SelectItem value="theirs">Others</SelectItem>
      </SelectContent>
    </Select>
  );
}

function OwnerFilterSelect({
  value,
  onChange,
}: {
  value: WikiActionOwnerFilter;
  onChange(value: WikiActionOwnerFilter): void;
}): React.ReactElement {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as WikiActionOwnerFilter)}>
      <SelectTrigger className="h-9 border-[var(--hairline)] bg-[var(--surface)] text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Everyone</SelectItem>
        <SelectItem value="mine">Mine</SelectItem>
        <SelectItem value="theirs">Others</SelectItem>
      </SelectContent>
    </Select>
  );
}

function StatusFilterSelect({
  value,
  onChange,
}: {
  value: WikiActionStatusFilter;
  onChange(value: WikiActionStatusFilter): void;
}): React.ReactElement {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as WikiActionStatusFilter)}>
      <SelectTrigger className="h-9 border-[var(--hairline)] bg-[var(--surface)] text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="done">Done</SelectItem>
        <SelectItem value="all">All</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ActionSkeleton(): React.ReactElement {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_120px]">
          <div className="flex gap-3">
            <div className="size-7 rounded-md bg-[var(--surface-2)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[var(--surface-2)]" />
              <div className="h-3 w-1/2 rounded bg-[var(--surface-2)]" />
            </div>
          </div>
          <div className="h-7 rounded-md bg-[var(--surface-2)]" />
        </div>
      ))}
    </>
  );
}

function actionStats(
  actions: WikiActionItem[],
  todayKey: string,
): {
  todayOpen: number;
  open: number;
  done: number;
  mineOpen: number;
  theirsOpen: number;
  total: number;
} {
  let todayOpen = 0;
  let open = 0;
  let done = 0;
  let mineOpen = 0;
  let theirsOpen = 0;
  for (const action of actions) {
    if (action.completed) {
      done += 1;
      continue;
    }
    open += 1;
    if (actionDateKey(action) === todayKey) {
      todayOpen += 1;
    }
    if (action.owner === "mine") {
      mineOpen += 1;
    } else {
      theirsOpen += 1;
    }
  }
  return { todayOpen, open, done, mineOpen, theirsOpen, total: actions.length };
}

function candidateStatusLabel(candidate: DailyTodoCandidate): string {
  if (candidate.status === "confirmed") {
    return "Ready";
  }
  if (candidate.status === "needs_review") {
    return "Review";
  }
  return "Rejected";
}

function candidateOwnerLabel(candidate: DailyTodoCandidate): string {
  if (candidate.owner === "mine") {
    return "Mine";
  }
  if (candidate.owner === "theirs") {
    return "Others";
  }
  return "Owner needed";
}

function confidenceLabel(value: number): string {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `${percent}%`;
}

function latestRunLabel(run: DailyTodoRunSummary): string {
  const timestamp = run.endedAt ?? run.startedAt;
  return `${run.candidateCount} candidates · ${formatDateTime(timestamp)}`;
}

function filterActions(
  actions: WikiActionItem[],
  options: {
    scope: ActionScope;
    owner: WikiActionOwnerFilter;
    status: WikiActionStatusFilter;
    query: string;
    todayKey: string;
  },
): WikiActionItem[] {
  const query = normalizeQuery(options.query);
  return actions.filter((action) => {
    if (options.scope === "today" && actionDateKey(action) !== options.todayKey) {
      return false;
    }
    if (options.owner !== "all" && action.owner !== options.owner) {
      return false;
    }
    if (options.status === "open" && action.completed) {
      return false;
    }
    if (options.status === "done" && !action.completed) {
      return false;
    }
    if (query.length === 0) {
      return true;
    }
    return actionSearchText(action).includes(query);
  });
}

function actionSearchText(action: WikiActionItem): string {
  return [
    action.title,
    action.body,
    action.context,
    action.ownerLabel,
    action.source?.label ?? "",
    action.source?.target ?? "",
    action.sourceDate ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function scopeTitle(scope: ActionScope): string {
  if (scope === "today") {
    return "Today";
  }
  if (scope === "open") {
    return "Open Backlog";
  }
  return "All Actions";
}

function actionDateLabel(action: WikiActionItem, todayKey: string): string | null {
  const key = actionDateKey(action);
  if (key === null) {
    return null;
  }
  if (key === todayKey) {
    return "Today";
  }
  return formatDateKey(key);
}

function actionDateKey(action: WikiActionItem): string | null {
  if (action.sourceDate !== undefined) {
    return action.sourceDate;
  }
  if (action.createdAt !== undefined) {
    return dateKeyFromIso(action.createdAt);
  }
  if (action.contextUpdatedAt !== undefined) {
    return dateKeyFromIso(action.contextUpdatedAt);
  }
  return null;
}

function dateKeyFromIso(value: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return localDateKey(parsed);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateKey(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return value;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(year, month - 1, day));
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
