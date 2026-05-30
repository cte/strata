import {
  type CreateModelAdapterOptions,
  createModelAdapter as defaultCreateModelAdapter,
  type ModelAdapter,
  type ModelProviderName,
  runAgentLoop,
  type ThinkingLevel,
} from "@strata/agent";
import { type JsonObject, type JsonValue, SessionStore } from "@strata/core";
import { createDefaultToolRegistry, type ToolProfile } from "@strata/tools";
import { createJobRunTool } from "./jobRunTool.js";
import { createRoutineOutputSubmitTool } from "./outputTool.js";
import { mergeRoutineInput, validateRoutineInput } from "./schemas.js";
import { RoutineStore } from "./store.js";
import type {
  RoutineArtifactRecord,
  RoutineDefinition,
  RoutinePreRunStep,
  RoutineRunRecord,
} from "./types.js";

export interface RoutinePreRunJobResult extends JsonObject {
  sessionId: string;
  jobName: string;
  status: "completed" | "failed";
  summary: string;
  errorMessage: string | null;
  output: JsonValue | null;
}

export interface RoutinePreRunJobInput {
  jobName: string;
  input: JsonObject;
  title?: string;
}

export interface RunRoutineOptions {
  routineId: string;
  input?: JsonObject;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  jobSessionId?: string;
  provider?: ModelProviderName;
  model?: string;
  reasoningEffort?: ThinkingLevel;
  createModelAdapter?: (options: CreateModelAdapterOptions) => Promise<ModelAdapter>;
  runPreRunJob?: (input: RoutinePreRunJobInput) => Promise<RoutinePreRunJobResult>;
}

export interface RunRoutineResult extends JsonObject {
  routineId: string;
  routineRunId: string;
  routineVersion: number;
  status: "ok" | "needs_attention";
  taskStatus: "succeeded" | "needs_review" | "failed" | "no_op";
  summary: string;
  jobSessionId: string | null;
  agentSessionId: string | null;
  childSessionIds: string[];
  outputArtifactIds: string[];
  agentStatus: string | null;
  stoppedReason: string | null;
  iterations: number;
  toolCalls: number;
  finalAnswerPreview: string;
}

