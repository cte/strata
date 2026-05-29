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

export interface IntervalScheduleTrigger extends JsonObject {
  type: "interval";
  seconds: number;
}

export interface CronScheduleTrigger extends JsonObject {
  type: "cron";
  expression: string;
}

export type JobScheduleTrigger = IntervalScheduleTrigger | CronScheduleTrigger;

export interface JobScheduleRecord extends JsonObject {
  id: string;
  name: string;
  jobName: string;
  input: JsonObject;
  trigger: JobScheduleTrigger;
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

export interface CreateJobScheduleInput {
  name: string;
  jobName: string;
  input?: JsonObject;
  trigger: JobScheduleTrigger;
  enabled?: boolean;
  now?: Date;
}

export interface UpdateJobScheduleInput {
  id: string;
  name?: string;
  jobName?: string;
  input?: JsonObject;
  trigger?: JobScheduleTrigger;
  enabled?: boolean;
  now?: Date;
}

export interface RunDueSchedulesResult extends JsonObject {
  checkedAt: string;
  claimed: number;
  results: JobScheduleRunResult[];
}

export interface JobScheduleRunResult extends JsonObject {
  scheduleId: string;
  scheduleName: string;
  jobName: string;
  sessionId: string;
  status: JobExecutionStatus;
  summary: string;
  errorMessage: string | null;
}
