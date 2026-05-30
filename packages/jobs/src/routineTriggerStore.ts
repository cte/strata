import { randomUUID } from "node:crypto";
import { getStrataPaths, type JsonObject, type JsonValue, SessionStore } from "@strata/core";
import type {
  CreateRoutineTriggerInput,
  JobExecutionResult,
  JobExecutionStatus,
  RoutineTriggerCadence,
  RoutineTriggerRecord,
  UpdateRoutineTriggerInput,
} from "./types.js";

interface TriggerRow {
  id: string;
  routineId: string;
  name: string | null;
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

const SELECT_COLUMNS = `
  id,
  routine_id as routineId,
  name,
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
  locked_at as lockedAt`;

export interface RoutineTriggerStoreOptions {
  repoRoot?: string;
}

export class RoutineTriggerStore {
  private constructor(private readonly store: SessionStore) {
    ensureTriggerSchema(store.db);
  }

  static async open(options: RoutineTriggerStoreOptions = {}): Promise<RoutineTriggerStore> {
    const root = getStrataPaths(options.repoRoot).repoRoot;
    return new RoutineTriggerStore(await SessionStore.open(root));
  }

  close(): void {
    this.store.close();
  }

  get repoRoot(): string {
    return this.store.paths.repoRoot;
  }

  list(): RoutineTriggerRecord[] {
    const rows = this.store.db
      .query<TriggerRow, []>(
        `select ${SELECT_COLUMNS} from routine_triggers order by created_at desc`,
      )
      .all();
    return rows.map(rowToTrigger);
  }

  listByRoutine(routineId: string): RoutineTriggerRecord[] {
    const rows = this.store.db
      .query<TriggerRow, [string]>(
        `select ${SELECT_COLUMNS} from routine_triggers where routine_id = ? order by created_at desc`,
      )
      .all(routineId);
    return rows.map(rowToTrigger);
  }

  get(id: string): RoutineTriggerRecord | null {
    const row = this.store.db
      .query<TriggerRow, [string]>(`select ${SELECT_COLUMNS} from routine_triggers where id = ?`)
      .get(id);
    return row === null ? null : rowToTrigger(row);
  }

