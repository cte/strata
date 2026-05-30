import type { JsonObject, JsonValue } from "@strata/core";

export type JobMode = "read" | "write" | "dangerous";
export type JobConcurrencyPolicy = "skip" | "replace" | "parallel";
export type JobRunStatus = "ok" | "needs_attention";
export type JobExecutionStatus = "completed" | "failed";

export interface JobRunContext {
  repoRoot: string;
  env: Record<string, string | undefined>;
  now: Date;
  sessionId: string;
  runJob(input: JobRunChildInput): Promise<JobExecutionResult>;
}

export interface JobRunOutput extends JsonObject {
  status: JobRunStatus;
  summary: string;
  metrics: JsonObject;
  details?: JsonValue;
}

export interface JobDefinition<TInput extends JsonObject = JsonObject> {
  name: string;
  description: string;
  mode: JobMode;
  inputSchema: JsonObject;
  defaultConcurrency: JobConcurrencyPolicy;
  run(input: TInput, context: JobRunContext): Promise<JobRunOutput>;
}

export interface JobMetadata extends JsonObject {
  name: string;
  description: string;
  mode: JobMode;
  defaultConcurrency: JobConcurrencyPolicy;
  inputSchema: JsonObject;
}

export interface JobExecutionResult extends JsonObject {
  sessionId: string;
  jobName: string;
  status: JobExecutionStatus;
  summary: string;
  output: JobRunOutput | null;
  errorMessage: string | null;
}

export interface JobRunChildInput {
  jobName: string;
  input?: JsonObject;
  title?: string;
}

export interface IntervalCadence extends JsonObject {
  type: "interval";
  seconds: number;
}

export interface CronCadence extends JsonObject {
  type: "cron";
  expression: string;
}

/** A Routine trigger's recurring cadence. Stored verbatim as `trigger_json`. */
export type RoutineTriggerCadence = IntervalCadence | CronCadence;

/** A Routine's recurring trigger: a cadence + input that fires `routine.run`. */
export interface RoutineTriggerRecord extends JsonObject {
  id: string;
  routineId: string;
  name: string | null;
  input: JsonObject;
  trigger: RoutineTriggerCadence;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSessionId: string | null;
  lastStatus: JobExecutionStatus | null;
  lastError: string | null;
  lockedAt: string | null;
}

export interface CreateRoutineTriggerInput {
  routineId: string;
  name?: string | null;
  input?: JsonObject;
  trigger: RoutineTriggerCadence;
  enabled?: boolean;
  now?: Date;
}

export interface UpdateRoutineTriggerInput {
  id: string;
  name?: string | null;
  input?: JsonObject;
  trigger?: RoutineTriggerCadence;
  enabled?: boolean;
  now?: Date;
}

export interface RunDueTriggersResult extends JsonObject {
  checkedAt: string;
  claimed: number;
  results: RoutineTriggerRunResult[];
}

export interface RoutineTriggerRunResult extends JsonObject {
  triggerId: string;
  triggerName: string | null;
  routineId: string;
  sessionId: string;
  status: JobExecutionStatus;
  summary: string;
  errorMessage: string | null;
}
