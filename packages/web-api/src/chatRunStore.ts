import type { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  getStrataPaths,
  type JsonObject,
  type JsonValue,
  SessionStore,
  type StrataPaths,
} from "@strata/core";
import { nowIso, safeJsonStringify } from "@strata/core/events";
import { QueueChangeStore, type QueueChangeTarget } from "./queueChangeStore.js";

export type ChatRunStatus = "running" | "completed" | "failed" | "interrupted";
export type ChatQueuedMessageDelivery = "steering" | "follow-up";

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

export interface ChatQueuedMessageRecord {
  id: string;
  sessionId?: string;
  runId?: string;
  message: string;
  attachments: JsonValue;
  delivery: ChatQueuedMessageDelivery;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  createdAt: string;
  position: number;
}

export type ChatQueueTarget = QueueChangeTarget;

export interface AddChatQueuedMessageInput extends ChatQueueTarget {
  id: string;
  message: string;
  attachments?: JsonValue;
  delivery?: ChatQueuedMessageDelivery;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  position?: number;
}

export interface FinishChatRunInput {
  status: Exclude<ChatRunStatus, "running">;
  stoppedReason?: string;
  errorMessage?: string;
  cancelled?: boolean;
}

export interface ChatRunStoreOptions {
  repoRoot?: string;
  store?: SessionStore;
}

export class ChatRunStore {
  private readonly paths: StrataPaths;
  private readonly store: SessionStore;
  private readonly ownsStore: boolean;
  private readonly db: Database;
  private readonly queueChanges: QueueChangeStore;

  constructor(repoRootOrOptions?: string | ChatRunStoreOptions) {
    const options =
      typeof repoRootOrOptions === "string" ? { repoRoot: repoRootOrOptions } : repoRootOrOptions;
    if (options?.store !== undefined) {
      this.store = options.store;
      this.ownsStore = false;
      this.paths = options.store.paths;
    } else {
      this.paths = getStrataPaths(options?.repoRoot);
      mkdirSync(path.dirname(this.paths.stateDbPath), { recursive: true });
      this.store = new SessionStore(this.paths);
      this.ownsStore = true;
    }
    this.db = this.store.db;
    this.queueChanges = new QueueChangeStore({ store: this.store });
  }