  create(input: CreateRoutineTriggerInput): RoutineTriggerRecord {
    const now = input.now ?? new Date();
    const ts = now.toISOString();
    const enabled = input.enabled ?? true;
    const trigger = normalizeTrigger(input.trigger);
    const record: RoutineTriggerRecord = {
      id: `trig_${randomUUID()}`,
      routineId: input.routineId.trim(),
      name: normalizeName(input.name),
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
    validateTrigger(record);
    this.store.db
      .query(
        `insert into routine_triggers (
          id, routine_id, name, input_json, trigger_json, enabled, created_at, updated_at,
          next_run_at, last_run_at, last_session_id, last_status, last_error, locked_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.routineId,
        record.name,
        JSON.stringify(record.input),
        JSON.stringify(record.trigger),
        record.enabled ? 1 : 0,
        record.createdAt,
        record.updatedAt,
        record.nextRunAt,
        record.lastRunAt,
        record.lastSessionId,
        record.lastStatus,
        record.lastError,
        record.lockedAt,
      );
    return record;
  }

  update(input: UpdateRoutineTriggerInput): RoutineTriggerRecord {
    const existing = this.get(input.id);
    if (existing === null) {
      throw new Error(`Routine trigger not found: ${input.id}`);
    }
    const now = input.now ?? new Date();
    const enabled = input.enabled ?? existing.enabled;
    const trigger =
      input.trigger === undefined ? existing.trigger : normalizeTrigger(input.trigger);
    const next: RoutineTriggerRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: normalizeName(input.name) }),
      ...(input.input === undefined ? {} : { input: input.input }),
      trigger,
      enabled,
      updatedAt: now.toISOString(),
      nextRunAt: enabled ? nextRunAt(trigger, now) : null,
      lockedAt: null,
    };
    validateTrigger(next);
    this.store.db
      .query(
        `update routine_triggers set
          name = ?,
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
        JSON.stringify(next.input),
        JSON.stringify(next.trigger),
        next.enabled ? 1 : 0,
        next.updatedAt,
        next.nextRunAt,
        next.id,
      );
    return next;
  }

  setEnabled(id: string, enabled: boolean, now = new Date()): RoutineTriggerRecord {
    return this.update({ id, enabled, now });
  }

  delete(id: string): boolean {
    const result = this.store.db.query("delete from routine_triggers where id = ?").run(id);
    return Number(result.changes) > 0;
  }

  claimDue(
    options: { now?: Date; limit?: number; staleAfterMs?: number } = {},
  ): RoutineTriggerRecord[] {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const staleAt = new Date(now.getTime() - (options.staleAfterMs ?? 30 * 60_000)).toISOString();
    const candidates = this.store.db
      .query<TriggerRow, [string, string, number]>(
        `select ${SELECT_COLUMNS}
        from routine_triggers
        where enabled = 1
          and next_run_at is not null
          and next_run_at <= ?
          and (locked_at is null or locked_at <= ?)
        order by next_run_at asc
        limit ?`,
      )
      .all(now.toISOString(), staleAt, limit);

    const claimed: RoutineTriggerRecord[] = [];
    for (const row of candidates) {
      const result = this.store.db
        .query(
          `update routine_triggers
          set locked_at = ?
          where id = ?
            and (locked_at is null or locked_at <= ?)`,
        )
        .run(now.toISOString(), row.id, staleAt);
      if (Number(result.changes) > 0) {
        claimed.push(rowToTrigger({ ...row, lockedAt: now.toISOString() }));
      }
    }
    return claimed;
  }

  markRun(triggerId: string, result: JobExecutionResult, now = new Date()): RoutineTriggerRecord {
    const existing = this.get(triggerId);
    if (existing === null) {
      throw new Error(`Routine trigger not found: ${triggerId}`);
    }
    const nextRun = existing.enabled ? nextRunAt(existing.trigger, now) : null;
    this.store.db
      .query(
        `update routine_triggers set
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
        triggerId,
      );
    const updated = this.get(triggerId);
    if (updated === null) {
      throw new Error(`Routine trigger not found after update: ${triggerId}`);
    }
    return updated;
  }

  unlock(triggerId: string): void {
    this.store.db.query("update routine_triggers set locked_at = null where id = ?").run(triggerId);
  }
}

export function nextRunAt(trigger: RoutineTriggerCadence, now = new Date()): string {
  if (trigger.type === "interval") {
    return new Date(now.getTime() + trigger.seconds * 1000).toISOString();
  }
  return nextCronRunAt(trigger.expression, now).toISOString();
}

export function normalizeTrigger(trigger: RoutineTriggerCadence): RoutineTriggerCadence {
  if (trigger.type === "interval") {
    if (!Number.isFinite(trigger.seconds) || trigger.seconds < 1) {
      throw new Error("Interval triggers require seconds >= 1.");
    }
    return { type: "interval", seconds: Math.floor(trigger.seconds) };
  }
  if (trigger.type === "cron") {
    parseCronExpression(trigger.expression);
    return { type: "cron", expression: trigger.expression.trim() };
  }
  throw new Error("Routine trigger type must be interval or cron.");
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

function validateTrigger(trigger: RoutineTriggerRecord): void {
  if (trigger.routineId.trim() === "") {
    throw new Error("Routine trigger routineId is required.");
  }
  normalizeTrigger(trigger.trigger);
}

function normalizeName(name: string | null | undefined): string | null {
  if (name === undefined || name === null) {
    return null;
  }
  const trimmed = name.trim();
  return trimmed === "" ? null : trimmed;
}

function rowToTrigger(row: TriggerRow): RoutineTriggerRecord {
  return {
    id: row.id,
    routineId: row.routineId,
    name: row.name === null || row.name.trim() === "" ? null : row.name,
    input: parseJsonObject(row.inputJson),
    trigger: normalizeTrigger(parseJsonObject(row.triggerJson) as RoutineTriggerCadence),
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

function ensureTriggerSchema(db: SessionStore["db"]): void {
  db.run(`
    create table if not exists routine_triggers (
      id text primary key not null,
      routine_id text not null references routines(id) on delete cascade,
      name text,
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
    "create index if not exists idx_routine_triggers_due on routine_triggers (enabled, next_run_at)",
  );
  db.run(
    "create index if not exists idx_routine_triggers_routine on routine_triggers (routine_id)",
  );
}
