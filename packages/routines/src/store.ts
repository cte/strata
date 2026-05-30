import { randomUUID } from "node:crypto";
import { getStrataPaths, type JsonObject, type JsonValue, SessionStore } from "@strata/core";
import type {
  CreateRoutineArtifactInput,
  CreateRoutineInput,
  CreateRoutineRunInput,
  RoutineArtifactListOptions,
  RoutineArtifactRecord,
  RoutineArtifactSourceRef,
  RoutineArtifactValidationStatus,
  RoutineDefinition,
  RoutineListOptions,
  RoutineOutputMode,
  RoutinePreRunStep,
  RoutinePublicationPolicy,
  RoutineRunListOptions,
  RoutineRunnableOptions,
  RoutineRunRecord,
  RoutineRunStatus,
  RoutineStatus,
  RoutineTaskStatus,
  RoutineToolProfile,
  UpdateRoutineInput,
  UpdateRoutineRunInput,
} from "./types.js";

const ROUTINE_STATUSES = new Set<RoutineStatus>(["enabled", "disabled", "archived"]);
const OUTPUT_MODES = new Set<RoutineOutputMode>(["required", "optional", "none"]);
const TOOL_PROFILES = new Set<RoutineToolProfile>([
  "read-only",
  "maintenance",
  "learning",
  "dangerous",
]);
const RUN_STATUSES = new Set<RoutineRunStatus>(["running", "completed", "failed", "cancelled"]);
const TASK_STATUSES = new Set<RoutineTaskStatus>(["succeeded", "needs_review", "failed", "no_op"]);
const VALIDATION_STATUSES = new Set<RoutineArtifactValidationStatus>(["valid", "invalid"]);
const PROPOSAL_KINDS = new Set(["wiki", "schema", "skill", "memory"]);

