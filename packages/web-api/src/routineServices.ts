import { type JsonObject } from "@strata/core";
import {
  type CreateRoutineTriggerInput,
  createDefaultJobRegistry,
  type JobExecutionResult,
  RoutineTriggerStore,
  runJob,
  runTriggerNow,
  type UpdateRoutineTriggerInput,
} from "@strata/jobs";
import type {
  CreateRoutineInput,
  RoutinePreRunStep,
  RoutinePublicationPolicy,
  UpdateRoutineInput,
} from "@strata/routines";
import { listRoutineTemplates, RoutineStore, routineTemplateInput } from "@strata/routines";
import { repoRoot, runtimeEnv, type WebApiOptions } from "./runtime.js";
import type {
  RoutineArtifactsListRpcInput,
  RoutineCreateRpcInput,
  RoutineDeleteRpcInput,
  RoutineGetRpcInput,
  RoutineListRpcInput,
  RoutineRunRpcInput,
  RoutineRunsListRpcInput,
  RoutineSetStatusRpcInput,
  RoutineTemplateCreateRpcInput,
  RoutineTriggerCreateRpcInput,
  RoutineTriggerDeleteRpcInput,
  RoutineTriggerListRpcInput,
  RoutineTriggerRunNowRpcInput,
  RoutineTriggerUpdateRpcInput,
  RoutineUpdateRpcInput,
} from "./trpc.js";

export function listRoutineTemplatesForWeb() {
  return {
    templates: listRoutineTemplates().map((template) => ({
      key: template.key,
      label: template.label,
      description: template.definition.description,
    })),
  };
}

export async function createRoutineFromTemplateForWeb(
  input: RoutineTemplateCreateRpcInput,
  options: WebApiOptions,
) {
  const definition = routineTemplateInput(input.key);
  if (definition === null) {
    throw new Error(`Unknown routine template: ${input.key}`);
  }
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { routine: store.createRoutine(definition) };
  } finally {
    store.close();
  }
}

export async function listRoutinesForWeb(input: RoutineListRpcInput, options: WebApiOptions) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { routines: store.listRoutines(input) };
  } finally {
    store.close();
  }
}

export async function getRoutineForWeb(input: RoutineGetRpcInput, options: WebApiOptions) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { routine: store.getRoutine(input.id) };
  } finally {
    store.close();
  }
}

export async function createRoutineForWeb(input: RoutineCreateRpcInput, options: WebApiOptions) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { routine: store.createRoutine(toCreateRoutineInput(input)) };
  } finally {
    store.close();
  }
}

export async function updateRoutineForWeb(input: RoutineUpdateRpcInput, options: WebApiOptions) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { routine: store.updateRoutine(toUpdateRoutineInput(input)) };
  } finally {
    store.close();
  }
}

export async function setRoutineStatusForWeb(
  input: RoutineSetStatusRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { routine: store.updateRoutine({ id: input.id, status: input.status }) };
  } finally {
    store.close();
  }
}

export async function deleteRoutineForWeb(input: RoutineDeleteRpcInput, options: WebApiOptions) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return { deleted: store.deleteRoutine(input.id) };
  } finally {
    store.close();
  }
}

function toCreateRoutineInput(input: RoutineCreateRpcInput): CreateRoutineInput {
  return {
    name: input.name,
    description: input.description,
    prompt: input.prompt,
    inputSchema: input.inputSchema as JsonObject,
    ...(input.id === undefined ? {} : { id: input.id }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.defaultInput === undefined
      ? {}
      : { defaultInput: input.defaultInput as JsonObject | null }),
    ...(input.outputSchema === undefined
      ? {}
      : { outputSchema: input.outputSchema as JsonObject | null }),
    ...(input.outputMode === undefined ? {} : { outputMode: input.outputMode }),
    ...(input.toolProfile === undefined ? {} : { toolProfile: input.toolProfile }),
    ...(input.requiredSkills === undefined ? {} : { requiredSkills: input.requiredSkills }),
    ...(input.preRunSteps === undefined
      ? {}
      : { preRunSteps: input.preRunSteps as RoutinePreRunStep[] }),
    ...(input.publicationPolicy === undefined
      ? {}
      : { publicationPolicy: input.publicationPolicy as RoutinePublicationPolicy }),
  };
}