  close(): void {
    this.queueChanges.close();
    if (this.ownsStore) {
      this.store.close();
    }
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

  listQueuedMessages(target: ChatQueueTarget): ChatQueuedMessageRecord[] {
    const rows = this.queuedMessageRows(target);
    return rows.map(rowToQueuedMessage);
  }

  addQueuedMessage(input: AddChatQueuedMessageInput): ChatQueuedMessageRecord {
    if (input.sessionId === undefined && input.runId === undefined) {
      throw new Error("Queued message requires a session id or run id.");
    }
    const ts = nowIso();
    const position = input.position ?? this.nextQueuedMessagePosition(input);
    this.db
      .query(
        `
          insert into web_chat_queued_messages (
            id, session_id, run_id, message, attachments_json, delivery,
            provider, model, reasoning_effort, created_at, position
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.id,
        input.sessionId ?? null,
        input.runId ?? null,
        input.message,
        safeJsonStringify(input.attachments ?? []),
        input.delivery ?? "follow-up",
        input.provider ?? null,
        input.model ?? null,
        input.reasoningEffort ?? null,
        ts,
        position,
      );
    this.recordQueueChange(input);
    return this.requiredQueuedMessage(input.id);
  }

  getQueuedMessage(id: string): ChatQueuedMessageRecord | undefined {
    const row = this.db
      .query("select * from web_chat_queued_messages where id = ?")
      .get(id) as ChatQueuedMessageRow | null;
    return row === null ? undefined : rowToQueuedMessage(row);
  }

  removeQueuedMessage(id: string): boolean {
    const existing = this.getQueuedMessage(id);
    const result = this.db.query("delete from web_chat_queued_messages where id = ?").run(id);
    const removed = Number(result.changes) > 0;
    if (removed && existing !== undefined) {
      this.recordQueueChange(existing);
    }
    return removed;
  }

  clearQueuedMessages(target: ChatQueueTarget): number {
    const rows = this.queuedMessageRows(target);
    if (rows.length === 0) {
      return 0;
    }
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    const result = this.db
      .query(`delete from web_chat_queued_messages where id in (${placeholders})`)
      .run(...ids);
    const removed = Number(result.changes);
    if (removed > 0) {
      this.recordQueueChange(target);
    }
    return removed;
  }

  moveQueuedMessage(id: string, beforeId: string | null): ChatQueuedMessageRecord | undefined {
    const moving = this.getQueuedMessage(id);
    if (moving === undefined) {
      return undefined;
    }
    const target = queueTargetFromQueuedMessage(moving);
    const currentRows = this.queuedMessageRows(target).filter((row) => row.id !== id);
    let targetIndex =
      beforeId === null ? currentRows.length : currentRows.findIndex((row) => row.id === beforeId);
    if (targetIndex === -1) {
      targetIndex = currentRows.length;
    }
    const orderedIds = currentRows.map((row) => row.id);
    orderedIds.splice(targetIndex, 0, id);
    const update = this.db.query("update web_chat_queued_messages set position = ? where id = ?");
    for (const [index, queuedId] of orderedIds.entries()) {
      update.run(index + 1, queuedId);
    }
    this.recordQueueChange(target);
    return this.getQueuedMessage(id);
  }

  setQueuedMessageDelivery(
    id: string,
    delivery: ChatQueuedMessageDelivery,
  ): ChatQueuedMessageRecord | undefined {
    const existing = this.getQueuedMessage(id);
    if (existing === undefined) {
      return undefined;
    }
    this.db
      .query("update web_chat_queued_messages set delivery = ? where id = ?")
      .run(delivery, id);
    this.recordQueueChange(queueTargetFromQueuedMessage(existing));
    return this.getQueuedMessage(id);
  }

  migrateQueuedMessagesToSession(runId: string, sessionId: string): number {
    const result = this.db
      .query(
        `
          update web_chat_queued_messages
          set session_id = ?, run_id = null
          where run_id = ? and session_id is null
        `,
      )
      .run(sessionId, runId);
    const migrated = Number(result.changes);
    if (migrated > 0) {
      this.recordQueueChange({ sessionId, runId });
    }
    return migrated;
  }

  peekNextQueuedMessage(sessionId: string): ChatQueuedMessageRecord | undefined {
    const row = this.db
      .query(
        `
          select *
          from web_chat_queued_messages
          where session_id = ?
          order by position asc, created_at asc, id asc
          limit 1
        `,
      )
      .get(sessionId) as ChatQueuedMessageRow | null;
    return row === null ? undefined : rowToQueuedMessage(row);
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

  recoverAbandonedRuns(): ChatRunRecord[] {
    const abandoned = this.listRuns("running");
    const recovered: ChatRunRecord[] = [];
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
      if (run.sessionId !== undefined) {
        this.failAbandonedSession(run.sessionId, event.message);
      }
      const failedRun = this.getRun(run.runId);
      if (failedRun !== undefined) {
        recovered.push(failedRun);
      }
    }
    this.failRestartedSessionsStillMarkedRunning();
    return recovered;
  }

  private recordQueueChange(target: ChatQueueTarget): void {
    if (target.sessionId === undefined && target.runId === undefined) {
      return;
    }
    this.queueChanges.appendQueueChange(target);
  }

  private requiredRun(runId: string): ChatRunRecord {
    const run = this.getRun(runId);
    if (run === undefined) {
      throw new Error(`Chat run was not persisted: ${runId}`);
    }
    return run;
  }

  private requiredQueuedMessage(id: string): ChatQueuedMessageRecord {
    const row = this.db
      .query("select * from web_chat_queued_messages where id = ?")
      .get(id) as ChatQueuedMessageRow | null;
    if (row === null) {
      throw new Error(`Queued chat message was not persisted: ${id}`);
    }
    return rowToQueuedMessage(row);
  }

  private queuedMessageRows(target: ChatQueueTarget): ChatQueuedMessageRow[] {
    if (target.sessionId === undefined && target.runId === undefined) {
      return [];
    }
    if (target.sessionId !== undefined && target.runId !== undefined) {
      return this.db
        .query(
          `
            select *
            from web_chat_queued_messages
            where session_id = ? or run_id = ?
            order by position asc, created_at asc, id asc
          `,
        )
        .all(target.sessionId, target.runId) as ChatQueuedMessageRow[];
    }
    if (target.sessionId !== undefined) {
      return this.db
        .query(
          `
            select *
            from web_chat_queued_messages
            where session_id = ?
            order by position asc, created_at asc, id asc
          `,
        )
        .all(target.sessionId) as ChatQueuedMessageRow[];
    }
    const runId = target.runId;
    if (runId === undefined) {
      return [];
    }
    return this.db
      .query(
        `
          select *
          from web_chat_queued_messages
          where run_id = ?
          order by position asc, created_at asc, id asc
        `,
      )
      .all(runId) as ChatQueuedMessageRow[];
  }

  private nextQueuedMessagePosition(target: ChatQueueTarget): number {
    if (target.sessionId === undefined && target.runId === undefined) {
      return 1;
    }
    const queryMax = (where: string, ...values: string[]): number => {
      const row = this.db
        .query(
          `select coalesce(max(position), 0) as position from web_chat_queued_messages where ${where}`,
        )
        .get(...values) as { position: number } | null;
      return (row?.position ?? 0) + 1;
    };
    if (target.sessionId !== undefined && target.runId !== undefined) {
      return queryMax("session_id = ? or run_id = ?", target.sessionId, target.runId);
    }
    if (target.sessionId !== undefined) {
      return queryMax("session_id = ?", target.sessionId);
    }
    return queryMax("run_id = ?", target.runId as string);
  }

  private failAbandonedSession(sessionId: string, message: string): void {
    if (!this.tableExists("sessions") || !this.tableExists("events")) {
      return;
    }
    const existing = this.db.query("select status from sessions where id = ?").get(sessionId) as {
      status: string;
    } | null;
    if (existing === null || existing.status !== "running") {
      return;
    }

    const endedAt = nowIso();
    this.db
      .query(
        "update sessions set status = 'failed', ended_at = ? where id = ? and status = 'running'",
      )
      .run(endedAt, sessionId);
    this.appendSessionTraceEvent(sessionId, "session.ended", {
      status: "failed",
      endedAt,
      stoppedReason: "server_restarted",
      message,
    });
  }

  private failRestartedSessionsStillMarkedRunning(): void {
    if (!this.tableExists("sessions")) {
      return;
    }
    const rows = this.db
      .query(
        `
          select distinct r.session_id as sessionId, r.error_message as errorMessage
          from web_chat_runs r
          join sessions s on s.id = r.session_id
          where r.status = 'failed'
            and r.stopped_reason = 'server_restarted'
            and s.status = 'running'
            and r.session_id is not null
        `,
      )
      .all() as Array<{ sessionId: string; errorMessage: string | null }>;
    for (const row of rows) {
      this.failAbandonedSession(
        row.sessionId,
        row.errorMessage ?? "Server restarted while this run was active.",
      );
    }
  }

  private tableExists(name: string): boolean {
    return (
      this.db
        .query("select name from sqlite_master where type = 'table' and name = ?")
        .get(name) !== null
    );
  }

  private appendSessionTraceEvent(sessionId: string, type: string, payload: JsonObject): void {
    const ts = nowIso();
    const payloadJson = safeJsonStringify(payload);
    const [row] = this.db
      .query(
        `
          insert into events (session_id, ts, type, payload_json)
          values (?, ?, ?, ?)
          returning id
        `,
      )
      .all(sessionId, ts, type, payloadJson) as Array<{ id: number }>;
    const id = row?.id ?? 0;
    mkdirSync(this.paths.traceDir, { recursive: true });
    appendFileSync(
      path.join(this.paths.traceDir, `${sessionId}.jsonl`),
      `${safeJsonStringify({ id, sessionId, ts, type, payload })}\n`,
      "utf8",
    );
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

interface ChatQueuedMessageRow {
  id: string;
  session_id: string | null;
  run_id: string | null;
  message: string;
  attachments_json: string;
  delivery: ChatQueuedMessageDelivery;
  provider: string | null;
  model: string | null;
  reasoning_effort: string | null;
  created_at: string;
  position: number;
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

function rowToQueuedMessage(row: ChatQueuedMessageRow): ChatQueuedMessageRecord {
  return {
    id: row.id,
    ...(row.session_id === null ? {} : { sessionId: row.session_id }),
    ...(row.run_id === null ? {} : { runId: row.run_id }),
    message: row.message,
    attachments: JSON.parse(row.attachments_json) as JsonValue,
    delivery: row.delivery === "steering" ? "steering" : "follow-up",
    ...(row.provider === null ? {} : { provider: row.provider }),
    ...(row.model === null ? {} : { model: row.model }),
    ...(row.reasoning_effort === null ? {} : { reasoningEffort: row.reasoning_effort }),
    createdAt: row.created_at,
    position: row.position,
  };
}

function queueTargetFromQueuedMessage(message: ChatQueuedMessageRecord): ChatQueueTarget {
  return {
    ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
    ...(message.runId === undefined ? {} : { runId: message.runId }),
  };
}
