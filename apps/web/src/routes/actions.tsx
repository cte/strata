import {
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
  Trash2,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { Callout } from "@/components/shared/callout";
import { Chip } from "@/components/shared/chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { WikiActionItem, WikiActionStatusFilter } from "@/lib/api";
import {
  useAddWikiAction,
  useDeleteWikiAction,
  useUpdateWikiAction,
  useWikiActions,
} from "@/lib/queries/wikiActions";
import { cleanSourceText, shortSourceLabel } from "@/lib/sourceText";
import { cn } from "@/lib/utils";

type ActionScope = "today" | "open" | "all";

const ACTION_PAGE_SIZE = 40;

export function ActionsPage(): React.ReactElement {
  const [scope, setScope] = useState<ActionScope>("today");
  const [status, setStatus] = useState<WikiActionStatusFilter>("open");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(ACTION_PAGE_SIZE);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [addTitle, setAddTitle] = useState("");
  const [addContext, setAddContext] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const todayKey = useMemo(() => localDateKey(new Date()), []);

  // The page loads the full "mine" ledger once and filters client-side, so the
  // query args are fixed and scope/status/query stay local UI state.
  const actionsQuery = useWikiActions({ owner: "mine", status: "all", query: "" });
  const addMutation = useAddWikiAction();
  const updateMutation = useUpdateWikiAction();
  const deleteMutation = useDeleteWikiAction();

  const allActions = useMemo(() => actionsQuery.data ?? [], [actionsQuery.data]);
  const loaded = !actionsQuery.isPending;
  const error = actionsQuery.error ? messageOf(actionsQuery.error) : actionError;
  const isPending = actionsQuery.isFetching || addMutation.isPending;

  useEffect(() => {
    setVisibleLimit(ACTION_PAGE_SIZE);
  }, [query, scope, status]);

  const stats = useMemo(() => actionStats(allActions, todayKey), [allActions, todayKey]);
  const filteredActions = useMemo(
    () =>
      filterActions(allActions, {
        query,
        scope,
        status,
        todayKey,
      }),
    [allActions, query, scope, status, todayKey],
  );
  const visibleActions = filteredActions.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, filteredActions.length - visibleActions.length);
  const addDisabled = addTitle.trim().length === 0 || isPending;

  const selectView = (next: { scope: ActionScope; status: WikiActionStatusFilter }) => {
    setScope(next.scope);
    setStatus(next.status);
  };

  const handleAddOpenChange = (open: boolean) => {
    setAddOpen(open);
    if (!open) {
      setAddTitle("");
      setAddContext("");
    }
  };

  const handleRefresh = () => {
    void actionsQuery.refetch();
  };

  const withSavingId = useCallback(async (id: string, run: () => Promise<unknown>) => {
    setSavingIds((current) => new Set(current).add(id));
    setActionError(null);
    try {
      await run();
    } catch (cause: unknown) {
      setActionError(messageOf(cause));
    } finally {
      setSavingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, []);

  const mutateAction = useCallback(
    async (id: string, input: { completed?: boolean; context?: string }) => {
      await withSavingId(id, () => updateMutation.mutateAsync({ id, ...input }));
    },
    [withSavingId, updateMutation],
  );

  const deleteAction = useCallback(
    async (id: string) => {
      await withSavingId(id, () => deleteMutation.mutateAsync(id));
    },
    [withSavingId, deleteMutation],
  );

  const handleAdd = () => {
    const title = addTitle.trim();
    if (title.length === 0) {
      return;
    }
    setActionError(null);
    addMutation.mutate(
      {
        owner: "mine",
        title,
        ...(addContext.trim().length === 0 ? {} : { context: addContext.trim() }),
      },
      {
        onSuccess: () => {
          setAddTitle("");
          setAddContext("");
          setAddOpen(false);
          selectView({ scope: "today", status: "open" });
        },
        onError: (cause) => setActionError(messageOf(cause)),
      },
    );
  };

  return (
    <PageContainer width="wide">
      <PageHeader
        icon={<ListTodo size={15} strokeWidth={1.75} />}
        title="Action Items"
        description="Today-first action review backed by the wiki ledgers."
        actions={
          <>
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
            <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
              <CirclePlus size={13} strokeWidth={2} />
              Add action
            </Button>
          </>
        }
      />

      <ScopeNav scope={scope} status={status} stats={stats} onSelect={selectView} />

      <AddActionDialog
        open={addOpen}
        onOpenChange={handleAddOpenChange}
        title={addTitle}
        onTitleChange={setAddTitle}
        context={addContext}
        onContextChange={setAddContext}
        onSubmit={handleAdd}
        disabled={addDisabled}
        pending={isPending}
      />

      <section className="relative">
        <Search
          aria-hidden="true"
          size={13}
          strokeWidth={2}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-mute"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search actions…"
          className="h-9 border-hairline bg-surface pl-8 text-sm"
        />
      </section>

      {error ? <Callout label="actions error">{error}</Callout> : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-fg-mute">
              {scope === "today" ? (
                <CalendarDays size={14} strokeWidth={1.75} />
              ) : (
                <Inbox size={14} strokeWidth={1.75} />
              )}
            </span>
            <h2 className="text-sm font-medium tracking-tight text-fg">
              {viewTitle(scope, status)}
            </h2>
            <Badge tone="muted">{filteredActions.length}</Badge>
          </div>
          {scope === "today" ? (
            <span className="font-mono text-xs text-fg-mute">{formatDateKey(todayKey)}</span>
          ) : null}
        </div>

        <div className="divide-y divide-hairline border-y border-hairline">
          {!loaded ? (
            <ActionSkeleton />
          ) : filteredActions.length === 0 ? (
            <ActionEmptyState
              scope={scope}
              todayKey={todayKey}
              onOpenAll={() => selectView({ scope: "open", status: "open" })}
            />
          ) : (
            visibleActions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                todayKey={todayKey}
                saving={savingIds.has(action.id)}
                onUpdate={(input) => mutateAction(action.id, input)}
                onDelete={() => deleteAction(action.id)}
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
    </PageContainer>
  );
}

function ScopeNav({
  scope,
  status,
  stats,
  onSelect,
}: {
  scope: ActionScope;
  status: WikiActionStatusFilter;
  stats: ReturnType<typeof actionStats>;
  onSelect(next: { scope: ActionScope; status: WikiActionStatusFilter }): void;
}): React.ReactElement {
  const isDone = status === "done";
  const cells: {
    key: string;
    label: string;
    value: number;
    active: boolean;
    next: { scope: ActionScope; status: WikiActionStatusFilter };
  }[] = [
    {
      key: "today",
      label: "Today",
      value: stats.todayOpen,
      active: !isDone && scope === "today",
      next: { scope: "today", status: "open" },
    },
    {
      key: "open",
      label: "Open",
      value: stats.open,
      active: !isDone && scope === "open",
      next: { scope: "open", status: "open" },
    },
    {
      key: "all",
      label: "All",
      value: stats.total,
      active: !isDone && scope === "all",
      next: { scope: "all", status: "all" },
    },
    {
      key: "done",
      label: "Done",
      value: stats.done,
      active: isDone,
      next: { scope: "all", status: "done" },
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {cells.map((cell) => (
        <button
          key={cell.key}
          type="button"
          aria-pressed={cell.active}
          onClick={() => onSelect(cell.next)}
          className={cn(
            "group flex flex-col items-start gap-1 rounded-md border px-3.5 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            cell.active
              ? "border-accent/40 bg-accent-soft"
              : "border-hairline bg-surface hover:border-hairline-strong hover:bg-surface-2",
          )}
        >
          <span
            className={cn(
              "text-2xs uppercase tracking-[0.12em]",
              cell.active ? "text-accent" : "text-fg-mute",
            )}
          >
            {cell.label}
          </span>
          <span
            className={cn(
              "font-mono text-2xl leading-none",
              cell.active ? "text-fg" : "text-fg-dim",
            )}
          >
            {cell.value}
          </span>
        </button>
      ))}
    </section>
  );
}

function ActionRow({
  action,
  todayKey,
  saving,
  onUpdate,
  onDelete,
}: {
  action: WikiActionItem;
  todayKey: string;
  saving: boolean;
  onUpdate(input: { completed?: boolean; context?: string }): void;
  onDelete(): void;
}): React.ReactElement {
  const [context, setContext] = useState(action.context);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setContext(action.context);
    setEditing(false);
    setConfirmingDelete(false);
  }, [action.context]);

  const contextChanged = context.trim() !== action.context;
  const actionDate = actionDateLabel(action, todayKey);
  const sourcePath = action.source?.target ?? action.path;
  const sourceTitle = action.source
    ? `${cleanSourceText(action.source.label)} — ${action.path}:${action.line}`
    : `${action.path}:${action.line}`;
  const contextPreview = action.context.length > 0 ? cleanSourceText(action.context) : "";

  return (
    <article className="group grid gap-2 py-3 [content-visibility:auto] [contain-intrinsic-size:96px] lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-4">
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            aria-label={action.completed ? "Mark open" : "Mark done"}
            disabled={saving}
            onClick={() => onUpdate({ completed: !action.completed })}
            className={cn(
              "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              action.completed
                ? "border-good/40 bg-good/[0.1] text-good"
                : "border-hairline-strong bg-transparent text-fg-mute hover:border-good/50 hover:text-good",
            )}
          >
            {action.completed ? (
              <CheckCircle2 size={14} strokeWidth={2} />
            ) : (
              <Circle size={13} strokeWidth={2} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p
              title={action.title}
              className={cn(
                "text-wrap break-words text-base leading-6 text-fg",
                !expanded && "line-clamp-2",
                action.completed && "text-fg-mute line-through decoration-fg-mute/50",
              )}
            >
              {action.title}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {actionDate ? (
                <Chip
                  tone={actionDate === "Today" ? "accent" : "neutral"}
                  icon={<CalendarDays size={11} strokeWidth={2} />}
                >
                  {actionDate}
                </Chip>
              ) : null}
              <Chip icon={<FileText size={11} strokeWidth={2} />} title={sourceTitle}>
                {shortSourceLabel(sourcePath, action.source?.label)}
              </Chip>
            </div>
            {!editing && contextPreview.length > 0 ? (
              <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-fg-dim">
                {contextPreview}
              </p>
            ) : null}
          </div>
        </div>

        {editing ? (
          <form
            className="ml-9 mt-2.5 grid min-w-0 gap-2"
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
              placeholder="Context…"
              disabled={saving}
              className="min-h-[72px] resize-y border-hairline bg-surface text-sm"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate text-xs text-fg-mute">
                {action.contextUpdatedAt
                  ? formatDateTime(action.contextUpdatedAt)
                  : "No context saved"}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => {
                    setContext(action.context);
                    setEditing(false);
                  }}
                  className="h-7 px-2 text-xs text-fg-mute hover:text-fg"
                >
                  <X size={12} strokeWidth={2} />
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={saving || !contextChanged}
                  className="h-7 px-2 text-xs"
                >
                  <Save size={12} strokeWidth={2} />
                  Save
                </Button>
              </div>
            </div>
          </form>
        ) : null}
      </div>

      {editing ? null : confirmingDelete ? (
        <div className="ml-9 flex flex-wrap items-center gap-2 lg:ml-0 lg:justify-end">
          <span className="text-xs text-fg-dim">Delete this item?</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setConfirmingDelete(false)}
            className="h-7 px-2 text-xs text-fg-mute hover:text-fg"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={onDelete}
            className="h-7 px-2 text-xs text-bad hover:bg-bad/10 hover:text-bad"
          >
            <Trash2 size={12} strokeWidth={2} />
            Delete
          </Button>
        </div>
      ) : (
        <div className="ml-9 flex flex-wrap gap-1 lg:ml-0 lg:justify-end lg:opacity-70 lg:transition-opacity lg:duration-150 lg:group-focus-within:opacity-100 lg:group-hover:opacity-100">
          {action.title.length > 90 || action.context.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((current) => !current)}
              className="h-7 px-2 text-xs text-fg-mute hover:text-fg"
            >
              <ChevronDown
                size={12}
                strokeWidth={2}
                className={cn("transition-transform", expanded && "rotate-180")}
              />
              {expanded ? "Less" : "More"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            disabled={saving}
            className="h-7 px-2 text-xs text-fg-mute hover:text-fg"
          >
            <Pencil size={12} strokeWidth={2} />
            Context
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Delete action item"
            onClick={() => setConfirmingDelete(true)}
            disabled={saving}
            className="h-7 px-2 text-xs text-fg-mute hover:text-bad"
          >
            <Trash2 size={12} strokeWidth={2} />
          </Button>
        </div>
      )}
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
      <Inbox size={18} strokeWidth={1.75} className="text-fg-mute" />
      <p className="max-w-md text-sm leading-5 text-fg-dim">
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

function AddActionDialog({
  open,
  onOpenChange,
  title,
  onTitleChange,
  context,
  onContextChange,
  onSubmit,
  disabled,
  pending,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  onTitleChange(value: string): void;
  context: string;
  onContextChange(value: string): void;
  onSubmit(): void;
  disabled: boolean;
  pending: boolean;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-hairline bg-surface">
        <DialogHeader>
          <DialogTitle className="text-md tracking-tight text-fg">Add action item</DialogTitle>
          <DialogDescription className="text-sm text-fg-dim">
            Capture a task you need to follow up on.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled) {
              onSubmit();
            }
          }}
        >
          <div className="grid gap-1.5">
            <span className="label-eyebrow">Action</span>
            {/* biome-ignore lint/a11y/noAutofocus: focus the primary field when the modal opens */}
            <Input
              autoFocus
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="What needs to happen?"
              className="h-9 border-hairline bg-bg-elev text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="label-eyebrow">Context (optional)</span>
            <Textarea
              value={context}
              onChange={(event) => onContextChange(event.target.value)}
              placeholder="Add any background or links…"
              className="min-h-20 resize-y border-hairline bg-bg-elev text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-fg-mute hover:text-fg"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={disabled}>
              <CirclePlus size={13} strokeWidth={2} className={cn(pending && "animate-pulse")} />
              Add action
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActionSkeleton(): React.ReactElement {
  return (
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_120px]">
          <div className="flex gap-3">
            <Skeleton className="size-6 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <Skeleton className="h-7 rounded-md" />
        </div>
      ))}
    </>
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function actionStats(
  actions: WikiActionItem[],
  todayKey: string,
): {
  todayOpen: number;
  open: number;
  done: number;
  total: number;
} {
  let todayOpen = 0;
  let open = 0;
  let done = 0;
  for (const action of actions) {
    if (action.completed) {
      done += 1;
      continue;
    }
    open += 1;
    if (actionDateKey(action) === todayKey) {
      todayOpen += 1;
    }
  }
  return { todayOpen, open, done, total: actions.length };
}

function filterActions(
  actions: WikiActionItem[],
  options: {
    scope: ActionScope;
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

function viewTitle(scope: ActionScope, status: WikiActionStatusFilter): string {
  if (status === "done") {
    return "Completed";
  }
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