export async function runRoutine(options: RunRoutineOptions): Promise<RunRoutineResult> {
  const routineStore = await RoutineStore.open(
    options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot },
  );
  const eventStore = await SessionStore.open(routineStore.repoRoot);
  let run: RoutineRunRecord | null = null;
  try {
    const routine = routineStore.getRunnableRoutine(options.routineId);
    if (routine === null) {
      throw new Error(`Routine not found: ${options.routineId}`);
    }
    const mergedInput = mergeRoutineInput(routine.defaultInput, options.input);
    const validation = validateRoutineInput(mergedInput, routine.inputSchema);
    if (!validation.ok) {
      throw new Error(`Routine input failed validation: ${validation.errors.join("; ")}`);
    }

    run = routineStore.createRoutineRun({
      routineId: routine.id,
      routineVersion: routine.version,
      input: mergedInput,
      jobSessionId: options.jobSessionId ?? null,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    await appendRoutineEvent(eventStore, options.jobSessionId, "routine.started", {
      routineId: routine.id,
      routineRunId: run.id,
      routineVersion: routine.version,
      input: mergedInput,
    });

    const childResults = await runPreRunSteps(routine, options, routineStore, eventStore, run);
    const childSessionIds = childResults.map((result) => result.sessionId);
    run = routineStore.updateRoutineRun({ id: run.id, childSessionIds });

    const model = await (options.createModelAdapter ?? defaultCreateModelAdapter)({
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.model === undefined ? {} : { model: options.model }),
      repoRoot: routineStore.repoRoot,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    const prompt = renderRoutinePrompt(routine, mergedInput, childResults);
    const tools = createDefaultToolRegistry({ profile: routine.toolProfile as ToolProfile });
    if (routine.outputMode !== "none") {
      tools.register(
        createRoutineOutputSubmitTool({
          routine,
          run,
          store: routineStore,
          ...(options.now === undefined ? {} : { now: options.now }),
        }),
      );
    }
    // Let the agent trigger registered jobs (job.run is write-mode, so read-only
    // routines won't see it). Only available when a job runner was injected.
    if (options.runPreRunJob !== undefined) {
      tools.register(createJobRunTool({ runJob: options.runPreRunJob }));
    }
    const agentResult = await runAgentLoop({
      question: prompt,
      model,
      repoRoot: routineStore.repoRoot,
      sessionTitle: `Routine: ${routine.name}`,
      tools,
      ...(options.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: options.reasoningEffort }),
    });

    const outputArtifacts = routineStore.listRoutineArtifacts({ routineRunId: run.id });
    const validOutputArtifacts = outputArtifacts.filter(
      (artifact) => artifact.validationStatus === "valid",
    );
    const taskStatus = taskStatusFromAgent(routine, agentResult.status, validOutputArtifacts);
    const status = agentResult.status === "failed" ? "failed" : "completed";
    run = routineStore.updateRoutineRun({
      id: run.id,
      status,
      taskStatus,
      agentSessionId: agentResult.sessionId,
      outputArtifactIds: outputArtifacts.map((artifact) => artifact.id),
      finishedAt: (options.now ?? new Date()).toISOString(),
      ...(agentResult.status === "failed" ? { error: agentResult.stoppedReason } : {}),
    });
    await appendRoutineEvent(eventStore, options.jobSessionId, "routine.completed", {
      routineId: routine.id,
      routineRunId: run.id,
      taskStatus,
      agentSessionId: agentResult.sessionId,
      childSessionIds,
      outputArtifactIds: run.outputArtifactIds,
    });

    return {
      routineId: routine.id,
      routineRunId: run.id,
      routineVersion: routine.version,
      status: taskStatus === "succeeded" || taskStatus === "no_op" ? "ok" : "needs_attention",
      taskStatus,
      summary: routineSummary(routine, taskStatus),
      jobSessionId: run.jobSessionId,
      agentSessionId: agentResult.sessionId,
      childSessionIds,
      outputArtifactIds: run.outputArtifactIds,
      agentStatus: agentResult.status,
      stoppedReason: agentResult.stoppedReason,
      iterations: agentResult.iterations,
      toolCalls: agentResult.toolCalls,
      finalAnswerPreview: truncate(agentResult.finalAnswer, 2000),
    };
  } catch (cause) {
    if (run !== null) {
      const message = cause instanceof Error ? cause.message : String(cause);
      routineStore.updateRoutineRun({
        id: run.id,
        status: "failed",
        taskStatus: "failed",
        error: message,
        finishedAt: (options.now ?? new Date()).toISOString(),
      });
      await appendRoutineEvent(eventStore, options.jobSessionId, "routine.failed", {
        routineId: run.routineId,
        routineRunId: run.id,
        message,
      });
    }
    throw cause;
  } finally {
    eventStore.close();
    routineStore.close();
  }
}

export function renderRoutinePrompt(
  routine: RoutineDefinition,
  input: JsonObject,
  preRunResults: RoutinePreRunJobResult[] = [],
): string {
  const lines = [
    `Routine: ${routine.name}`,
    `Routine id: ${routine.id}`,
    `Routine version: ${routine.version}`,
    "",
    "Structured input JSON:",
    JSON.stringify(input, null, 2),
    "",
    `Tool profile: ${routine.toolProfile}`,
    `Publication policy: ${JSON.stringify(routine.publicationPolicy)}`,
  ];
  if (preRunResults.length > 0) {
    lines.push("", "Pre-run job results (prepared context — use this as your evidence):");
    for (const result of preRunResults) {
      lines.push(`- ${result.jobName} [${result.status}]: ${result.summary}`);
      if (result.output !== null) {
        lines.push("  output JSON:", JSON.stringify(result.output, null, 2));
      }
    }
  }
  if (routine.requiredSkills.length > 0) {
    lines.push("", "Required skills:", ...routine.requiredSkills.map((skill) => `- ${skill}`));
  }
  if (routine.outputMode === "none") {
    lines.push(
      "",
      "Structured output: this routine does not require a structured output artifact.",
    );
  } else {
    lines.push(
      "",
      `Structured output mode: ${routine.outputMode}`,
      "Output schema JSON:",
      JSON.stringify(routine.outputSchema, null, 2),
      routine.outputMode === "required"
        ? "Before your final answer, call routine.output.submit exactly once with the final structured output object."
        : "If there is useful structured output, call routine.output.submit with the final structured output object before your final answer.",
    );
  }
  lines.push("", "Routine instructions:", routine.prompt);
  return lines.join("\n");
}

async function runPreRunSteps(
  routine: RoutineDefinition,
  options: RunRoutineOptions,
  routineStore: RoutineStore,
  eventStore: SessionStore,
  run: RoutineRunRecord,
): Promise<RoutinePreRunJobResult[]> {
  const results: RoutinePreRunJobResult[] = [];
  for (const [index, step] of routine.preRunSteps.entries()) {
    await appendRoutineEvent(eventStore, options.jobSessionId, "routine.pre_run.started", {
      routineId: routine.id,
      routineRunId: run.id,
      index,
      jobName: step.jobName,
      input: step.input,
    });
    if (options.runPreRunJob === undefined) {
      throw new Error(`Routine ${routine.id} has pre-run steps but no job runner was provided.`);
    }
    const result = await options.runPreRunJob({
      jobName: step.jobName,
      input: step.input,
      title: preRunStepTitle(routine, step),
    });
    results.push(result);
    routineStore.updateRoutineRun({
      id: run.id,
      childSessionIds: results.map((childResult) => childResult.sessionId),
    });
    await appendRoutineEvent(eventStore, options.jobSessionId, "routine.pre_run.completed", {
      routineId: routine.id,
      routineRunId: run.id,
      index,
      jobName: step.jobName,
      sessionId: result.sessionId,
      status: result.status,
      summary: result.summary,
      errorMessage: result.errorMessage,
    });
    if (result.status === "failed") {
      throw new Error(
        `Pre-run job ${step.jobName} failed: ${result.errorMessage ?? result.summary}`,
      );
    }
  }
  return results;
}

function taskStatusFromAgent(
  routine: RoutineDefinition,
  agentStatus: "completed" | "failed" | "interrupted",
  validOutputArtifacts: RoutineArtifactRecord[],
): "succeeded" | "needs_review" | "failed" | "no_op" {
  if (agentStatus === "failed" || agentStatus === "interrupted") {
    return "failed";
  }
  if (routine.outputMode === "none") {
    return "no_op";
  }
  if (validOutputArtifacts.length > 0) {
    return "succeeded";
  }
  if (routine.outputMode === "required") {
    return "needs_review";
  }
  return "no_op";
}

function routineSummary(
  routine: RoutineDefinition,
  taskStatus: "succeeded" | "needs_review" | "failed" | "no_op",
): string {
  if (taskStatus === "failed") {
    return `Routine failed: ${routine.name}`;
  }
  if (taskStatus === "needs_review") {
    return `Routine completed but needs review: ${routine.name}`;
  }
  return `Routine completed: ${routine.name}`;
}

function preRunStepTitle(routine: RoutineDefinition, step: RoutinePreRunStep): string {
  return `Routine ${routine.name}: ${step.jobName}`;
}

async function appendRoutineEvent(
  store: SessionStore,
  sessionId: string | undefined,
  type: string,
  payload: JsonObject,
): Promise<void> {
  if (sessionId === undefined) {
    return;
  }
  await store.appendEvent(sessionId, type, payload);
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