function toUpdateRoutineInput(input: RoutineUpdateRpcInput): UpdateRoutineInput {
  return {
    id: input.id,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
    ...(input.inputSchema === undefined ? {} : { inputSchema: input.inputSchema as JsonObject }),
    ...(input.defaultInput === undefined
      ? {}
      : { defaultInput: input.defaultInput as JsonObject | null }),
    ...(input.outputSchema === undefined
      ? {}
      : { outputSchema: input.outputSchema as JsonObject | null }),
    ...(input.outputMode === undefined ? {} : { outputMode: input.outputMode }),
    ...(input.toolProfile === undefined ? {} : { toolProfile: input.toolProfile }),
    ...(input.requiredSkills === undefined ? {} : { requiredSkills: input.requiredSkills }),
    ...(input.preRunSteps === undefined
      ? {}
      : { preRunSteps: input.preRunSteps as RoutinePreRunStep[] }),
    ...(input.publicationPolicy === undefined
      ? {}
      : { publicationPolicy: input.publicationPolicy as RoutinePublicationPolicy }),
  };
}

export async function listRoutineRunsForWeb(
  input: RoutineRunsListRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return {
      runs: store.listRoutineRuns({
        ...(input.routineId === undefined ? {} : { routineId: input.routineId }),
        limit: input.limit,
      }),
    };
  } finally {
    store.close();
  }
}

export async function listRoutineArtifactsForWeb(
  input: RoutineArtifactsListRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineStore.open({ repoRoot: repoRoot(options) });
  try {
    return {
      artifacts: store.listRoutineArtifacts({
        ...(input.routineId === undefined ? {} : { routineId: input.routineId }),
        ...(input.routineRunId === undefined ? {} : { routineRunId: input.routineRunId }),
        limit: input.limit,
      }),
    };
  } finally {
    store.close();
  }
}

export async function runRoutineForWeb(
  input: RoutineRunRpcInput,
  options: WebApiOptions,
): Promise<JobExecutionResult> {
  const jobInput: JsonObject = {
    routineId: input.id,
    input: input.input,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
  };
  return runJob({
    jobName: "routine.run",
    input: jobInput,
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    registry: createDefaultJobRegistry(
      options.createModelAdapter === undefined
        ? {}
        : { createModelAdapter: options.createModelAdapter },
    ),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export async function listRoutineTriggersForWeb(
  input: RoutineTriggerListRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineTriggerStore.open({ repoRoot: repoRoot(options) });
  try {
    return { triggers: store.listByRoutine(input.routineId) };
  } finally {
    store.close();
  }
}

export async function createRoutineTriggerForWeb(
  input: RoutineTriggerCreateRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineTriggerStore.open({ repoRoot: repoRoot(options) });
  try {
    const createInput: CreateRoutineTriggerInput = {
      routineId: input.routineId,
      trigger: input.trigger,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.input === undefined ? {} : { input: input.input }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    return { trigger: store.create(createInput) };
  } finally {
    store.close();
  }
}

export async function updateRoutineTriggerForWeb(
  input: RoutineTriggerUpdateRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineTriggerStore.open({ repoRoot: repoRoot(options) });
  try {
    const updateInput: UpdateRoutineTriggerInput = {
      id: input.id,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.input === undefined ? {} : { input: input.input }),
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    return { trigger: store.update(updateInput) };
  } finally {
    store.close();
  }
}

export async function deleteRoutineTriggerForWeb(
  input: RoutineTriggerDeleteRpcInput,
  options: WebApiOptions,
) {
  const store = await RoutineTriggerStore.open({ repoRoot: repoRoot(options) });
  try {
    return { deleted: store.delete(input.id) };
  } finally {
    store.close();
  }
}

export async function runRoutineTriggerNowFromWeb(
  input: RoutineTriggerRunNowRpcInput,
  options: WebApiOptions,
) {
  return runTriggerNow({
    triggerId: input.id,
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    registry: createDefaultJobRegistry(
      options.createModelAdapter === undefined
        ? {}
        : { createModelAdapter: options.createModelAdapter },
    ),
  });
}