interface RoutineRow {
  id: string;
  name: string;
  description: string;
  status: string;
  prompt: string;
  inputSchemaJson: string;
  defaultInputJson: string | null;
  outputSchemaJson: string | null;
  outputMode: string;
  toolProfile: string;
  requiredSkillsJson: string;
  preRunStepsJson: string;
  publicationPolicyJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface RoutineRunRow {
  id: string;
  routineId: string;
  routineVersion: number;
  inputJson: string;
  status: string;
  taskStatus: string | null;
  jobSessionId: string | null;
  agentSessionId: string | null;
  childSessionIdsJson: string;
  outputArtifactIdsJson: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

interface RoutineArtifactRow {
  id: string;
  routineRunId: string;
  routineId: string;
  schemaName: string;
  schemaVersion: string;
  payloadJson: string;
  validationStatus: string;
  taskStatus: string;
  dedupeKey: string | null;
  sourceRefsJson: string;
  sessionId: string;
  createdAt: string;
}

export interface RoutineStoreOptions {
  repoRoot?: string;
}

export class RoutineNotRunnableError extends Error {
  constructor(
    readonly routineId: string,
    readonly status: RoutineStatus,
  ) {
    super(`Routine ${routineId} is not runnable because it is ${status}.`);
    this.name = "RoutineNotRunnableError";
  }
}

export class RoutineStore {
  private constructor(private readonly store: SessionStore) {}

  static async open(options: RoutineStoreOptions = {}): Promise<RoutineStore> {
    const root = getStrataPaths(options.repoRoot).repoRoot;
    return new RoutineStore(await SessionStore.open(root));
  }

  close(): void {
    this.store.close();
  }

  get repoRoot(): string {
    return this.store.paths.repoRoot;
  }

  listRoutines(options: RoutineListOptions = {}): RoutineDefinition[] {
    const limit = boundedLimit(options.limit);
    const status = options.status ?? "all";
    const rows =
      status === "all"
        ? this.store.db
            .query<RoutineRow, [number]>(`${ROUTINE_SELECT} order by updated_at desc limit ?`)
            .all(limit)
        : this.store.db
            .query<RoutineRow, [string, number]>(
              `${ROUTINE_SELECT} where status = ? order by updated_at desc limit ?`,
            )
            .all(status, limit);
    return rows.map(rowToRoutine);
  }

  getRoutine(id: string): RoutineDefinition | null {
    const row = this.store.db.query<RoutineRow, [string]>(`${ROUTINE_SELECT} where id = ?`).get(id);
    return row === null ? null : rowToRoutine(row);
  }

  getRunnableRoutine(id: string, options: RoutineRunnableOptions = {}): RoutineDefinition | null {
    const routine = this.getRoutine(id);
    if (routine === null) {
      return null;
    }
    if (routine.status === "archived" && options.includeArchived !== true) {
      throw new RoutineNotRunnableError(routine.id, routine.status);
    }
    if (routine.status === "disabled" && options.includeDisabled !== true) {
      throw new RoutineNotRunnableError(routine.id, routine.status);
    }
    return routine;
  }

  createRoutine(input: CreateRoutineInput): RoutineDefinition {
    const now = (input.now ?? new Date()).toISOString();
    const routine = normalizeRoutineInput(
      {
        id: input.id ?? `routine_${randomUUID()}`,
        name: input.name,
        description: input.description,
        status: input.status ?? "enabled",
        prompt: input.prompt,
        inputSchema: input.inputSchema,
        defaultInput: input.defaultInput ?? null,
        outputSchema: input.outputSchema ?? null,
        outputMode: input.outputMode ?? (input.outputSchema == null ? "none" : "required"),
        toolProfile: input.toolProfile ?? "maintenance",
        requiredSkills: input.requiredSkills ?? [],
        preRunSteps: input.preRunSteps ?? [],
        publicationPolicy: input.publicationPolicy ?? { mode: "artifact_only" },
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      "create routine",
    );
    this.store.db
      .query(
        `insert into routines (
          id, name, description, status, prompt, input_schema_json, default_input_json,
          output_schema_json, output_mode, tool_profile, required_skills_json,
          pre_run_steps_json, publication_policy_json, version, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        routine.id,
        routine.name,
        routine.description,
        routine.status,
        routine.prompt,
        stringifyJson(routine.inputSchema),
        stringifyOptionalJson(routine.defaultInput),
        stringifyOptionalJson(routine.outputSchema),
        routine.outputMode,
        routine.toolProfile,
        stringifyJson(routine.requiredSkills),
        stringifyJson(routine.preRunSteps),
        stringifyJson(routine.publicationPolicy),
        routine.version,
        routine.createdAt,
        routine.updatedAt,
      );
    return routine;
  }

  updateRoutine(input: UpdateRoutineInput): RoutineDefinition {
    const existing = this.getRoutine(input.id);
    if (existing === null) {
      throw new Error(`Routine not found: ${input.id}`);
    }
    const now = (input.now ?? new Date()).toISOString();
    const next = normalizeRoutineInput(
      {
        ...existing,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.inputSchema === undefined ? {} : { inputSchema: input.inputSchema }),
        ...(input.defaultInput === undefined ? {} : { defaultInput: input.defaultInput }),
        ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
        ...(input.outputMode === undefined ? {} : { outputMode: input.outputMode }),
        ...(input.toolProfile === undefined ? {} : { toolProfile: input.toolProfile }),
        ...(input.requiredSkills === undefined ? {} : { requiredSkills: input.requiredSkills }),
        ...(input.preRunSteps === undefined ? {} : { preRunSteps: input.preRunSteps }),
        ...(input.publicationPolicy === undefined
          ? {}
          : { publicationPolicy: input.publicationPolicy }),
        version: existing.version + 1,
        updatedAt: now,
      },
      "update routine",
    );
    this.store.db
      .query(
        `update routines set
          name = ?,
          description = ?,
          status = ?,
          prompt = ?,
          input_schema_json = ?,
          default_input_json = ?,
          output_schema_json = ?,
          output_mode = ?,
          tool_profile = ?,
          required_skills_json = ?,
          pre_run_steps_json = ?,
          publication_policy_json = ?,
          version = ?,
          updated_at = ?
        where id = ?`,
      )
      .run(
        next.name,
        next.description,
        next.status,
        next.prompt,
        stringifyJson(next.inputSchema),
        stringifyOptionalJson(next.defaultInput),
        stringifyOptionalJson(next.outputSchema),
        next.outputMode,
        next.toolProfile,
        stringifyJson(next.requiredSkills),
        stringifyJson(next.preRunSteps),
        stringifyJson(next.publicationPolicy),
        next.version,
        next.updatedAt,
        next.id,
      );
    return next;
  }

  deleteRoutine(id: string): boolean {
    const result = this.store.db.query("delete from routines where id = ?").run(id);
    return Number(result.changes) > 0;
  }

  createRoutineRun(input: CreateRoutineRunInput): RoutineRunRecord {
    const startedAt = (input.now ?? new Date()).toISOString();
    const run = normalizeRoutineRunInput({
      id: input.id ?? `routine_run_${randomUUID()}`,
      routineId: input.routineId,
      routineVersion: input.routineVersion,
      input: input.input,
      status: input.status ?? "running",
      taskStatus: input.taskStatus ?? null,
      jobSessionId: input.jobSessionId ?? null,
      agentSessionId: input.agentSessionId ?? null,
      childSessionIds: input.childSessionIds ?? [],
      outputArtifactIds: input.outputArtifactIds ?? [],
      error: input.error ?? null,
      startedAt,
      finishedAt: null,
    });
    this.store.db
      .query(
        `insert into routine_runs (
          id, routine_id, routine_version, input_json, status, task_status, job_session_id,
          agent_session_id, child_session_ids_json, output_artifact_ids_json, error,
          started_at, finished_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.routineId,
        run.routineVersion,
        stringifyJson(run.input),
        run.status,
        run.taskStatus,
        run.jobSessionId,
        run.agentSessionId,
        stringifyJson(run.childSessionIds),
        stringifyJson(run.outputArtifactIds),
        run.error,
        run.startedAt,
        run.finishedAt,
      );
    return run;
  }

  updateRoutineRun(input: UpdateRoutineRunInput): RoutineRunRecord {
    const existing = this.getRoutineRun(input.id);
    if (existing === null) {
      throw new Error(`Routine run not found: ${input.id}`);
    }
    const finishedAt =
      input.finishedAt === undefined
        ? existing.finishedAt
        : (input.finishedAt ?? (input.now ?? new Date()).toISOString());
    const next = normalizeRoutineRunInput({
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.taskStatus === undefined ? {} : { taskStatus: input.taskStatus }),
      ...(input.jobSessionId === undefined ? {} : { jobSessionId: input.jobSessionId }),
      ...(input.agentSessionId === undefined ? {} : { agentSessionId: input.agentSessionId }),
      ...(input.childSessionIds === undefined ? {} : { childSessionIds: input.childSessionIds }),
      ...(input.outputArtifactIds === undefined
        ? {}
        : { outputArtifactIds: input.outputArtifactIds }),
      ...(input.error === undefined ? {} : { error: input.error }),
      finishedAt,
    });
    this.store.db
      .query(
        `update routine_runs set
          status = ?,
          task_status = ?,
          job_session_id = ?,
          agent_session_id = ?,
          child_session_ids_json = ?,
          output_artifact_ids_json = ?,
          error = ?,
          finished_at = ?
        where id = ?`,
      )
      .run(
        next.status,
        next.taskStatus,
        next.jobSessionId,
        next.agentSessionId,
        stringifyJson(next.childSessionIds),
        stringifyJson(next.outputArtifactIds),
        next.error,
        next.finishedAt,
        next.id,
      );
    return next;
  }

  getRoutineRun(id: string): RoutineRunRecord | null {
    const row = this.store.db
      .query<RoutineRunRow, [string]>(`${ROUTINE_RUN_SELECT} where id = ?`)
      .get(id);
    return row === null ? null : rowToRoutineRun(row);
  }

  listRoutineRuns(options: RoutineRunListOptions = {}): RoutineRunRecord[] {
    const limit = boundedLimit(options.limit);
    const rows =
      options.routineId === undefined
        ? this.store.db
            .query<RoutineRunRow, [number]>(
              `${ROUTINE_RUN_SELECT} order by started_at desc limit ?`,
            )
            .all(limit)
        : this.store.db
            .query<RoutineRunRow, [string, number]>(
              `${ROUTINE_RUN_SELECT} where routine_id = ? order by started_at desc limit ?`,
            )
            .all(options.routineId, limit);
    return rows.map(rowToRoutineRun);
  }

  createRoutineArtifact(input: CreateRoutineArtifactInput): RoutineArtifactRecord {
    const createdAt = (input.now ?? new Date()).toISOString();
    const artifact = normalizeRoutineArtifactInput({
      id: input.id ?? `routine_artifact_${randomUUID()}`,
      routineRunId: input.routineRunId,
      routineId: input.routineId,
      schemaName: input.schemaName,
      schemaVersion: input.schemaVersion,
      payload: input.payload,
      validationStatus: input.validationStatus ?? "valid",
      taskStatus: input.taskStatus,
      dedupeKey: input.dedupeKey ?? null,
      sourceRefs: input.sourceRefs ?? [],
      sessionId: input.sessionId,
      createdAt,
    });
    this.store.db
      .query(
        `insert into routine_artifacts (
          id, routine_run_id, routine_id, schema_name, schema_version, payload_json,
          validation_status, task_status, dedupe_key, source_refs_json, session_id, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.routineRunId,
        artifact.routineId,
        artifact.schemaName,
        artifact.schemaVersion,
        stringifyJson(artifact.payload),
        artifact.validationStatus,
        artifact.taskStatus,
        artifact.dedupeKey,
        stringifyJson(artifact.sourceRefs),
        artifact.sessionId,
        artifact.createdAt,
      );
    const run = this.getRoutineRun(artifact.routineRunId);
    if (run !== null && !run.outputArtifactIds.includes(artifact.id)) {
      this.updateRoutineRun({
        id: run.id,
        outputArtifactIds: [...run.outputArtifactIds, artifact.id],
      });
    }
    return artifact;
  }

  getRoutineArtifact(id: string): RoutineArtifactRecord | null {
    const row = this.store.db
      .query<RoutineArtifactRow, [string]>(`${ROUTINE_ARTIFACT_SELECT} where id = ?`)
      .get(id);
    return row === null ? null : rowToRoutineArtifact(row);
  }

  listRoutineArtifacts(options: RoutineArtifactListOptions = {}): RoutineArtifactRecord[] {
    const limit = boundedLimit(options.limit);
    if (options.routineRunId !== undefined) {
      return this.store.db
        .query<RoutineArtifactRow, [string, number]>(
          `${ROUTINE_ARTIFACT_SELECT} where routine_run_id = ? order by created_at desc limit ?`,
        )
        .all(options.routineRunId, limit)
        .map(rowToRoutineArtifact);
    }
    if (options.routineId !== undefined) {
      return this.store.db
        .query<RoutineArtifactRow, [string, number]>(
          `${ROUTINE_ARTIFACT_SELECT} where routine_id = ? order by created_at desc limit ?`,
        )
        .all(options.routineId, limit)
        .map(rowToRoutineArtifact);
    }
    return this.store.db
      .query<RoutineArtifactRow, [number]>(
        `${ROUTINE_ARTIFACT_SELECT} order by created_at desc limit ?`,
      )
      .all(limit)
      .map(rowToRoutineArtifact);
  }
}

const ROUTINE_SELECT = `select
  id,
  name,
  description,
  status,
  prompt,
  input_schema_json as inputSchemaJson,
  default_input_json as defaultInputJson,
  output_schema_json as outputSchemaJson,
  output_mode as outputMode,
  tool_profile as toolProfile,
  required_skills_json as requiredSkillsJson,
  pre_run_steps_json as preRunStepsJson,
  publication_policy_json as publicationPolicyJson,
  version,
  created_at as createdAt,
  updated_at as updatedAt
from routines`;

const ROUTINE_RUN_SELECT = `select
  id,
  routine_id as routineId,
  routine_version as routineVersion,
  input_json as inputJson,
  status,
  task_status as taskStatus,
  job_session_id as jobSessionId,
  agent_session_id as agentSessionId,
  child_session_ids_json as childSessionIdsJson,
  output_artifact_ids_json as outputArtifactIdsJson,
  error,
  started_at as startedAt,
  finished_at as finishedAt
from routine_runs`;

const ROUTINE_ARTIFACT_SELECT = `select
  id,
  routine_run_id as routineRunId,
  routine_id as routineId,
  schema_name as schemaName,
  schema_version as schemaVersion,
  payload_json as payloadJson,
  validation_status as validationStatus,
  task_status as taskStatus,
  dedupe_key as dedupeKey,
  source_refs_json as sourceRefsJson,
  session_id as sessionId,
  created_at as createdAt
from routine_artifacts`;

function normalizeRoutineInput(input: RoutineDefinition, context: string): RoutineDefinition {
  const id = nonEmptyString(input.id, "id");
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error(`Invalid routine id for ${context}: ${id}`);
  }
  const name = nonEmptyString(input.name, "name");
  const description = nonEmptyString(input.description, "description");
  const prompt = nonEmptyString(input.prompt, "prompt");
  const status = enumValue(input.status, ROUTINE_STATUSES, "status");
  const outputMode = enumValue(input.outputMode, OUTPUT_MODES, "outputMode");
  const toolProfile = enumValue(input.toolProfile, TOOL_PROFILES, "toolProfile");
  const inputSchema = jsonObject(input.inputSchema, "inputSchema");
  const defaultInput = nullableJsonObject(input.defaultInput, "defaultInput");
  const outputSchema = nullableJsonObject(input.outputSchema, "outputSchema");
  if (outputMode !== "none" && outputSchema === null) {
    throw new Error(`Routine ${id} requires outputSchema when outputMode is ${outputMode}.`);
  }
  const requiredSkills = stringArray(input.requiredSkills, "requiredSkills");
  const preRunSteps = routinePreRunSteps(input.preRunSteps);
  const publicationPolicy = routinePublicationPolicy(input.publicationPolicy);
  const version = positiveInteger(input.version, "version");
  return {
    id,
    name,
    description,
    status,
    prompt,
    inputSchema,
    defaultInput,
    outputSchema,
    outputMode,
    toolProfile,
    requiredSkills,
    preRunSteps,
    publicationPolicy,
    version,
    createdAt: nonEmptyString(input.createdAt, "createdAt"),
    updatedAt: nonEmptyString(input.updatedAt, "updatedAt"),
  };
}

function normalizeRoutineRunInput(input: RoutineRunRecord): RoutineRunRecord {
  return {
    id: nonEmptyString(input.id, "id"),
    routineId: nonEmptyString(input.routineId, "routineId"),
    routineVersion: positiveInteger(input.routineVersion, "routineVersion"),
    input: jsonObject(input.input, "input"),
    status: enumValue(input.status, RUN_STATUSES, "status"),
    taskStatus: nullableEnumValue(input.taskStatus, TASK_STATUSES, "taskStatus"),
    jobSessionId: nullableString(input.jobSessionId, "jobSessionId"),
    agentSessionId: nullableString(input.agentSessionId, "agentSessionId"),
    childSessionIds: stringArray(input.childSessionIds, "childSessionIds"),
    outputArtifactIds: stringArray(input.outputArtifactIds, "outputArtifactIds"),
    error: nullableString(input.error, "error"),
    startedAt: nonEmptyString(input.startedAt, "startedAt"),
    finishedAt: nullableString(input.finishedAt, "finishedAt"),
  };
}

function normalizeRoutineArtifactInput(input: RoutineArtifactRecord): RoutineArtifactRecord {
  return {
    id: nonEmptyString(input.id, "id"),
    routineRunId: nonEmptyString(input.routineRunId, "routineRunId"),
    routineId: nonEmptyString(input.routineId, "routineId"),
    schemaName: nonEmptyString(input.schemaName, "schemaName"),
    schemaVersion: nonEmptyString(input.schemaVersion, "schemaVersion"),
    payload: jsonObject(input.payload, "payload"),
    validationStatus: enumValue(input.validationStatus, VALIDATION_STATUSES, "validationStatus"),
    taskStatus: enumValue(input.taskStatus, TASK_STATUSES, "taskStatus"),
    dedupeKey: nullableString(input.dedupeKey, "dedupeKey"),
    sourceRefs: sourceRefs(input.sourceRefs),
    sessionId: nonEmptyString(input.sessionId, "sessionId"),
    createdAt: nonEmptyString(input.createdAt, "createdAt"),
  };
}

function rowToRoutine(row: RoutineRow): RoutineDefinition {
  return normalizeRoutineInput(
    {
      id: row.id,
      name: row.name,
      description: row.description,
      status: enumValue(row.status, ROUTINE_STATUSES, "status"),
      prompt: row.prompt,
      inputSchema: parseJsonObject(row.inputSchemaJson, "inputSchema"),
      defaultInput:
        row.defaultInputJson === null
          ? null
          : parseJsonObject(row.defaultInputJson, "defaultInput"),
      outputSchema:
        row.outputSchemaJson === null
          ? null
          : parseJsonObject(row.outputSchemaJson, "outputSchema"),
      outputMode: enumValue(row.outputMode, OUTPUT_MODES, "outputMode"),
      toolProfile: enumValue(row.toolProfile, TOOL_PROFILES, "toolProfile"),
      requiredSkills: stringArray(
        parseJson(row.requiredSkillsJson, "requiredSkills"),
        "requiredSkills",
      ),
      preRunSteps: routinePreRunSteps(parseJson(row.preRunStepsJson, "preRunSteps")),
      publicationPolicy: routinePublicationPolicy(
        parseJsonObject(row.publicationPolicyJson, "publicationPolicy"),
      ),
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    "read routine",
  );
}

function rowToRoutineRun(row: RoutineRunRow): RoutineRunRecord {
  return normalizeRoutineRunInput({
    id: row.id,
    routineId: row.routineId,
    routineVersion: row.routineVersion,
    input: parseJsonObject(row.inputJson, "input"),
    status: enumValue(row.status, RUN_STATUSES, "status"),
    taskStatus: nullableEnumValue(row.taskStatus, TASK_STATUSES, "taskStatus"),
    jobSessionId: row.jobSessionId,
    agentSessionId: row.agentSessionId,
    childSessionIds: stringArray(
      parseJson(row.childSessionIdsJson, "childSessionIds"),
      "childSessionIds",
    ),
    outputArtifactIds: stringArray(
      parseJson(row.outputArtifactIdsJson, "outputArtifactIds"),
      "outputArtifactIds",
    ),
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  });
}

function rowToRoutineArtifact(row: RoutineArtifactRow): RoutineArtifactRecord {
  return normalizeRoutineArtifactInput({
    id: row.id,
    routineRunId: row.routineRunId,
    routineId: row.routineId,
    schemaName: row.schemaName,
    schemaVersion: row.schemaVersion,
    payload: parseJsonObject(row.payloadJson, "payload"),
    validationStatus: enumValue(row.validationStatus, VALIDATION_STATUSES, "validationStatus"),
    taskStatus: enumValue(row.taskStatus, TASK_STATUSES, "taskStatus"),
    dedupeKey: row.dedupeKey,
    sourceRefs: sourceRefs(parseJson(row.sourceRefsJson, "sourceRefs")),
    sessionId: row.sessionId,
    createdAt: row.createdAt,
  });
}

function routinePreRunSteps(value: unknown): RoutinePreRunStep[] {
  if (!Array.isArray(value)) {
    throw new Error("preRunSteps must be an array.");
  }
  return value.map((step, index) => {
    const object = jsonObject(step, `preRunSteps[${index}]`);
    return {
      jobName: nonEmptyString(object.jobName, `preRunSteps[${index}].jobName`),
      input: jsonObject(object.input ?? {}, `preRunSteps[${index}].input`),
    };
  });
}

function routinePublicationPolicy(value: unknown): RoutinePublicationPolicy {
  const object = jsonObject(value, "publicationPolicy");
  const mode = nonEmptyString(object.mode, "publicationPolicy.mode");
  if (mode === "artifact_only") {
    return { mode };
  }
  if (mode === "proposal") {
    const proposalKind = nonEmptyString(object.proposalKind, "publicationPolicy.proposalKind");
    if (!PROPOSAL_KINDS.has(proposalKind)) {
      throw new Error(`Invalid publicationPolicy.proposalKind: ${proposalKind}`);
    }
    return { mode, proposalKind: proposalKind as "wiki" | "schema" | "skill" | "memory" };
  }
  if (mode === "auto_publish") {
    const target = nonEmptyString(object.target, "publicationPolicy.target");
    const policy: RoutinePublicationPolicy = { mode, target };
    if (object.minConfidence !== undefined) {
      if (typeof object.minConfidence !== "number" || !Number.isFinite(object.minConfidence)) {
        throw new Error("publicationPolicy.minConfidence must be a finite number.");
      }
      policy.minConfidence = object.minConfidence;
    }
    return policy;
  }
  throw new Error(`Invalid publicationPolicy.mode: ${mode}`);
}

function sourceRefs(value: unknown): RoutineArtifactSourceRef[] {
  if (!Array.isArray(value)) {
    throw new Error("sourceRefs must be an array.");
  }
  return value.map((entry, index) => jsonObject(entry, `sourceRefs[${index}]`));
}

function parseJson(value: string, field: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid JSON in ${field}: ${message}`);
  }
}

function parseJsonObject(value: string, field: string): JsonObject {
  return jsonObject(parseJson(value, field), field);
}

function jsonObject(value: unknown, field: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object.`);
  }
  return value as JsonObject;
}

function nullableJsonObject(value: unknown, field: string): JsonObject | null {
  if (value === null) {
    return null;
  }
  return jsonObject(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  return value.map((entry, index) => nonEmptyString(entry, `${field}[${index}]`));
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  return nonEmptyString(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, field: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new Error(`${field} has invalid value: ${String(value)}`);
  }
  return value as T;
}

function nullableEnumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
  field: string,
): T | null {
  if (value === null) {
    return null;
  }
  return enumValue(value, allowed, field);
}

function boundedLimit(value: number | undefined): number {
  return Math.max(1, Math.min(value ?? 100, 500));
}

function stringifyJson(value: JsonValue): string {
  return JSON.stringify(value);
}

function stringifyOptionalJson(value: JsonObject | null): string | null {
  return value === null ? null : stringifyJson(value);
}
