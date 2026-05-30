import type { JsonObject } from "@strata/core";

export type RoutineStatus = "enabled" | "disabled" | "archived";
export type RoutineOutputMode = "required" | "optional" | "none";
export type RoutineToolProfile = "read-only" | "maintenance" | "learning" | "dangerous";
export type RoutineRunStatus = "running" | "completed" | "failed" | "cancelled";
export type RoutineTaskStatus = "succeeded" | "needs_review" | "failed" | "no_op";
export type RoutineArtifactValidationStatus = "valid" | "invalid";

export interface RoutinePreRunStep extends JsonObject {
  jobName: string;
  input: JsonObject;
}

export type RoutinePublicationPolicy =
  | (JsonObject & { mode: "artifact_only" })
  | (JsonObject & {
      mode: "proposal";
      proposalKind: "wiki" | "schema" | "skill" | "memory";
    })
  | (JsonObject & {
      mode: "auto_publish";
      target: string;
      minConfidence?: number;
    });

export interface RoutineDefinition extends JsonObject {
  id: string;
  name: string;
  description: string;
  status: RoutineStatus;
  prompt: string;
  inputSchema: JsonObject;
  defaultInput: JsonObject | null;
  outputSchema: JsonObject | null;
  outputMode: RoutineOutputMode;
  toolProfile: RoutineToolProfile;
  requiredSkills: string[];
  preRunSteps: RoutinePreRunStep[];
  publicationPolicy: RoutinePublicationPolicy;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoutineInput {
  id?: string;
  name: string;
  description: string;
  status?: RoutineStatus;
  prompt: string;
  inputSchema: JsonObject;
  defaultInput?: JsonObject | null;
  outputSchema?: JsonObject | null;
  outputMode?: RoutineOutputMode;
  toolProfile?: RoutineToolProfile;
  requiredSkills?: string[];
  preRunSteps?: RoutinePreRunStep[];
  publicationPolicy?: RoutinePublicationPolicy;
  now?: Date;
}

export interface UpdateRoutineInput {
  id: string;
  name?: string;
  description?: string;
  status?: RoutineStatus;
  prompt?: string;
  inputSchema?: JsonObject;
  defaultInput?: JsonObject | null;
  outputSchema?: JsonObject | null;
  outputMode?: RoutineOutputMode;
  toolProfile?: RoutineToolProfile;
  requiredSkills?: string[];
  preRunSteps?: RoutinePreRunStep[];
  publicationPolicy?: RoutinePublicationPolicy;
  now?: Date;
}

export interface RoutineListOptions {
  status?: RoutineStatus | "all";
  limit?: number;
}

export interface RoutineRunnableOptions {
  includeDisabled?: boolean;
  includeArchived?: boolean;
}

export interface RoutineRunRecord extends JsonObject {
  id: string;
  routineId: string;
  routineVersion: number;
  input: JsonObject;
  status: RoutineRunStatus;
  taskStatus: RoutineTaskStatus | null;
  jobSessionId: string | null;
  agentSessionId: string | null;
  childSessionIds: string[];
  outputArtifactIds: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface CreateRoutineRunInput {
  id?: string;
  routineId: string;
  routineVersion: number;
  input: JsonObject;
  status?: RoutineRunStatus;
  taskStatus?: RoutineTaskStatus | null;
  jobSessionId?: string | null;
  agentSessionId?: string | null;
  childSessionIds?: string[];
  outputArtifactIds?: string[];
  error?: string | null;
  now?: Date;
}

export interface UpdateRoutineRunInput {
  id: string;
  status?: RoutineRunStatus;
  taskStatus?: RoutineTaskStatus | null;
  jobSessionId?: string | null;
  agentSessionId?: string | null;
  childSessionIds?: string[];
  outputArtifactIds?: string[];
  error?: string | null;
  finishedAt?: string | null;
  now?: Date;
}

export type RoutineArtifactSourceRef = JsonObject;

export interface RoutineArtifactRecord extends JsonObject {
  id: string;
  routineRunId: string;
  routineId: string;
  schemaName: string;
  schemaVersion: string;
  payload: JsonObject;
  validationStatus: RoutineArtifactValidationStatus;
  taskStatus: RoutineTaskStatus;
  dedupeKey: string | null;
  sourceRefs: RoutineArtifactSourceRef[];
  sessionId: string;
  createdAt: string;
}

export interface CreateRoutineArtifactInput {
  id?: string;
  routineRunId: string;
  routineId: string;
  schemaName: string;
  schemaVersion: string;
  payload: JsonObject;
  validationStatus?: RoutineArtifactValidationStatus;
  taskStatus: RoutineTaskStatus;
  dedupeKey?: string | null;
  sourceRefs?: RoutineArtifactSourceRef[];
  sessionId: string;
  now?: Date;
}

export interface RoutineRunListOptions {
  routineId?: string;
  limit?: number;
}

export interface RoutineArtifactListOptions {
  routineId?: string;
  routineRunId?: string;
  limit?: number;
}
