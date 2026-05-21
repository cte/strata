import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getStrataPaths, type JsonObject, type JsonValue } from "@strata/core";
import { nowIso, safeJsonStringify } from "@strata/core/events";

export type ChatRunStatus = "running" | "completed" | "failed" | "interrupted";

export interface ChatRunRecord {
  runId: string;
  status: ChatRunStatus;
  startedAt: string;
  updatedAt: string;
  endedAt: string | null;
  cancelled: boolean;
  sessionId?: string;
  continueSessionId?: string;
  stoppedReason?: string;
  errorMessage?: string;
  lastEventId: number;
}

export interface ChatRunEventRecord {
  id: number;
  runId: string;
  ts: string;
  type: string;
  payload: JsonValue;
}

export interface CreateChatRunRecordInput {
  runId: string;
  continueSessionId?: string;
}

export interface FinishChatRunInput {
  status: Exclude<ChatRunStatus, "running">;
  stoppedReason?: string;
  errorMessage?: string;
  cancelled?: boolean;
}

export class ChatRunStore {
  private readonly db: Database;

  constructor(repoRoot?: string) {
    const paths = getStrataPaths(repoRoot);
    mkdirSync(path.dirname(paths.stateDbPath), { recursive: true });
    this.db = new Database(paths.stateDbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  createRun(input: CreateChatRunRecordInput): ChatRunRecord {
    const ts = nowIso();
    this.db
      .query(
        `
          insert into web_chat_runs (
            run_id, status, started_at, updated_at, ended_at, cancelled,
            session_id, continue_session_id, stopped_reason, error_message
          ) values (?, 'running', ?, ?, null, 0, null, ?, null, null)
        `,
      )
      .run(input.runId, ts, ts, input.continueSessionId ?? null);
    return this.requiredRun(input.runId);
  }

  bindSession(runId: string, sessionId: string): void {
    this.db
      .query("update web_chat_runs set session_id = ?, updated_at = ? where run_id = ?")
      .run(sessionId, nowIso(), runId);
  }

  markCancelRequested(runId: string): boolean {
    const result = this.db
      .query(
        `
          update web_chat_runs
          set cancelled = 1, updated_at = ?
          where run_id = ? and status = 'running'
        `,
      )
      .run(nowIso(), runId);
    return Number(result.changes) > 0;
  }

  finishRun(runId: string, input: FinishChatRunInput): void {
    const ts = nowIso();
    this.db
      .query(
        `
          update web_chat_runs
          set status = ?, updated_at = ?, ended_at = ?, cancelled = ?,
              stopped_reason = ?, error_message = ?
          where run_id = ?
        `,
      )
      .run(
        input.status,
        ts,
        ts,
        input.cancelled === true ? 1 : 0,
        input.stoppedReason ?? null,
        input.errorMessage ?? null,
        runId,
      );
  }

  appendEvent(runId: string, type: string, payload: JsonValue): ChatRunEventRecord {
    const ts = nowIso();
    const [row] = this.db
      .query(
        `
          insert into web_chat_run_events (run_id, ts, type, payload_json)
          values (?, ?, ?, ?)
          returning id
        `,
      )
      .all(runId, ts, type, safeJsonStringify(payload)) as Array<{ id: number }>;
    this.db.query("update web_chat_runs set updated_at = ? where run_id = ?").run(ts, runId);
    return {
      id: row?.id ?? 0,
      runId,
      ts,
      type,
      payload,
    };
  }

  getRun(runId: string): ChatRunRecord | undefined {
    const row = this.db
      .query(
        `
          select r.*, coalesce(max(e.id), 0) as last_event_id
          from web_chat_runs r
          left join web_chat_run_events e on e.run_id = r.run_id
          where r.run_id = ?
          group by r.run_id
        `,
      )
      .get(runId) as ChatRunRow | null;
    return row === null ? undefined : rowToRun(row);
  }

  listRuns(status?: ChatRunStatus): ChatRunRecord[] {
    const rows =
      status === undefined
        ? (this.db
            .query(
              `
                select r.*, coalesce(max(e.id), 0) as last_event_id
                from web_chat_runs r
                left join web_chat_run_events e on e.run_id = r.run_id
                group by r.run_id
                order by r.updated_at desc
              `,
            )
            .all() as ChatRunRow[])
        : (this.db
            .query(
              `
                select r.*, coalesce(max(e.id), 0) as last_event_id
                from web_chat_runs r
                left join web_chat_run_events e on e.run_id = r.run_id
                where r.status = ?
                group by r.run_id
                order by r.updated_at desc
              `,
            )
            .all(status) as ChatRunRow[]);
    return rows.map(rowToRun);
  }

  getRunningRunForSession(sessionId: string): ChatRunRecord | undefined {
    const row = this.db
      .query(
        `
          select r.*, coalesce(max(e.id), 0) as last_event_id
          from web_chat_runs r
          left join web_chat_run_events e on e.run_id = r.run_id
          where r.status = 'running' and r.session_id = ?
          group by r.run_id
          order by r.updated_at desc
          limit 1
        `,
      )
      .get(sessionId) as ChatRunRow | null;
    return row === null ? undefined : rowToRun(row);
  }

  listEvents(runId: string, afterEventId = 0): ChatRunEventRecord[] {
    const rows = this.db
      .query(
        `
          select id, run_id, ts, type, payload_json
          from web_chat_run_events
          where run_id = ? and id > ?
          order by id asc
        `,
      )
      .all(runId, afterEventId) as ChatRunEventRow[];
    return rows.map(rowToEvent);
  }

  recoverAbandonedRuns(): void {
    const abandoned = this.listRuns("running");
    for (const run of abandoned) {
      const event = {
        type: "agent.failed",
        message: "Server restarted while this run was active.",
      };
      this.appendEvent(run.runId, event.type, event);
      this.finishRun(run.runId, {
        status: "failed",
        stoppedReason: "server_restarted",
        errorMessage: event.message,
        cancelled: run.cancelled,
      });
    }
  }

  private requiredRun(runId: string): ChatRunRecord {
    const run = this.getRun(runId);
    if (run === undefined) {
      throw new Error(`Chat run was not persisted: ${runId}`);
    }
    return run;
  }

  private ensureSchema(): void {
    this.db.run(`
      create table if not exists web_chat_runs (
        run_id text primary key,
        status text not null,
        started_at text not null,
        updated_at text not null,
        ended_at text,
        cancelled integer not null default 0,
        session_id text,
        continue_session_id text,
        stopped_reason text,
        error_message text
      )
    `);
    this.db.run(`
      create index if not exists idx_web_chat_runs_status_updated
      on web_chat_runs(status, updated_at desc)
    `);
    this.db.run(`
      create index if not exists idx_web_chat_runs_session
      on web_chat_runs(session_id)
    `);
    this.db.run(`
      create table if not exists web_chat_run_events (
        id integer primary key autoincrement,
        run_id text not null references web_chat_runs(run_id) on delete cascade,
        ts text not null,
        type text not null,
        payload_json text not null
      )
    `);
    this.db.run(`
      create index if not exists idx_web_chat_run_events_run_id
      on web_chat_run_events(run_id, id)
    `);
  }
}

interface ChatRunRow {
  run_id: string;
  status: ChatRunStatus;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  cancelled: number;
  session_id: string | null;
  continue_session_id: string | null;
  stopped_reason: string | null;
  error_message: string | null;
  last_event_id: number;
}

interface ChatRunEventRow {
  id: number;
  run_id: string;
  ts: string;
  type: string;
  payload_json: string;
}

function rowToRun(row: ChatRunRow): ChatRunRecord {
  return {
    runId: row.run_id,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    cancelled: row.cancelled === 1,
    lastEventId: row.last_event_id,
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.continue_session_id === null ? {} : { continueSessionId: row.continue_session_id }),
    ...(row.stopped_reason === null ? {} : { stoppedReason: row.stopped_reason }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
  };
}

function rowToEvent(row: ChatRunEventRow): ChatRunEventRecord {
  return {
    id: row.id,
    runId: row.run_id,
    ts: row.ts,
    type: row.type,
    payload: JSON.parse(row.payload_json) as JsonObject,
  };
}
