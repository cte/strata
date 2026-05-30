import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRoutine,
  createRoutineFromTemplate,
  createRoutineTrigger,
  deleteRoutine,
  deleteRoutineTrigger,
  getRoutine,
  listRoutineArtifacts,
  listRoutineRuns,
  listRoutines,
  listRoutineTemplates,
  listRoutineTriggers,
  type RoutineArtifactRecord,
  type RoutineCreateInput,
  type RoutineDetail,
  type RoutineRunInput,
  type RoutineRunRecord,
  type RoutineStatus,
  type RoutineStatusFilter,
  type RoutineSummary,
  type RoutineTemplateSummary,
  type RoutineTrigger,
  type RoutineTriggerCreateInput,
  type RoutineTriggerUpdateInput,
  type RoutineUpdateInput,
  runRoutine,
  runRoutineTriggerNow,
  setRoutineStatus,
  updateRoutine,
  updateRoutineTrigger,
} from "@/lib/api";
import { qk } from "./keys";

export function useRoutineTriggers(routineId: string | null) {
  return useQuery<RoutineTrigger[]>({
    queryKey: qk.routines.triggers(routineId ?? ""),
    queryFn: () => listRoutineTriggers(routineId as string),
    enabled: routineId !== null,
  });
}

function useInvalidateRoutineTriggers(routineId: string | null) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.routines.triggers(routineId ?? "") });
    void queryClient.invalidateQueries({ queryKey: qk.routines.root });
  };
}

export function useCreateRoutineTrigger(routineId: string | null) {
  const invalidate = useInvalidateRoutineTriggers(routineId);
  return useMutation({
    mutationFn: (input: RoutineTriggerCreateInput) => createRoutineTrigger(input),
    onSuccess: invalidate,
  });
}

export function useUpdateRoutineTrigger(routineId: string | null) {
  const invalidate = useInvalidateRoutineTriggers(routineId);
  return useMutation({
    mutationFn: (input: RoutineTriggerUpdateInput) => updateRoutineTrigger(input),
    onSuccess: invalidate,
  });
}

export function useDeleteRoutineTrigger(routineId: string | null) {
  const invalidate = useInvalidateRoutineTriggers(routineId);
  return useMutation({
    mutationFn: (id: string) => deleteRoutineTrigger(id),
    onSuccess: invalidate,
  });
}

export function useRunRoutineTriggerNow(routineId: string | null) {
  const invalidate = useInvalidateRoutineTriggers(routineId);
  return useMutation({
    mutationFn: (id: string) => runRoutineTriggerNow(id),
    onSuccess: invalidate,
  });
}

export function useRoutineTemplates() {
  return useQuery<RoutineTemplateSummary[]>({
    queryKey: [...qk.routines.root, "templates"],
    queryFn: () => listRoutineTemplates(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCreateRoutineFromTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => createRoutineFromTemplate(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.routines.root });
    },
  });
}

export function useRoutines(status: RoutineStatusFilter) {
  return useQuery<RoutineSummary[]>({
    queryKey: qk.routines.list(status ?? "all"),
    queryFn: () => listRoutines({ status, limit: 200 }),
  });
}

export function useRoutine(id: string | null) {
  return useQuery<RoutineDetail | null>({
    queryKey: qk.routines.detail(id ?? ""),
    queryFn: () => getRoutine(id as string),
    enabled: id !== null,
  });
}

export function useRoutineRuns() {
  return useQuery<RoutineRunRecord[]>({
    queryKey: qk.routines.runs,
    queryFn: () => listRoutineRuns({ limit: 500 }),
  });
}

export function useRoutineArtifacts() {
  return useQuery<RoutineArtifactRecord[]>({
    queryKey: qk.routines.artifacts,
    queryFn: () => listRoutineArtifacts({ limit: 500 }),
  });
}

/** Invalidate everything a routine run/edit can touch: definitions, runs, artifacts. */
function useInvalidateRoutines() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.routines.root });
  };
}

export function useRunRoutine() {
  const invalidate = useInvalidateRoutines();
  return useMutation({
    mutationFn: (input: RoutineRunInput) => runRoutine(input),
    onSuccess: invalidate,
  });
}

export function useCreateRoutine() {
  const invalidate = useInvalidateRoutines();
  return useMutation({
    mutationFn: (input: RoutineCreateInput) => createRoutine(input),
    onSuccess: invalidate,
  });
}

export function useUpdateRoutine() {
  const invalidate = useInvalidateRoutines();
  return useMutation({
    mutationFn: (input: RoutineUpdateInput) => updateRoutine(input),
    onSuccess: invalidate,
  });
}

export function useSetRoutineStatus() {
  const invalidate = useInvalidateRoutines();
  return useMutation({
    mutationFn: (input: { id: string; status: RoutineStatus }) =>
      setRoutineStatus(input.id, input.status),
    onSuccess: invalidate,
  });
}

export function useDeleteRoutine() {
  const invalidate = useInvalidateRoutines();
  return useMutation({
    mutationFn: (id: string) => deleteRoutine(id),
    onSuccess: invalidate,
  });
}
