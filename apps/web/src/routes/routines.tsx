import { type AnyFieldApi, useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Box,
  CalendarClock,
  FileJson,
  Layers,
  LayoutTemplate,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  RotateCw,
  Save,
  ShieldCheck,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormField, fieldError, hasError, SelectInput } from "@/components/form";
import { PageContainer, PageHeader } from "@/components/page-layout";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { TabsIndicator, TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  RoutineArtifactRecord,
  RoutineCreateInput,
  RoutineDetail,
  RoutineRunRecord,
  RoutineRunResult,
  RoutineStatus,
  RoutineStatusFilter,
  RoutineSummary,
  RoutineTrigger,
} from "@/lib/api";
import {
  BLANK_ROUTINE_FORM,
  buildRoutinePayload,
  OUTPUT_MODE_OPTIONS,
  ROUTINE_STATUS_OPTIONS,
  type RoutineFormMode,
  type RoutineFormValues,
  routineFieldSchemas,
  routineFormValues,
  TOOL_PROFILE_OPTIONS,
} from "@/lib/forms/routineForm";
import { jsonObjectText } from "@/lib/forms/zod";
import {
  useCreateRoutine,
  useCreateRoutineFromTemplate,
  useCreateRoutineTrigger,
  useDeleteRoutine,
  useDeleteRoutineTrigger,
  useRoutine,
  useRoutineArtifacts,
  useRoutineRuns,
  useRoutines,
  useRoutineTemplates,
  useRoutineTriggers,
  useRunRoutine,
  useRunRoutineTriggerNow,
  useSetRoutineStatus,
  useUpdateRoutine,
  useUpdateRoutineTrigger,
} from "@/lib/queries/routines";
import { cn } from "@/lib/utils";

const STATUS_FILTERS: { label: string; value: RoutineStatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Enabled", value: "enabled" },
  { label: "Disabled", value: "disabled" },
  { label: "Archived", value: "archived" },
];

type RunDialogState = {
  open: boolean;
  inputText: string;
  busy: boolean;
  error: string | null;
  result: RoutineRunResult | null;
};

const CLOSED_RUN_DIALOG: RunDialogState = {
  open: false,
  inputText: "{}",
  busy: false,
  error: null,
  result: null,
};

interface EditorState {
  open: boolean;
  mode: RoutineFormMode;
  initialValues: RoutineFormValues;
}

const CLOSED_EDITOR: EditorState = {
  open: false,
  mode: "create",
  initialValues: BLANK_ROUTINE_FORM,
};

interface ScheduleCadence {
  id: string;
  label: string;
  trigger: RoutineTrigger["trigger"];
}

const SCHEDULE_CADENCES: ScheduleCadence[] = [
  { id: "hourly", label: "Hourly", trigger: { type: "interval", seconds: 3_600 } },
  { id: "daily", label: "Daily", trigger: { type: "interval", seconds: 86_400 } },
  { id: "weekly", label: "Weekly", trigger: { type: "interval", seconds: 604_800 } },
  { id: "cron", label: "Custom cron", trigger: { type: "cron", expression: "0 9 * * *" } },
];

interface ScheduleFormValues {
  name: string;
  cadenceId: string;
  cron: string;
  inputText: string;
}

interface ScheduleDialogState {
  open: boolean;
  routineId: string | null;
  initialValues: ScheduleFormValues;
}

const BLANK_SCHEDULE_FORM: ScheduleFormValues = {
  name: "",
  cadenceId: "daily",
  cron: "0 9 * * *",
  inputText: "{}",
};

const CLOSED_SCHEDULE_DIALOG: ScheduleDialogState = {
  open: false,
  routineId: null,
  initialValues: BLANK_SCHEDULE_FORM,
};

