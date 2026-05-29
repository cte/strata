import { randomUUID } from "node:crypto";
import { getStrataPaths, type JsonObject, type JsonValue, SessionStore } from "@strata/core";
import type {
  CreateJobScheduleInput,
  JobExecutionResult,
  JobExecutionStatus,
  JobScheduleRecord,
  JobScheduleTrigger,
  UpdateJobScheduleInput,
} from "./types.js";

interface ScheduleRow {
  id: string;
  name: string;
  jobName: string;
  inputJson: string;
  triggerJson: string;
  enabled: number;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSessionId: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lockedAt: string | null;
}

export interface ScheduleStoreOptions {
  repoRoot?: string;
}

export class ScheduleStore {
  private constructor(private readonly store: SessionStore) {
    ensureScheduleSchema(store.db);
  }

  static async open(options: ScheduleStoreOptions = {}): Promise<ScheduleStore> {
    const root = getStrataPaths(options.repoRoot).repoRoot;
    return new ScheduleStore(await SessionStore.open(root));
  }

  close(): void {
    this.store.close();
  }

  get repoRoot(): string {
    return this.store.paths.repoRoot;
  }

  list(): JobScheduleRecord[] {
    const rows = this.store.db
      .query<ScheduleRow, []>(
        `select
          id,
          name,
          job_name as jobName,
          input_json as inputJson,
          trigger_json as triggerJson,
          enabled,
          created_at as createdAt,
          updated_at as updatedAt,
          next_run_at as nextRunAt,
          last_run_at as lastRunAt,
          last_session_id as lastSessionId,
          last_status as lastStatus,
          last_error as lastError,
          locked_at as lockedAt
        from job_schedules
        order by created_at desc`,
      )
      .all();
    return rows.map(rowToSchedule);
  }

  get(id: string): JobScheduleRecord | null {
    const row = this.store.db
      .query<ScheduleRow, [string]>(
        `select
          id,
          name,
          job_name as jobName,
          input_json as inputJson,
          trigger_json as triggerJson,
          enabled,
          created_at as createdAt,
          updated_at as updatedAt,
          next_run_at as nextRunAt,
          last_run_at as lastRunAt,
          last_session_id as lastSessionId,
          last_status as lastStatus,
          last_error as lastError,
          locked_at as lockedAt
        from job_schedules
        where id = ?`,
      )
      .get(id);
    return row === null ? null : rowToSchedule(row);
  }