export function RoutinesPage(): React.ReactElement {
  const [status, setStatus] = useState<RoutineStatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [runDialog, setRunDialog] = useState<RunDialogState>(CLOSED_RUN_DIALOG);
  const [editor, setEditor] = useState<EditorState>(CLOSED_EDITOR);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [scheduleDialog, setScheduleDialog] = useState<ScheduleDialogState>(CLOSED_SCHEDULE_DIALOG);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const routinesQuery = useRoutines(status);
  const runsQuery = useRoutineRuns();
  const artifactsQuery = useRoutineArtifacts();
  const triggersQuery = useRoutineTriggers(selectedId);
  const detailQuery = useRoutine(selectedId);

  const templatesQuery = useRoutineTemplates();
  const createFromTemplateMutation = useCreateRoutineFromTemplate();
  const runRoutineMutation = useRunRoutine();
  const createRoutineMutation = useCreateRoutine();
  const updateRoutineMutation = useUpdateRoutine();
  const setStatusMutation = useSetRoutineStatus();
  const deleteRoutineMutation = useDeleteRoutine();
  const createTriggerMutation = useCreateRoutineTrigger(selectedId);
  const updateTriggerMutation = useUpdateRoutineTrigger(selectedId);
  const deleteTriggerMutation = useDeleteRoutineTrigger(selectedId);
  const runTriggerMutation = useRunRoutineTriggerNow(selectedId);

  const routines = useMemo(() => routinesQuery.data ?? [], [routinesQuery.data]);
  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);
  const artifacts = useMemo(() => artifactsQuery.data ?? [], [artifactsQuery.data]);
  const detail = detailQuery.data ?? null;

  const loaded = !routinesQuery.isPending;
  const listError = routinesQuery.error ? messageOf(routinesQuery.error) : null;
  const detailError = detailQuery.error ? messageOf(detailQuery.error) : mutationError;
  const isPending =
    routinesQuery.isFetching ||
    runsQuery.isFetching ||
    artifactsQuery.isFetching ||
    triggersQuery.isFetching;
  const statusBusy =
    setStatusMutation.isPending ||
    deleteRoutineMutation.isPending ||
    createTriggerMutation.isPending ||
    updateTriggerMutation.isPending ||
    deleteTriggerMutation.isPending ||
    runTriggerMutation.isPending;

  // Keep the selection valid as the filtered list changes; clear stale mutation
  // feedback when the user moves to a different routine.
  useEffect(() => {
    setSelectedId((current) => {
      if (current !== null && routines.some((routine) => routine.id === current)) {
        return current;
      }
      return routines[0]?.id ?? null;
    });
  }, [routines]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset feedback on selection change
  useEffect(() => {
    setMutationError(null);
  }, [selectedId]);

  const runsByRoutine = useMemo(() => indexRunsByRoutine(runs), [runs]);
  const artifactCounts = useMemo(() => countArtifactsByRoutine(artifacts), [artifacts]);

  const refresh = useCallback(() => {
    void routinesQuery.refetch();
    void runsQuery.refetch();
    void artifactsQuery.refetch();
    if (selectedId !== null) {
      void triggersQuery.refetch();
      void detailQuery.refetch();
    }
  }, [routinesQuery, runsQuery, artifactsQuery, triggersQuery, detailQuery, selectedId]);

  const selectedRuns = useMemo(
    () => (selectedId === null ? [] : (runsByRoutine.get(selectedId) ?? [])),
    [runsByRoutine, selectedId],
  );
  const selectedArtifacts = useMemo(
    () =>
      selectedId === null ? [] : artifacts.filter((artifact) => artifact.routineId === selectedId),
    [artifacts, selectedId],
  );

  const selectedTriggers = useMemo(() => triggersQuery.data ?? [], [triggersQuery.data]);

  const openRunDialog = useCallback(() => {
    setRunDialog({
      ...CLOSED_RUN_DIALOG,
      open: true,
      inputText: detail?.defaultInput ? formatJson(detail.defaultInput) : "{}",
    });
  }, [detail]);

  const closeRunDialog = useCallback(() => {
    setRunDialog((current) => (current.busy ? current : CLOSED_RUN_DIALOG));
  }, []);

  const submitRun = useCallback(() => {
    if (selectedId === null) {
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      const trimmed = runDialog.inputText.trim();
      const value: unknown = trimmed === "" ? {} : JSON.parse(trimmed);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Routine input must be a JSON object.");
      }
      parsed = value as Record<string, unknown>;
    } catch (cause: unknown) {
      setRunDialog((current) => ({ ...current, error: messageOf(cause) }));
      return;
    }

    setRunDialog((current) => ({ ...current, busy: true, error: null, result: null }));
    runRoutineMutation.mutate(
      { id: selectedId, input: parsed },
      {
        onSuccess: (result) => setRunDialog((current) => ({ ...current, busy: false, result })),
        onError: (cause) =>
          setRunDialog((current) => ({ ...current, busy: false, error: messageOf(cause) })),
      },
    );
  }, [runRoutineMutation, runDialog.inputText, selectedId]);

  const openCreateEditor = useCallback(() => {
    setEditorError(null);
    setEditor({ open: true, mode: "create", initialValues: BLANK_ROUTINE_FORM });
  }, []);

  const instantiateTemplate = useCallback(
    (key: string) => {
      setMutationError(null);
      createFromTemplateMutation.mutate(key, {
        onSuccess: (routine) => setSelectedId(routine.id),
        onError: (cause) => setMutationError(messageOf(cause)),
      });
    },
    [createFromTemplateMutation],
  );

  const openEditEditor = useCallback(() => {
    if (detail === null) {
      return;
    }
    setEditorError(null);
    setEditor({ open: true, mode: "edit", initialValues: routineFormValues(detail) });
  }, [detail]);

  const closeEditor = useCallback(() => {
    setEditor((current) => ({ ...current, open: false }));
  }, []);

  const submitEditor = useCallback(
    async (values: RoutineFormValues) => {
      setEditorError(null);
      let payload: RoutineCreateInput;
      try {
        payload = buildRoutinePayload(values, editor.mode);
      } catch (cause: unknown) {
        setEditorError(messageOf(cause));
        return;
      }
      try {
        const saved =
          editor.mode === "create"
            ? await createRoutineMutation.mutateAsync(payload)
            : await updateRoutineMutation.mutateAsync({ ...payload, id: editor.initialValues.id });
        setEditor((current) => ({ ...current, open: false }));
        setSelectedId(saved.id);
      } catch (cause: unknown) {
        setEditorError(messageOf(cause));
      }
    },
    [editor.mode, editor.initialValues.id, createRoutineMutation, updateRoutineMutation],
  );

  const toggleStatus = useCallback(() => {
    if (detail === null) {
      return;
    }
    const nextStatus: RoutineStatus = detail.status === "enabled" ? "disabled" : "enabled";
    setMutationError(null);
    setStatusMutation.mutate(
      { id: detail.id, status: nextStatus },
      { onError: (cause) => setMutationError(messageOf(cause)) },
    );
  }, [detail, setStatusMutation]);

  const removeRoutine = useCallback(() => {
    if (detail === null) {
      return;
    }
    if (!window.confirm(`Delete routine ${detail.id}? This cannot be undone.`)) {
      return;
    }
    setMutationError(null);
    deleteRoutineMutation.mutate(detail.id, {
      onSuccess: () => setSelectedId(null),
      onError: (cause) => setMutationError(messageOf(cause)),
    });
  }, [detail, deleteRoutineMutation]);

  const openScheduleDialog = useCallback(() => {
    if (detail === null) {
      return;
    }
    setScheduleError(null);
    setScheduleDialog({
      open: true,
      routineId: detail.id,
      initialValues: {
        ...BLANK_SCHEDULE_FORM,
        name: `${detail.name} schedule`,
        inputText: detail.defaultInput ? formatJson(detail.defaultInput) : "{}",
      },
    });
  }, [detail]);

  const closeScheduleDialog = useCallback(() => {
    setScheduleDialog((current) => ({ ...current, open: false }));
  }, []);

  const submitSchedule = useCallback(
    async (values: ScheduleFormValues) => {
      const routineId = scheduleDialog.routineId;
      if (routineId === null) {
        return;
      }
      setScheduleError(null);
      const cadence = SCHEDULE_CADENCES.find((entry) => entry.id === values.cadenceId);
      if (cadence === undefined) {
        setScheduleError("Pick a cadence.");
        return;
      }
      const trigger: RoutineTrigger["trigger"] =
        cadence.id === "cron" ? { type: "cron", expression: values.cron.trim() } : cadence.trigger;
      if (trigger.type === "cron" && trigger.expression === "") {
        setScheduleError("Cron expression is required.");
        return;
      }
      let routineInput: Record<string, unknown>;
      try {
        const trimmed = values.inputText.trim();
        const value: unknown = trimmed === "" ? {} : JSON.parse(trimmed);
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("Routine input must be a JSON object.");
        }
        routineInput = value as Record<string, unknown>;
      } catch (cause: unknown) {
        setScheduleError(messageOf(cause));
        return;
      }
      const name = values.name.trim();
      try {
        await createTriggerMutation.mutateAsync({
          routineId,
          input: routineInput,
          trigger,
          enabled: true,
          ...(name === "" ? {} : { name }),
        });
        setScheduleDialog((current) => ({ ...current, open: false }));
      } catch (cause: unknown) {
        setScheduleError(messageOf(cause));
      }
    },
    [scheduleDialog.routineId, createTriggerMutation],
  );

  const toggleSchedule = useCallback(
    (trigger: RoutineTrigger) => {
      setMutationError(null);
      updateTriggerMutation.mutate(
        { id: trigger.id, enabled: !trigger.enabled },
        { onError: (cause) => setMutationError(messageOf(cause)) },
      );
    },
    [updateTriggerMutation],
  );

  const runScheduleById = useCallback(
    (id: string) => {
      setMutationError(null);
      runTriggerMutation.mutate(id, { onError: (cause) => setMutationError(messageOf(cause)) });
    },
    [runTriggerMutation],
  );

  const deleteScheduleById = useCallback(
    (id: string) => {
      setMutationError(null);
      deleteTriggerMutation.mutate(id, { onError: (cause) => setMutationError(messageOf(cause)) });
    },
    [deleteTriggerMutation],
  );

  return (
    <PageContainer width="wide" fill>
      <PageHeader
        icon={<Workflow size={15} strokeWidth={1.75} />}
        title="Routines"
        description="Inspect saved agent automations: definitions, structured runs, output artifacts, and linked traces."
        actions={
          <>
            <RoutineStatusToggle value={status} onChange={setStatus} />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={refresh}
              disabled={isPending}
            >
              <RotateCw size={13} strokeWidth={2} className={cn(isPending && "animate-spin")} />
              Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={createFromTemplateMutation.isPending}
                >
                  <LayoutTemplate size={13} strokeWidth={2} />
                  From template
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-80 border-hairline bg-surface p-1.5 text-fg"
              >
                <DropdownMenuLabel className="px-2 py-1 label-eyebrow">
                  Built-in routines
                </DropdownMenuLabel>
                {(templatesQuery.data ?? []).map((template) => (
                  <DropdownMenuItem
                    key={template.key}
                    disabled={createFromTemplateMutation.isPending}
                    onSelect={() => instantiateTemplate(template.key)}
                    className="items-start rounded-md py-2 pr-2 text-sm focus:bg-surface-2"
                  >
                    <span className="grid min-w-0 gap-0.5">
                      <span className="font-medium text-fg">{template.label}</span>
                      <span className="text-xs leading-snug text-fg-mute">
                        {template.description}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" onClick={openCreateEditor}>
              <Plus size={13} strokeWidth={2} />
              New routine
            </Button>
          </>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-hairline bg-surface lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-hairline bg-bg lg:border-r lg:border-b-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-3">
              <RoutineListHeader count={routines.length} />
              {listError ? (
                <ErrorBlock label="routine list error" message={listError} />
              ) : !loaded ? (
                <RoutineListSkeleton />
              ) : routines.length === 0 ? (
                <RoutineListEmpty status={status} onCreate={openCreateEditor} />
              ) : (
                <RoutineList
                  routines={routines}
                  runsByRoutine={runsByRoutine}
                  artifactCounts={artifactCounts}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              )}
            </div>
          </ScrollArea>
        </aside>

        <section className="min-h-0 min-w-0 bg-bg">
          <ScrollArea className="h-full">
            <RoutineDetailPanel
              detail={detail}
              selectedId={selectedId}
              error={detailError}
              runs={selectedRuns}
              artifacts={selectedArtifacts}
              schedules={selectedTriggers}
              statusBusy={statusBusy}
              onRunNow={openRunDialog}
              onEdit={openEditEditor}
              onToggleStatus={toggleStatus}
              onDelete={removeRoutine}
              onAddSchedule={openScheduleDialog}
              onToggleSchedule={toggleSchedule}
              onRunSchedule={runScheduleById}
              onDeleteSchedule={deleteScheduleById}
            />
          </ScrollArea>
        </section>
      </div>

      <RunNowDialog
        routine={detail}
        state={runDialog}
        onClose={closeRunDialog}
        onInputChange={(inputText) =>
          setRunDialog((current) => ({ ...current, inputText, error: null }))
        }
        onSubmit={submitRun}
      />

      <RoutineEditorDialog
        open={editor.open}
        mode={editor.mode}
        initialValues={editor.initialValues}
        serverError={editorError}
        onClose={closeEditor}
        onSubmit={submitEditor}
      />

      <ScheduleDialog
        open={scheduleDialog.open}
        initialValues={scheduleDialog.initialValues}
        serverError={scheduleError}
        onClose={closeScheduleDialog}
        onSubmit={submitSchedule}
      />
    </PageContainer>
  );
}

function RoutineStatusToggle({
  value,
  onChange,
}: {
  value: RoutineStatusFilter;
  onChange(value: RoutineStatusFilter): void;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-4 rounded-md border border-hairline p-0.5">
      {STATUS_FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => onChange(filter.value)}
          className={cn(
            "h-8 min-w-16 rounded-[5px] px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === filter.value ? "bg-surface-2 text-fg" : "text-fg-dim hover:text-fg",
          )}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function RoutineListHeader({ count }: { count: number }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 px-2">
      <div>
        <p className="label-eyebrow text-fg-mute">automations</p>
        <p className="mt-1 text-sm text-fg-dim">
          {count.toLocaleString()} routine{count === 1 ? "" : "s"}
        </p>
      </div>
    </div>
  );
}

function RoutineList({
  routines,
  runsByRoutine,
  artifactCounts,
  selectedId,
  onSelect,
}: {
  routines: RoutineSummary[];
  runsByRoutine: Map<string, RoutineRunRecord[]>;
  artifactCounts: Map<string, number>;
  selectedId: string | null;
  onSelect(id: string): void;
}): React.ReactElement {
  return (
    <ul className="flex flex-col gap-1">
      {routines.map((routine) => {
        const latestRun = runsByRoutine.get(routine.id)?.[0] ?? null;
        const artifactCount = artifactCounts.get(routine.id) ?? 0;
        return (
          <li key={routine.id}>
            <button
              type="button"
              onClick={() => onSelect(routine.id)}
              className={cn(
                "flex w-full min-w-0 flex-col gap-2 rounded-md border border-transparent px-3 py-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selectedId === routine.id && "border-hairline bg-surface shadow-sm",
              )}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <span className="line-clamp-2 min-w-0 text-sm font-medium text-fg">
                  {routine.name}
                </span>
                <RoutineStatusBadge status={routine.status} />
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-mute">
                <span className="truncate font-mono">{routine.id}</span>
                <span className="font-mono">v{routine.version}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-fg-mute">
                <span>output: {routine.outputMode}</span>
                <ToolProfileText profile={routine.toolProfile} />
                {latestRun ? (
                  <TaskStatusChip status={latestRun.taskStatus} runStatus={latestRun.status} />
                ) : (
                  <span className="text-fg-mute">no runs</span>
                )}
                {artifactCount > 0 ? (
                  <span className="font-mono">
                    {artifactCount} artifact{artifactCount === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RoutineListEmpty({
  status,
  onCreate,
}: {
  status: RoutineStatusFilter;
  onCreate(): void;
}): React.ReactElement {
  return (
    <div className="px-2 py-10 text-center">
      <Workflow size={20} strokeWidth={1.5} className="mx-auto text-fg-mute" />
      <p className="mt-3 text-sm font-medium text-fg">
        {status === "all" ? "No routines yet" : `No ${status} routines`}
      </p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-fg-dim">
        A routine is a saved agent automation: a prompt plus input/output schemas, a tool profile,
        optional pre-run jobs, and triggers. Create one to run it manually or on a schedule.
      </p>
      {status === "all" ? (
        <Button type="button" size="sm" className="mt-4" onClick={onCreate}>
          <Plus size={13} strokeWidth={2} />
          New routine
        </Button>
      ) : null}
    </div>
  );
}

function RoutineDetailPanel({
  detail,
  selectedId,
  error,
  runs,
  artifacts,
  schedules,
  statusBusy,
  onRunNow,
  onEdit,
  onToggleStatus,
  onDelete,
  onAddSchedule,
  onToggleSchedule,
  onRunSchedule,
  onDeleteSchedule,
}: {
  detail: RoutineDetail | null;
  selectedId: string | null;
  error: string | null;
  runs: RoutineRunRecord[];
  artifacts: RoutineArtifactRecord[];
  schedules: RoutineTrigger[];
  statusBusy: boolean;
  onRunNow(): void;
  onEdit(): void;
  onToggleStatus(): void;
  onDelete(): void;
  onAddSchedule(): void;
  onToggleSchedule(trigger: RoutineTrigger): void;
  onRunSchedule(id: string): void;
  onDeleteSchedule(id: string): void;
}): React.ReactElement {
  if (selectedId === null) {
    return (
      <Empty className="min-h-[420px] justify-center">
        <EmptyHeader>
          <EmptyTitle>Select a routine</EmptyTitle>
          <EmptyDescription>Choose an automation to inspect its contract.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (error !== null) {
    return (
      <div className="p-4 md:p-8">
        <ErrorBlock label="routine detail error" message={error} />
      </div>
    );
  }

  if (detail === null) {
    return <RoutineDetailSkeleton />;
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RoutineStatusBadge status={detail.status} />
            <span className="label-eyebrow text-fg-mute">v{detail.version}</span>
          </div>
          <h2 className="mt-2 text-xl font-medium tracking-tight text-fg">{detail.name}</h2>
          <p className="mt-1 break-all font-mono text-xs text-fg-mute">{detail.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={statusBusy} onClick={onEdit}>
            <Pencil size={13} strokeWidth={2} />
            Edit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={statusBusy || detail.status === "archived"}
            onClick={onToggleStatus}
          >
            <Power size={13} strokeWidth={2} />
            {detail.status === "enabled" ? "Disable" : "Enable"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={statusBusy}
            onClick={onDelete}
          >
            <Trash2 size={13} strokeWidth={2} />
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={detail.status === "archived"}
            onClick={onRunNow}
          >
            <Play size={13} strokeWidth={2} />
            Run now
          </Button>
        </div>
      </div>

      {detail.description ? (
        <p className="mb-5 max-w-3xl text-sm leading-6 text-fg-dim">{detail.description}</p>
      ) : null}

      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <MetaCell
          icon={<Layers size={13} strokeWidth={1.75} />}
          label="output mode"
          value={detail.outputMode}
        />
        <MetaCell
          icon={<ShieldCheck size={13} strokeWidth={1.75} />}
          label="tool profile"
          value={detail.toolProfile}
          tone={toolProfileTone(detail.toolProfile)}
        />
        <MetaCell
          icon={<Box size={13} strokeWidth={1.75} />}
          label="publication"
          value={publicationLabel(detail.publicationPolicy)}
        />
      </div>

      {detail.toolProfile === "dangerous" ? (
        <CalloutWarning>
          This routine runs with the <strong>dangerous</strong> tool profile — file writes, learning
          tools, and shell commands are available. Every run executes autonomously without approval
          prompts. Review the prompt and pre-run jobs before scheduling it.
        </CalloutWarning>
      ) : null}

      <Section
        title="Triggers"
        icon={<CalendarClock size={13} strokeWidth={1.75} />}
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={statusBusy || detail.status === "archived"}
            onClick={onAddSchedule}
          >
            <Plus size={13} strokeWidth={2} />
            Schedule
          </Button>
        }
      >
        <TriggerList
          schedules={schedules}
          statusBusy={statusBusy}
          onToggle={onToggleSchedule}
          onRun={onRunSchedule}
          onDelete={onDeleteSchedule}
        />
      </Section>

      <Section title="Prompt">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-hairline bg-surface p-3 text-xs leading-5 text-fg">
          {detail.prompt}
        </pre>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Input schema">
          <JsonBlock value={detail.inputSchema} />
        </Section>
        <Section title="Output schema">
          {detail.outputSchema === null ? (
            <EmptyNote>No structured output schema.</EmptyNote>
          ) : (
            <JsonBlock value={detail.outputSchema} />
          )}
        </Section>
      </div>

      {detail.defaultInput ? (
        <Section title="Default input">
          <JsonBlock value={detail.defaultInput} />
        </Section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Required skills">
          {detail.requiredSkills.length === 0 ? (
            <EmptyNote>No required skills.</EmptyNote>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.requiredSkills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-sm border border-hairline bg-surface px-2 py-1 font-mono text-xs text-fg-dim"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </Section>
        <Section title="Pre-run jobs">
          {detail.preRunSteps.length === 0 ? (
            <EmptyNote>No pre-run jobs.</EmptyNote>
          ) : (
            <ol className="space-y-2">
              {detail.preRunSteps.map((step, index) => (
                <li
                  key={`${step.jobName}:${index}`}
                  className="rounded-md border border-hairline bg-surface p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-2xs text-fg-mute">{index + 1}</span>
                    <span className="font-mono text-xs text-fg">{step.jobName}</span>
                  </div>
                  {Object.keys(step.input).length > 0 ? (
                    <JsonBlock value={step.input} className="mt-2 max-h-40" />
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <Section title="Publication policy">
        <JsonBlock value={detail.publicationPolicy} />
      </Section>

      <Section
        title={`Run history (${runs.length})`}
        icon={<ListChecks size={13} strokeWidth={1.75} />}
      >
        <RunHistory runs={runs} />
      </Section>

      <Section
        title={`Artifacts (${artifacts.length})`}
        icon={<FileJson size={13} strokeWidth={1.75} />}
      >
        <ArtifactList artifacts={artifacts} />
      </Section>
    </div>
  );
}

function TriggerList({
  schedules,
  statusBusy,
  onToggle,
  onRun,
  onDelete,
}: {
  schedules: RoutineTrigger[];
  statusBusy: boolean;
  onToggle(trigger: RoutineTrigger): void;
  onRun(id: string): void;
  onDelete(id: string): void;
}): React.ReactElement {
  if (schedules.length === 0) {
    return (
      <EmptyNote>
        Manual only — no triggers attached. Use Schedule to run this routine on a recurring cadence.
      </EmptyNote>
    );
  }
  return (
    <div className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
      {schedules.map((schedule) => (
        <article key={schedule.id} className="bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={schedule.enabled ? "ready" : "muted"} pulse={schedule.enabled}>
              {schedule.enabled ? "enabled" : "paused"}
            </Badge>
            <span className="truncate text-xs font-medium text-fg">
              {schedule.name ?? "(unnamed)"}
            </span>
            <span className="font-mono text-2xs text-fg-mute">
              {formatTrigger(schedule.trigger)}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-2xs"
                disabled={statusBusy}
                onClick={() => onRun(schedule.id)}
              >
                <Play size={12} strokeWidth={2} />
                Run
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-2xs"
                disabled={statusBusy}
                onClick={() => onToggle(schedule)}
              >
                <Pause size={12} strokeWidth={2} />
                {schedule.enabled ? "Pause" : "Resume"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-2xs"
                disabled={statusBusy}
                onClick={() => onDelete(schedule.id)}
              >
                <Trash2 size={12} strokeWidth={2} />
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-fg-mute">
            <span>next {formatDateTime(schedule.nextRunAt)}</span>
            <span>last {formatDateTime(schedule.lastRunAt)}</span>
            {schedule.lastStatus ? <span>status {schedule.lastStatus}</span> : null}
          </div>
          {schedule.lastError ? <InlineError message={schedule.lastError} /> : null}
        </article>
      ))}
    </div>
  );
}

function ToolProfileText({
  profile,
}: {
  profile: RoutineSummary["toolProfile"];
}): React.ReactElement {
  const tone = toolProfileTone(profile);
  const className = tone === "bad" ? "text-bad" : tone === "warning" ? "text-warn" : "text-fg-mute";
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {tone === "bad" ? <AlertTriangle size={11} strokeWidth={1.75} /> : null}
      {profile}
    </span>
  );
}

function CalloutWarning({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mb-5 flex gap-2.5 rounded-md border border-warn/40 bg-warn/[0.07] p-3">
      <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warn" />
      <p className="text-xs leading-5 text-fg-dim">{children}</p>
    </div>
  );
}

function RunHistory({ runs }: { runs: RoutineRunRecord[] }): React.ReactElement {
  if (runs.length === 0) {
    return <EmptyNote>No runs recorded yet.</EmptyNote>;
  }
  return (
    <div className="space-y-2">
      <p className="text-2xs leading-5 text-fg-mute">
        <span className="font-medium text-fg-dim">Run status</span> is the infrastructure outcome
        (did the session start and exit cleanly).{" "}
        <span className="font-medium text-fg-dim">Task status</span> is whether the routine's work
        succeeded — a completed run can still need review. Open a session to confirm.
      </p>
      <div className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
        {runs.map((run) => (
          <article key={run.id} className="bg-surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span title="Infrastructure status">
                <RunStatusBadge status={run.status} />
              </span>
              <span title="Task outcome">
                <TaskStatusChip status={run.taskStatus} runStatus={run.status} />
              </span>
              <span className="font-mono text-2xs text-fg-mute">v{run.routineVersion}</span>
              <span className="ml-auto font-mono text-2xs text-fg-mute">
                {formatDateTime(run.startedAt)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-fg-mute">
              <span className="truncate">run {run.id}</span>
              {run.finishedAt ? <span>finished {formatDateTime(run.finishedAt)}</span> : null}
              <span>
                {run.outputArtifactIds.length} artifact
                {run.outputArtifactIds.length === 1 ? "" : "s"}
              </span>
              {run.childSessionIds.length > 0 ? (
                <span>{run.childSessionIds.length} child sessions</span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
              <SessionRef label="agent" sessionId={run.agentSessionId} />
              <SessionRef label="job" sessionId={run.jobSessionId} linkable={false} />
            </div>
            {run.error ? <InlineError message={run.error} /> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: RoutineArtifactRecord[] }): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  if (artifacts.length === 0) {
    return <EmptyNote>No artifacts produced yet.</EmptyNote>;
  }
  return (
    <div className="space-y-2">
      {artifacts.map((artifact) => {
        const open = openId === artifact.id;
        return (
          <article
            key={artifact.id}
            className="overflow-hidden rounded-md border border-hairline bg-surface"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : artifact.id)}
              className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Badge tone={artifact.validationStatus === "valid" ? "ready" : "bad"}>
                {artifact.validationStatus}
              </Badge>
              <TaskStatusChip status={artifact.taskStatus} runStatus="completed" />
              <span className="font-mono text-xs text-fg-dim">
                {artifact.schemaName}@{artifact.schemaVersion}
              </span>
              <span className="ml-auto font-mono text-2xs text-fg-mute">
                {formatDateTime(artifact.createdAt)}
              </span>
            </button>
            {open ? (
              <div className="border-t border-hairline p-3">
                <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-fg-mute">
                  <span className="truncate">artifact {artifact.id}</span>
                  {artifact.dedupeKey ? <span>dedupe {artifact.dedupeKey}</span> : null}
                  <SessionRef label="session" sessionId={artifact.sessionId} />
                </div>
                <p className="label-eyebrow text-fg-mute">payload</p>
                <JsonBlock value={artifact.payload} className="mt-1.5 max-h-96" />
                {artifact.sourceRefs.length > 0 ? (
                  <>
                    <p className="mt-3 label-eyebrow text-fg-mute">
                      source refs ({artifact.sourceRefs.length})
                    </p>
                    <JsonBlock value={artifact.sourceRefs} className="mt-1.5 max-h-72" />
                  </>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function RunNowDialog({
  routine,
  state,
  onClose,
  onInputChange,
  onSubmit,
}: {
  routine: RoutineDetail | null;
  state: RunDialogState;
  onClose(): void;
  onInputChange(value: string): void;
  onSubmit(): void;
}): React.ReactElement {
  return (
    <Dialog open={state.open} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl border-hairline bg-surface text-fg">
        <DialogHeader>
          <DialogTitle className="text-md">Run {routine?.name ?? "routine"}</DialogTitle>
          <DialogDescription className="text-sm text-fg-dim">
            Provide structured JSON input. It is merged over the routine default input and validated
            against the input schema before the run starts.
          </DialogDescription>
        </DialogHeader>

        {routine?.toolProfile === "dangerous" ? (
          <CalloutWarning>
            This routine has the <strong>dangerous</strong> tool profile. Running it now executes
            autonomously with file writes, learning tools, and shell access — no approval prompts
            during the run.
          </CalloutWarning>
        ) : null}

        <div className="space-y-2">
          <span className="label-eyebrow text-fg-mute">input json</span>
          <Textarea
            value={state.inputText}
            onChange={(event) => onInputChange(event.target.value)}
            spellCheck={false}
            disabled={state.busy}
            className="min-h-40 font-mono text-xs"
          />
        </div>

        {state.error ? <ErrorBlock label="run error" message={state.error} /> : null}
        {state.result ? <RunResultPanel result={state.result} /> : null}

        <DialogFooter>
          <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={state.busy}>
            <X size={13} strokeWidth={2} />
            Close
          </Button>
          <Button type="button" size="sm" onClick={onSubmit} disabled={state.busy}>
            {state.busy ? (
              <RotateCw size={13} strokeWidth={2} className="animate-spin" />
            ) : (
              <Play size={13} strokeWidth={2} />
            )}
            Run routine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleDialog({
  open,
  initialValues,
  serverError,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initialValues: ScheduleFormValues;
  serverError: string | null;
  onClose(): void;
  onSubmit(values: ScheduleFormValues): Promise<void> | void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-xl border-hairline bg-surface text-fg">
        <DialogHeader>
          <DialogTitle className="text-md">Schedule routine</DialogTitle>
          <DialogDescription className="text-sm text-fg-dim">
            Adds a recurring trigger that runs this routine locally through the shared scheduler.
            The minimum interval is one hour.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <ScheduleForm
            key={initialValues.name}
            initialValues={initialValues}
            serverError={serverError}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  initialValues,
  serverError,
  onClose,
  onSubmit,
}: {
  initialValues: ScheduleFormValues;
  serverError: string | null;
  onClose(): void;
  onSubmit(values: ScheduleFormValues): Promise<void> | void;
}): React.ReactElement {
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-3"
    >
      <form.Field name="name">
        {(field) => (
          <FormField label="schedule name">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Daily routine run"
            />
          </FormField>
        )}
      </form.Field>

      <form.Field name="cadenceId">
        {(field) => (
          <FormField label="cadence">
            <SelectInput
              value={field.state.value}
              options={SCHEDULE_CADENCES.map((cadence) => ({
                value: cadence.id,
                label: cadence.label,
              }))}
              onChange={(value) => field.handleChange(value)}
            />
          </FormField>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.values.cadenceId}>
        {(cadenceId) =>
          cadenceId === "cron" ? (
            <form.Field
              name="cron"
              validators={{
                onChangeListenTo: ["cadenceId"],
                onChange: ({ value, fieldApi }) =>
                  fieldApi.form.getFieldValue("cadenceId") === "cron" && value.trim() === ""
                    ? "Cron expression is required."
                    : undefined,
              }}
            >
              {(field) => (
                <FormField
                  label="cron expression"
                  hint="min interval 1h"
                  error={fieldError(field.state.meta)}
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={hasError(field.state.meta)}
                    placeholder="0 9 * * *"
                    className="font-mono text-xs"
                  />
                </FormField>
              )}
            </form.Field>
          ) : null
        }
      </form.Subscribe>

      <form.Field name="inputText" validators={{ onChange: jsonObjectText("Run input") }}>
        {(field) => (
          <FormField label="run input (json)" error={fieldError(field.state.meta)}>
            <Textarea
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              spellCheck={false}
              aria-invalid={hasError(field.state.meta)}
              className="min-h-28 font-mono text-xs"
            />
          </FormField>
        )}
      </form.Field>

      {serverError ? <ErrorBlock label="schedule error" message={serverError} /> : null}

      <DialogFooter>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          <X size={13} strokeWidth={2} />
          Cancel
        </Button>
        <form.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isSubmitting ? (
                <RotateCw size={13} strokeWidth={2} className="animate-spin" />
              ) : (
                <CalendarClock size={13} strokeWidth={2} />
              )}
              Create schedule
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

function RoutineEditorDialog({
  open,
  mode,
  initialValues,
  serverError,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: RoutineFormMode;
  initialValues: RoutineFormValues;
  serverError: string | null;
  onClose(): void;
  onSubmit(values: RoutineFormValues): Promise<void> | void;
}): React.ReactElement {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[88dvh] max-w-3xl overflow-y-auto border-hairline bg-surface text-fg">
        <DialogHeader>
          <DialogTitle className="text-md">
            {mode === "create" ? "New routine" : `Edit ${initialValues.name || initialValues.id}`}
          </DialogTitle>
          <DialogDescription className="text-sm text-fg-dim">
            Fields validate as you edit; the server re-validates against the same rules as the CLI.
            Schema, default input, pre-run steps, and publication policy accept JSON.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <RoutineEditorForm
            key={`${mode}:${initialValues.id}`}
            mode={mode}
            initialValues={initialValues}
            serverError={serverError}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RoutineEditorForm({
  mode,
  initialValues,
  serverError,
  onClose,
  onSubmit,
}: {
  mode: RoutineFormMode;
  initialValues: RoutineFormValues;
  serverError: string | null;
  onClose(): void;
  onSubmit(values: RoutineFormValues): Promise<void> | void;
}): React.ReactElement {
  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <TabsRoot defaultValue="details">
        <TabsList>
          <TabsTab value="details">Details</TabsTab>
          <TabsTab value="behavior">Behavior</TabsTab>
          <TabsTab value="schemas">Schemas</TabsTab>
          <TabsIndicator />
        </TabsList>

        <TabsPanel value="details" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field
              name="name"
              validators={{ onBlur: routineFieldSchemas.name, onChange: routineFieldSchemas.name }}
            >
              {(field) => (
                <FormField label="name" error={fieldError(field.state.meta)}>
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={hasError(field.state.meta)}
                    placeholder="Granola daily TODO discovery"
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="id" validators={{ onChange: routineFieldSchemas.id }}>
              {(field) => (
                <FormField
                  label={mode === "create" ? "id (optional)" : "id"}
                  hint={mode === "edit" ? "immutable" : undefined}
                  error={fieldError(field.state.meta)}
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    disabled={mode === "edit"}
                    aria-invalid={hasError(field.state.meta)}
                    placeholder="routine_granola_daily_todos"
                    className="font-mono text-xs"
                  />
                </FormField>
              )}
            </form.Field>
          </div>

          <form.Field
            name="prompt"
            validators={{
              onBlur: routineFieldSchemas.prompt,
              onChange: routineFieldSchemas.prompt,
            }}
          >
            {(field) => (
              <FormField
                label="prompt"
                hint="the most important field — be explicit and self-contained"
                error={fieldError(field.state.meta)}
              >
                <Textarea
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  spellCheck
                  aria-invalid={hasError(field.state.meta)}
                  className="min-h-40 text-sm"
                  placeholder="Self-contained agent instructions. The routine runs autonomously, so state exactly what to do, what to read/write, and what success looks like."
                />
              </FormField>
            )}
          </form.Field>

          <form.Field
            name="description"
            validators={{
              onBlur: routineFieldSchemas.description,
              onChange: routineFieldSchemas.description,
            }}
          >
            {(field) => (
              <FormField label="description" error={fieldError(field.state.meta)}>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={hasError(field.state.meta)}
                  placeholder="One line: what this routine does."
                />
              </FormField>
            )}
          </form.Field>

          <form.Field name="status">
            {(field) => (
              <FormField label="status">
                <SelectInput
                  value={field.state.value}
                  options={ROUTINE_STATUS_OPTIONS}
                  onChange={(value) => field.handleChange(value as RoutineStatus)}
                />
              </FormField>
            )}
          </form.Field>
        </TabsPanel>

        <TabsPanel value="behavior" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field name="toolProfile">
              {(field) => (
                <FormField label="tool profile">
                  <SelectInput
                    value={field.state.value}
                    options={TOOL_PROFILE_OPTIONS}
                    onChange={(value) => field.handleChange(value as RoutineDetail["toolProfile"])}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="outputMode">
              {(field) => (
                <FormField label="output mode">
                  <SelectInput
                    value={field.state.value}
                    options={OUTPUT_MODE_OPTIONS}
                    onChange={(value) => field.handleChange(value as RoutineDetail["outputMode"])}
                  />
                </FormField>
              )}
            </form.Field>
          </div>

          <form.Subscribe selector={(state) => state.values.toolProfile}>
            {(toolProfile) =>
              toolProfile === "dangerous" ? (
                <CalloutWarning>
                  The <strong>dangerous</strong> profile grants file writes, learning tools, and
                  shell access. Scheduled runs use it without any approval prompt — only choose it
                  if the routine genuinely needs full access.
                </CalloutWarning>
              ) : null
            }
          </form.Subscribe>

          <form.Field name="requiredSkills">
            {(field) => (
              <FormField label="required skills" hint="comma or newline separated">
                <Textarea
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  spellCheck={false}
                  className="min-h-16 font-mono text-xs"
                  placeholder="granola-todo-extraction"
                />
              </FormField>
            )}
          </form.Field>
        </TabsPanel>

        <TabsPanel value="schemas" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field
              name="inputSchema"
              validators={{
                onChange: routineFieldSchemas.inputSchema,
                onBlur: routineFieldSchemas.inputSchema,
              }}
            >
              {(field) => renderJsonField(field, "input schema (json)")}
            </form.Field>
            <form.Field
              name="outputSchema"
              validators={{
                onChange: routineFieldSchemas.outputSchema,
                onBlur: routineFieldSchemas.outputSchema,
              }}
            >
              {(field) => renderJsonField(field, "output schema (json, blank = none)")}
            </form.Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <form.Field
              name="defaultInput"
              validators={{
                onChange: routineFieldSchemas.defaultInput,
                onBlur: routineFieldSchemas.defaultInput,
              }}
            >
              {(field) => renderJsonField(field, "default input (json, optional)")}
            </form.Field>
            <form.Field
              name="preRunSteps"
              validators={{
                onChange: routineFieldSchemas.preRunSteps,
                onBlur: routineFieldSchemas.preRunSteps,
              }}
            >
              {(field) => renderJsonField(field, "pre-run steps (json array)")}
            </form.Field>
          </div>

          <form.Field
            name="publicationPolicy"
            validators={{
              onChange: routineFieldSchemas.publicationPolicy,
              onBlur: routineFieldSchemas.publicationPolicy,
            }}
          >
            {(field) => renderJsonField(field, "publication policy (json)")}
          </form.Field>
        </TabsPanel>
      </TabsRoot>

      {serverError ? <ErrorBlock label="routine error" message={serverError} /> : null}

      <DialogFooter>
        <Button type="button" size="sm" variant="outline" onClick={onClose}>
          <X size={13} strokeWidth={2} />
          Cancel
        </Button>
        <form.Subscribe
          selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
        >
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isSubmitting ? (
                <RotateCw size={13} strokeWidth={2} className="animate-spin" />
              ) : (
                <Save size={13} strokeWidth={2} />
              )}
              {mode === "create" ? "Create routine" : "Save changes"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
}

/** Render a JSON-text field for a TanStack Form field (zod validator attached at the call site). */
function renderJsonField(field: AnyFieldApi, label: string): React.ReactElement {
  return (
    <FormField label={label} error={fieldError(field.state.meta)}>
      <Textarea
        value={field.state.value as string}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
        spellCheck={false}
        aria-invalid={hasError(field.state.meta)}
        className={cn(
          "min-h-24 font-mono text-xs",
          hasError(field.state.meta) && "border-bad/60 focus-visible:ring-bad",
        )}
      />
    </FormField>
  );
}

function RunResultPanel({ result }: { result: RoutineRunResult }): React.ReactElement {
  const metrics = (result.output?.metrics ?? {}) as Record<string, unknown>;
  const taskStatus = typeof metrics.taskStatus === "string" ? metrics.taskStatus : "unknown";
  const agentSessionId = typeof metrics.agentSessionId === "string" ? metrics.agentSessionId : null;
  const artifactCount = Array.isArray(metrics.outputArtifactIds)
    ? metrics.outputArtifactIds.length
    : 0;
  const ok = result.status === "completed";
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm text-fg-dim",
        ok ? "border-good/30 bg-good/[0.06]" : "border-bad/40 bg-bad/[0.06]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ok ? "ready" : "bad"}>{result.status}</Badge>
        <span className="font-mono text-2xs text-fg-mute">task: {taskStatus}</span>
        <span className="font-mono text-2xs text-fg-mute">
          {artifactCount} artifact{artifactCount === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-2">{result.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs">
        <SessionRef label="job session" sessionId={result.sessionId} linkable={false} />
        <SessionRef label="agent session" sessionId={agentSessionId} />
      </div>
      {result.errorMessage ? <InlineError message={result.errorMessage} /> : null}
    </div>
  );
}

function SessionRef({
  label,
  sessionId,
  linkable = true,
}: {
  label: string;
  sessionId: string | null;
  linkable?: boolean;
}): React.ReactElement | null {
  if (sessionId === null || sessionId === "") {
    return null;
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-2xs text-fg-mute">
      <span>{label}</span>
      {linkable ? (
        <Link
          to="/chat/$sessionId"
          params={{ sessionId }}
          className="truncate text-accent hover:underline"
        >
          {sessionId}
        </Link>
      ) : (
        <span className="truncate text-fg-dim">{sessionId}</span>
      )}
    </span>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-fg-mute">{icon}</span> : null}
          <h3 className="label-eyebrow text-fg-mute">{title}</h3>
        </div>
        {action ?? null}
      </div>
      {children}
    </section>
  );
}

function MetaCell({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "default" | "warning" | "bad";
}): React.ReactElement {
  const valueClass = tone === "bad" ? "text-bad" : tone === "warning" ? "text-warn" : "text-fg";
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="text-fg-mute">{icon}</span>
        <span className="label-eyebrow text-fg-mute">{label}</span>
      </div>
      <p className={cn("mt-2 truncate font-mono text-xs", valueClass)} title={value}>
        {value}
      </p>
    </div>
  );
}

function JsonBlock({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}): React.ReactElement {
  return (
    <pre
      className={cn(
        "max-h-80 overflow-auto rounded-md border border-hairline bg-surface p-3 text-xs leading-5 text-fg",
        className,
      )}
    >
      {formatJson(value)}
    </pre>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="rounded-md border border-dashed border-hairline px-3 py-2.5 text-xs text-fg-mute">
      {children}
    </p>
  );
}

function RoutineStatusBadge({ status }: { status: RoutineSummary["status"] }): React.ReactElement {
  const tone = status === "enabled" ? "ready" : status === "archived" ? "bad" : "muted";
  return (
    <Badge tone={tone} pulse={status === "enabled"}>
      {status}
    </Badge>
  );
}

function RunStatusBadge({ status }: { status: RoutineRunRecord["status"] }): React.ReactElement {
  const tone =
    status === "completed"
      ? "ready"
      : status === "failed"
        ? "bad"
        : status === "running"
          ? "warning"
          : "muted";
  return <Badge tone={tone}>{status}</Badge>;
}

function TaskStatusChip({
  status,
  runStatus,
}: {
  status: RoutineRunRecord["taskStatus"];
  runStatus: RoutineRunRecord["status"];
}): React.ReactElement {
  if (status === null) {
    return (
      <span className="font-mono text-2xs text-fg-mute">
        {runStatus === "running" ? "task pending" : "no task status"}
      </span>
    );
  }
  const tone =
    status === "succeeded"
      ? "ready"
      : status === "failed"
        ? "bad"
        : status === "needs_review"
          ? "warning"
          : "muted";
  return <Badge tone={tone}>{status}</Badge>;
}

function ErrorBlock({ label, message }: { label: string; message: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-bad/40 bg-bad/[0.06] p-3">
      <p className="font-mono text-xs text-bad">{label}</p>
      <p className="mt-1 text-sm text-fg-dim">{message}</p>
    </div>
  );
}

function InlineError({ message }: { message: string }): React.ReactElement {
  return (
    <p className="mt-2 rounded-sm bg-bad/10 px-2 py-1.5 font-mono text-2xs text-bad">{message}</p>
  );
}

function RoutineListSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="rounded-md border border-hairline bg-surface px-3 py-3">
          <Skeleton className={cn("h-4", index % 2 === 0 ? "w-4/5" : "w-2/3")} />
          <Skeleton className="mt-3 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function RoutineDetailSkeleton(): React.ReactElement {
  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-20 rounded-md" />
        ))}
      </div>
      <Skeleton className="mt-5 h-48 rounded-md" />
    </div>
  );
}

function indexRunsByRoutine(runs: RoutineRunRecord[]): Map<string, RoutineRunRecord[]> {
  const byRoutine = new Map<string, RoutineRunRecord[]>();
  for (const run of runs) {
    const existing = byRoutine.get(run.routineId);
    if (existing) {
      existing.push(run);
    } else {
      byRoutine.set(run.routineId, [run]);
    }
  }
  for (const list of byRoutine.values()) {
    list.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  return byRoutine;
}

function countArtifactsByRoutine(artifacts: RoutineArtifactRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    counts.set(artifact.routineId, (counts.get(artifact.routineId) ?? 0) + 1);
  }
  return counts;
}

function toolProfileTone(profile: RoutineSummary["toolProfile"]): "default" | "warning" | "bad" {
  if (profile === "dangerous") {
    return "bad";
  }
  if (profile === "learning") {
    return "warning";
  }
  return "default";
}

function formatTrigger(trigger: RoutineTrigger["trigger"]): string {
  if (trigger.type === "cron") {
    return `cron ${trigger.expression}`;
  }
  const seconds = trigger.seconds;
  if (seconds % 604_800 === 0) {
    return `every ${seconds / 604_800}w`;
  }
  if (seconds % 86_400 === 0) {
    return `every ${seconds / 86_400}d`;
  }
  if (seconds % 3_600 === 0) {
    return `every ${seconds / 3_600}h`;
  }
  if (seconds % 60 === 0) {
    return `every ${seconds / 60}m`;
  }
  return `every ${seconds}s`;
}

function publicationLabel(policy: RoutineDetail["publicationPolicy"]): string {
  if (policy.mode === "proposal") {
    return `proposal · ${policy.proposalKind}`;
  }
  if (policy.mode === "auto_publish") {
    return `auto_publish · ${policy.target}`;
  }
  return policy.mode;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