  create(input: CreateJobScheduleInput): JobScheduleRecord {
    const now = input.now ?? new Date();
    const ts = now.toISOString();
    const enabled = input.enabled ?? true;
    const trigger = normalizeTrigger(input.trigger);
    const schedule: JobScheduleRecord = {
      id: `sched_${randomUUID()}`,
      name: input.name.trim(),
      jobName: input.jobName.trim(),
      input: input.input ?? {},
      trigger,
      enabled,
      createdAt: ts,
      updatedAt: ts,
      nextRunAt: enabled ? nextRunAt(trigger, now) : null,
      lastRunAt: null,
      lastSessionId: null,
      lastStatus: null,
      lastError: null,
      lockedAt: null,
    };
    validateSchedule(schedule);
    this.store.db
      .query(
        `insert into job_schedules (
          id, name, job_name, input_json, trigger_json, enabled, created_at, updated_at,
          next_run_at, last_run_at, last_session_id, last_status, last_error, locked_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        schedule.id,
        schedule.name,
        schedule.jobName,
        JSON.stringify(schedule.input),
        JSON.stringify(schedule.trigger),
        schedule.enabled ? 1 : 0,
        schedule.createdAt,
        schedule.updatedAt,
        schedule.nextRunAt,
        schedule.lastRunAt,
        schedule.lastSessionId,
        schedule.lastStatus,
        schedule.lastError,
        schedule.lockedAt,
      );
    return schedule;
  }

  update(input: UpdateJobScheduleInput): JobScheduleRecord {
    const existing = this.get(input.id);
    if (existing === null) {
      throw new Error(`Schedule not found: ${input.id}`);
    }
    const now = input.now ?? new Date();
    const enabled = input.enabled ?? existing.enabled;
    const trigger =
      input.trigger === undefined ? existing.trigger : normalizeTrigger(input.trigger);
    const next: JobScheduleRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.jobName === undefined ? {} : { jobName: input.jobName.trim() }),
      ...(input.input === undefined ? {} : { input: input.input }),
      trigger,
      enabled,
      updatedAt: now.toISOString(),
      nextRunAt: enabled ? nextRunAt(trigger, now) : null,
      lockedAt: null,
    };
    validateSchedule(next);
    this.store.db
      .query(
        `update job_schedules set
          name = ?,
          job_name = ?,
          input_json = ?,
          trigger_json = ?,
          enabled = ?,
          updated_at = ?,
          next_run_at = ?,
          locked_at = null
        where id = ?`,
      )
      .run(
        next.name,
        next.jobName,
        JSON.stringify(next.input),
        JSON.stringify(next.trigger),
        next.enabled ? 1 : 0,
        next.updatedAt,
        next.nextRunAt,
        next.id,
      );
    return next;
  }

  setEnabled(id: string, enabled: boolean, now = new Date()): JobScheduleRecord {
    return this.update({ id, enabled, now });
  }

  delete(id: string): boolean {
    const result = this.store.db.query("delete from job_schedules where id = ?").run(id);
    return Number(result.changes) > 0;
  }

  claimDue(
    options: { now?: Date; limit?: number; staleAfterMs?: number } = {},
  ): JobScheduleRecord[] {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const staleAt = new Date(now.getTime() - (options.staleAfterMs ?? 30 * 60_000)).toISOString();
    const candidates = this.store.db
      .query<ScheduleRow, [string, string, number]>(
        `select
          id,
          name,
          job_name as jobName,
          input_json as inputJson,
          trigger_json as triggerJson,
          enabled,
          created_at as createdAt,
          updated_at as updatedAt,
          next_run_at as nextRunAt,
          last_run_at as lastRunAt,
          last_session_id as lastSessionId,
          last_status as lastStatus,
          last_error as lastError,
          locked_at as lockedAt
        from job_schedules
        where enabled = 1
          and next_run_at is not null
          and next_run_at <= ?
          and (locked_at is null or locked_at <= ?)
        order by next_run_at asc
        limit ?`,
      )
      .all(now.toISOString(), staleAt, limit);

    const claimed: JobScheduleRecord[] = [];
    for (const row of candidates) {
      const result = this.store.db
        .query(
          `update job_schedules
          set locked_at = ?
          where id = ?
            and (locked_at is null or locked_at <= ?)`,
        )
        .run(now.toISOString(), row.id, staleAt);
      if (Number(result.changes) > 0) {
        claimed.push(rowToSchedule({ ...row, lockedAt: now.toISOString() }));
      }
    }
    return claimed;
  }

  markRun(scheduleId: string, result: JobExecutionResult, now = new Date()): JobScheduleRecord {
    const existing = this.get(scheduleId);
    if (existing === null) {
      throw new Error(`Schedule not found: ${scheduleId}`);
    }
    const nextRun = existing.enabled ? nextRunAt(existing.trigger, now) : null;
    this.store.db
      .query(
        `update job_schedules set
          last_run_at = ?,
          last_session_id = ?,
          last_status = ?,
          last_error = ?,
          next_run_at = ?,
          locked_at = null,
          updated_at = ?
        where id = ?`,
      )
      .run(
        now.toISOString(),
        result.sessionId,
        result.status,
        result.errorMessage,
        nextRun,
        now.toISOString(),
        scheduleId,
      );
    const updated = this.get(scheduleId);
    if (updated === null) {
      throw new Error(`Schedule not found after update: ${scheduleId}`);
    }
    return updated;
  }

  unlock(scheduleId: string): void {
    this.store.db.query("update job_schedules set locked_at = null where id = ?").run(scheduleId);
  }
}

export function nextRunAt(trigger: JobScheduleTrigger, now = new Date()): string {
  if (trigger.type === "interval") {
    return new Date(now.getTime() + trigger.seconds * 1000).toISOString();
  }
  return nextCronRunAt(trigger.expression, now).toISOString();
}

export function normalizeTrigger(trigger: JobScheduleTrigger): JobScheduleTrigger {
  if (trigger.type === "interval") {
    if (!Number.isFinite(trigger.seconds) || trigger.seconds < 1) {
      throw new Error("Interval schedules require seconds >= 1.");
    }
    return { type: "interval", seconds: Math.floor(trigger.seconds) };
  }
  if (trigger.type === "cron") {
    parseCronExpression(trigger.expression);
    return { type: "cron", expression: trigger.expression.trim() };
  }
  throw new Error("Schedule trigger type must be interval or cron.");
}

function nextCronRunAt(expression: string, now: Date): Date {
  const cron = parseCronExpression(expression);
  const cursor = new Date(now.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let checked = 0; checked < 527_040; checked += 1) {
    if (matchesCron(cron, cursor)) {
      return new Date(cursor);
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error(`Could not find next run for cron expression: ${expression}`);
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error("Cron expressions must use five fields: minute hour day month weekday.");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    throw new Error("Cron expressions must use five fields: minute hour day month weekday.");
  }
  return {
    minute: parseCronField(minute, 0, 59, false),
    hour: parseCronField(hour, 0, 23, false),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31, false),
    month: parseCronField(month, 1, 12, false),
    dayOfWeek: parseCronField(dayOfWeek, 0, 7, true),
  };
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  sundayAlias: boolean,
): Set<number> {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "*") {
      addRange(values, min, max, 1, sundayAlias);
      continue;
    }
    const stepMatch = /^\*\/(\d+)$/.exec(trimmed);
    if (stepMatch) {
      addRange(values, min, max, Number.parseInt(stepMatch[1] ?? "", 10), sundayAlias);
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(trimmed);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1] ?? "", 10);
      const end = Number.parseInt(rangeMatch[2] ?? "", 10);
      const step = Number.parseInt(rangeMatch[3] ?? "1", 10);
      if (start < min || end > max) {
        throw new Error(`Cron range ${trimmed} is outside ${min}-${max}.`);
      }
      addRange(values, start, end, step, sundayAlias);
      continue;
    }
    const value = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(value) || String(value) !== trimmed) {
      throw new Error(`Invalid cron field: ${field}`);
    }
    addCronValue(values, value, min, max, sundayAlias);
  }
  if (values.size === 0) {
    throw new Error(`Invalid cron field: ${field}`);
  }
  return values;
}

function addRange(
  values: Set<number>,
  start: number,
  end: number,
  step: number,
  sundayAlias: boolean,
): void {
  if (!Number.isFinite(step) || step < 1 || start > end) {
    throw new Error("Invalid cron range.");
  }
  for (let value = start; value <= end; value += step) {
    addCronValue(values, value, start === 0 ? 0 : start, end, sundayAlias);
  }
}

function addCronValue(
  values: Set<number>,
  value: number,
  min: number,
  max: number,
  sundayAlias: boolean,
): void {
  const normalized = sundayAlias && value === 7 ? 0 : value;
  const effectiveMax = sundayAlias ? Math.max(max, 7) : max;
  if (value < min || value > effectiveMax || normalized > max) {
    throw new Error(`Cron value ${value} is outside ${min}-${max}.`);
  }
  values.add(normalized);
}

function matchesCron(cron: ParsedCron, date: Date): boolean {
  return (
    cron.minute.has(date.getUTCMinutes()) &&
    cron.hour.has(date.getUTCHours()) &&
    cron.dayOfMonth.has(date.getUTCDate()) &&
    cron.month.has(date.getUTCMonth() + 1) &&
    cron.dayOfWeek.has(date.getUTCDay())
  );
}

function validateSchedule(schedule: JobScheduleRecord): void {
  if (schedule.name.trim() === "") {
    throw new Error("Schedule name is required.");
  }
  if (schedule.jobName.trim() === "") {
    throw new Error("Schedule jobName is required.");
  }
  normalizeTrigger(schedule.trigger);
}

function rowToSchedule(row: ScheduleRow): JobScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    jobName: row.jobName,
    input: parseJsonObject(row.inputJson),
    trigger: normalizeTrigger(parseJsonObject(row.triggerJson) as JobScheduleTrigger),
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastSessionId: row.lastSessionId,
    lastStatus: parseExecutionStatus(row.lastStatus),
    lastError: row.lastError,
    lockedAt: row.lockedAt,
  };
}

function parseExecutionStatus(value: string | null): JobExecutionStatus | null {
  if (value === "completed" || value === "failed") {
    return value;
  }
  return null;
}

function parseJsonObject(text: string): JsonObject {
  const parsed = JSON.parse(text) as JsonValue;
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as JsonObject;
  }
  return {};
}

function ensureScheduleSchema(db: SessionStore["db"]): void {
  db.run(`
    create table if not exists job_schedules (
      id text primary key not null,
      name text not null,
      job_name text not null,
      input_json text not null,
      trigger_json text not null,
      enabled integer not null,
      created_at text not null,
      updated_at text not null,
      next_run_at text,
      last_run_at text,
      last_session_id text,
      last_status text,
      last_error text,
      locked_at text
    )
  `);
  db.run(
    "create index if not exists idx_job_schedules_due on job_schedules (enabled, next_run_at)",
  );
  db.run("create index if not exists idx_job_schedules_job on job_schedules (job_name)");
}
