import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { asc, desc, eq, or, sql } from "drizzle-orm";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { createSessionId, nowIso, safeJsonStringify } from "./events.js";
import { MIGRATIONS } from "./migrations.js";
import { getStrataPaths } from "./paths.js";
import * as schema from "./schema.js";
import { events, messages, sessions } from "./schema.js";
import { normalizeModelUsage } from "./tokenUsage.js";
import type {
  CreateSessionInput,
  DeleteSessionResult,
  JsonObject,
  JsonValue,
  MessageInput,
  MessageRecord,
  SessionRecord,
  SessionStatus,
  StrataPaths,
  TokenUsage,
  TraceEvent,
} from "./types.js";

type Schema = typeof schema;
type DrizzleDb = BunSQLiteDatabase<Schema>;

export class SessionStore {
  readonly paths: StrataPaths;
  readonly db: Database;
  private readonly drizzle: DrizzleDb;

  constructor(paths: StrataPaths = getStrataPaths()) {
    this.paths = paths;
    this.db = new Database(paths.stateDbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA busy_timeout = 10000");
    this.db.run("PRAGMA foreign_keys = ON");
    this.drizzle = drizzle(this.db, { schema });
    const migrationOutcome = applyEmbeddedMigrations(this.db);
    if (migrationOutcome.applied.includes("0001_cute_earthquake")) {
      this.backfillAssistantUsage();
    }
  }

  static async open(repoRoot?: string): Promise<SessionStore> {
    const paths = getStrataPaths(repoRoot);
    await ensureRuntimeDirs(paths);
    return new SessionStore(paths);
  }

  close(): void {
    this.db.close();
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: createSessionId(),
      title: input.title ?? input.kind,
      kind: input.kind,
      startedAt: nowIso(),
      endedAt: null,
      status: "running",
      model: input.model ?? null,
      gitCommit: input.gitCommit ?? null,
    };
    this.drizzle.insert(sessions).values(sessionToRow(session)).run();
    await this.appendEvent(session.id, "session.started", {
      title: session.title,
      kind: session.kind,
      model: session.model,
      gitCommit: session.gitCommit,
    });
    return session;
  }

  async endSession(sessionId: string, status: Exclude<SessionStatus, "running">): Promise<void> {
    const ts = nowIso();
    this.drizzle
      .update(sessions)
      .set({ endedAt: ts, status })
      .where(eq(sessions.id, sessionId))
      .run();
    await this.appendEvent(sessionId, "session.ended", { status, endedAt: ts });
  }

  /** Current max event id across all sessions (0 if no events yet). */
  latestEventId(): number {
    const row = this.db
      .query<{ maxId: number | null }, []>("select max(id) as maxId from events")
      .get();
    return row?.maxId ?? 0;
  }

  /**
   * Tail the shared event log for cross-process change notification. Returns the
   * distinct sessions with events after `afterEventId` plus the new high-water
   * mark. Cheap (indexed primary key) and synchronous; intended for a polling
   * change feed that fans out "session changed" notices to live clients.
   */
  sessionChangesSince(afterEventId: number): { maxEventId: number; sessionIds: string[] } {
    const maxEventId = this.latestEventId();
    if (maxEventId <= afterEventId) {
      return { maxEventId: afterEventId, sessionIds: [] };
    }
    const rows = this.db
      .query<{ sessionId: string }, [number, number]>(
        "select distinct session_id as sessionId from events where id > ? and id <= ?",
      )
      .all(afterEventId, maxEventId);
    return { maxEventId, sessionIds: rows.map((row) => row.sessionId) };
  }

  async appendEvent(sessionId: string, type: string, payload: JsonObject = {}): Promise<number> {
    const ts = nowIso();
    const payloadJson = safeJsonStringify(payload);
    const [inserted] = this.drizzle
      .insert(events)
      .values({ sessionId, ts, type, payloadJson })
      .returning({ id: events.id })
      .all();
    const id = inserted?.id ?? 0;

    await appendFile(
      path.join(this.paths.traceDir, `${sessionId}.jsonl`),
      `${safeJsonStringify({ id, sessionId, ts, type, payload })}\n`,
      "utf8",
    );
    return id;
  }

  listEvents(sessionId: string, type?: string): TraceEvent[] {
    const rows =
      type === undefined
        ? this.db
            .query<{ id: number; ts: string; type: string; payloadJson: string }, [string]>(
              "select id, ts, type, payload_json as payloadJson from events where session_id = ? order by id asc",
            )
            .all(sessionId)
        : this.db
            .query<{ id: number; ts: string; type: string; payloadJson: string }, [string, string]>(
              "select id, ts, type, payload_json as payloadJson from events where session_id = ? and type = ? order by id asc",
            )
            .all(sessionId, type);
    return rows.map((row) => ({
      id: row.id,
      sessionId,
      ts: row.ts,
      type: row.type,
      payload: parseEventPayload(row.payloadJson),
    }));
  }

  async appendMessage(input: MessageInput): Promise<number> {
    const ts = nowIso();
    const [inserted] = this.drizzle
      .insert(messages)
      .values({
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        toolCallId: input.toolCallId ?? null,
        toolCallsJson: input.toolCalls ?? null,
        attachmentsJson: input.attachments ?? null,
        usageJson: input.usage ?? null,
        ts,
      })
      .returning({ id: messages.id })
      .all();

    await this.appendEvent(input.sessionId, `message.${input.role}`, {
      content: input.content,
      toolCallId: input.toolCallId ?? null,
      toolCalls: input.toolCalls ?? null,
      attachments: input.attachments ?? null,
      usage: input.usage ?? null,
    });

    return inserted?.id ?? 0;
  }

  // ---------------------------------------------------------------------------
  // High-level turn recording
  //
  // The four `record*` methods below own the "what does it mean to log a turn"
  // composite. Each one fires the right combination of Messages, Events, and
  // Trace writes for one role's turn so callers (the agent loop, future
  // reflection-driven replay) only have to think in terms of role+payload, not
  // in terms of the underlying message/event split.
  //
  // The lower-level `appendMessage`/`appendEvent` remain public for callers
  // (Reflection, Maintenance) that need to write ad-hoc lifecycle events not
  // tied to a turn.
  // ---------------------------------------------------------------------------

  async recordUserMessage(input: {
    sessionId: string;
    content: string;
    attachments?: JsonValue;
  }): Promise<number> {
    return this.appendMessage({
      sessionId: input.sessionId,
      role: "user",
      content: input.content,
      ...(input.attachments === undefined ? {} : { attachments: input.attachments }),
    });
  }

  async recordAssistantMessage(input: {
    sessionId: string;
    iteration: number;
    content: string;
    finishReason: string;
    toolCalls: { id: string; name: string; argumentsText: string }[];
    usage?: TokenUsage;
    providerResponseId?: string;
  }): Promise<number> {
    const toolCallsJson: JsonValue = input.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.name,
      argumentsText: toolCall.argumentsText,
    }));
    const responsePayload: JsonObject = {
      iteration: input.iteration,
      content: input.content,
      finishReason: input.finishReason,
      toolCalls: toolCallsJson,
    };
    if (input.providerResponseId !== undefined) {
      responsePayload.providerResponseId = input.providerResponseId;
    }
    if (input.usage !== undefined) {
      responsePayload.usage = input.usage;
    }
    await this.appendEvent(input.sessionId, "model.response", responsePayload);
    return this.appendMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: input.content,
      toolCalls: toolCallsJson,
      ...(input.usage === undefined ? {} : { usage: input.usage }),
    });
  }

  async recordToolStart(input: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    argumentsText: string;
  }): Promise<void> {
    await this.appendEvent(input.sessionId, "tool.call", {
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      argumentsText: input.argumentsText,
    });
  }

  async recordToolMessage(input: {
    sessionId: string;
    toolCallId: string;
    content: string;
    resultEventPayload: JsonObject;
  }): Promise<number> {
    await this.appendEvent(input.sessionId, "tool.result", input.resultEventPayload);
    return this.appendMessage({
      sessionId: input.sessionId,
      role: "tool",
      content: input.content,
      toolCallId: input.toolCallId,
    });
  }

  /**
   * Backfill missing `usage` on assistant messages from the matching
   * `model.response` events for the same Session. Idempotent — only writes when
   * the message currently has `usage IS NULL` and the corresponding event
   * carries usage. Used by the runtime migration on first run after the
   * `usage_json` column lands.
   */
  backfillAssistantUsage(): { sessionsScanned: number; messagesUpdated: number } {
    type SessionIdRow = { id: string };
    type EventRow = { id: number; payloadJson: string };
    type MessageRow = { id: number };

    const sessionRows = this.db
      .query<SessionIdRow, []>("select id from sessions order by started_at asc")
      .all();
    let messagesUpdated = 0;
    const updateStmt = this.db.query(
      "update messages set usage_json = ? where id = ? and usage_json is null",
    );
    for (const sessionRow of sessionRows) {
      const eventRows = this.db
        .query<EventRow, [string]>(
          "select id, payload_json as payloadJson from events where session_id = ? and type = 'model.response' order by id asc",
        )
        .all(sessionRow.id);
      const assistantRows = this.db
        .query<MessageRow, [string]>(
          "select id from messages where session_id = ? and role = 'assistant' and usage_json is null order by id asc",
        )
        .all(sessionRow.id);
      const pairCount = Math.min(eventRows.length, assistantRows.length);
      for (let index = 0; index < pairCount; index += 1) {
        const eventRow = eventRows[index];
        const messageRow = assistantRows[index];
        if (eventRow === undefined || messageRow === undefined) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(eventRow.payloadJson) as Record<string, unknown>;
        } catch {
          continue;
        }
        const rawUsage = payload.usage;
        if (typeof rawUsage !== "object" || rawUsage === null || Array.isArray(rawUsage)) {
          continue;
        }
        const normalized = normalizeModelUsage(rawUsage as Record<string, unknown>);
        if (normalized === undefined) continue;
        updateStmt.run(safeJsonStringify(normalized), messageRow.id);
        messagesUpdated += 1;
      }
    }
    return { sessionsScanned: sessionRows.length, messagesUpdated };
  }

  listSessions(limit = 20): SessionRecord[] {
    const rows = this.drizzle
      .select()
      .from(sessions)
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .all();
    return rows.map(rowToSession);
  }

  findSessionsByIdPrefix(prefix: string, limit = 20): SessionRecord[] {
    const pattern = `${escapeLike(prefix)}%`;
    const rows = this.drizzle
      .select()
      .from(sessions)
      .where(sql`${sessions.id} like ${pattern} escape '\\'`)
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .all();
    return rows.map(rowToSession);
  }

  async deleteSession(sessionId: string): Promise<DeleteSessionResult> {
    const session = this.getSession(sessionId);
    if (session === undefined) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const tracePath = path.join(this.paths.traceDir, `${sessionId}.jsonl`);
    const traceMethod = await deleteTraceFile(tracePath);
    const result = this.db.query("delete from sessions where id = ?").run(sessionId);
    if (Number(result.changes) === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return {
      id: session.id,
      title: session.title,
      tracePath,
      traceMethod,
    };
  }

  deleteMessages(sessionId: string): number {
    // Drizzle's bun-sqlite adapter types `.run()` as void even though the
    // underlying call returns a Changes object, so reach for the raw handle
    // when we need the affected-row count.
    const result = this.db.query("delete from messages where session_id = ?").run(sessionId);
    return Number(result.changes);
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.drizzle.update(sessions).set({ title }).where(eq(sessions.id, sessionId)).run();
  }

  /**
   * Duplicates a session: creates a new session row and copies every message
   * across in order. Tool-call ids and content are preserved verbatim so the
   * agent can continue the cloned session as if it were the original.
   */
  async cloneSession(sourceId: string, title?: string): Promise<SessionRecord> {
    const source = this.getSession(sourceId);
    if (source === undefined) {
      throw new Error(`Session not found: ${sourceId}`);
    }
    const createInput: CreateSessionInput = {
      kind: source.kind,
      title: title ?? `Fork of ${source.title}`,
    };
    if (source.model !== null) {
      createInput.model = source.model;
    }
    const newSession = await this.createSession(createInput);
    const rows = this.listMessages(sourceId);
    for (const row of rows) {
      const input: MessageInput = {
        sessionId: newSession.id,
        role: row.role,
        content: row.content,
      };
      if (row.toolCallId !== null) {
        input.toolCallId = row.toolCallId;
      }
      if (row.toolCalls !== null) {
        input.toolCalls = row.toolCalls;
      }
      if (row.attachments !== null) {
        input.attachments = row.attachments;
      }
      await this.appendMessage(input);
    }
    await this.appendEvent(newSession.id, "session.cloned", {
      from: sourceId,
      messageCount: rows.length,
    });
    return newSession;
  }

  listMessages(sessionId: string): MessageRecord[] {
    const rows = this.drizzle
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.id))
      .all();
    return rows.map(messageRowToRecord);
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const row = this.drizzle.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    return row === undefined ? undefined : rowToSession(row);
  }

  searchSessions(query: string, limit = 20): SessionRecord[] {
    const pattern = `%${escapeLike(query)}%`;
    const rows = this.drizzle
      .selectDistinct({
        id: sessions.id,
        title: sessions.title,
        kind: sessions.kind,
        startedAt: sessions.startedAt,
        endedAt: sessions.endedAt,
        status: sessions.status,
        model: sessions.model,
        gitCommit: sessions.gitCommit,
      })
      .from(sessions)
      .leftJoin(messages, eq(messages.sessionId, sessions.id))
      .leftJoin(events, eq(events.sessionId, sessions.id))
      .where(
        or(
          sql`${sessions.title} like ${pattern} escape '\\'`,
          sql`${sessions.kind} like ${pattern} escape '\\'`,
          sql`${messages.content} like ${pattern} escape '\\'`,
          sql`${events.type} like ${pattern} escape '\\'`,
          sql`${events.payloadJson} like ${pattern} escape '\\'`,
        ),
      )
      .orderBy(desc(sessions.startedAt))
      .limit(limit)
      .all();
    return rows.map(rowToSession);
  }
}

interface MigrationOutcome {
  applied: string[];
}

/**
 * Applies any embedded migrations whose `when` timestamp is newer than the
 * latest one recorded in `__drizzle_migrations`. Mirrors the algorithm used by
 * `drizzle-orm/sqlite-core/dialect.ts` exactly so the tracking table populated
 * by Drizzle's stock migrator (or by previous runs of this function) is read
 * compatibly.
 *
 * Returns the tags of migrations applied during this call so the caller can
 * trigger one-off post-migration data fixes (e.g. backfills) only when the
 * relevant schema change just landed.
 */
function applyEmbeddedMigrations(db: Database): MigrationOutcome {
  db.run(`
    create table if not exists __drizzle_migrations (
      id integer primary key,
      hash text not null,
      created_at numeric
    )
  `);
  const last = db
    .query("select created_at from __drizzle_migrations order by created_at desc limit 1")
    .get() as { created_at: number | string } | null;
  const lastWhen = last === null ? -1 : Number(last.created_at);

  const insert = db.query("insert into __drizzle_migrations (hash, created_at) values (?, ?)");
  const applied: string[] = [];
  db.run("begin");
  try {
    for (const migration of MIGRATIONS) {
      if (migration.when <= lastWhen) {
        continue;
      }
      for (const statement of migration.statements) {
        db.run(statement);
      }
      insert.run(migration.hash, migration.when);
      applied.push(migration.tag);
    }
    db.run("commit");
  } catch (cause) {
    db.run("rollback");
    throw cause;
  }
  return { applied };
}

export async function ensureRuntimeDirs(paths: StrataPaths = getStrataPaths()): Promise<void> {
  await mkdir(paths.traceDir, { recursive: true });
  await mkdir(paths.reflectionsDir, { recursive: true });
  await mkdir(paths.curatorReportsDir, { recursive: true });
  await mkdir(paths.memoryDir, { recursive: true });
  await mkdir(paths.skillsDir, { recursive: true });
  await mkdir(paths.proposalsDir, { recursive: true });
}

function rowToSession(row: schema.SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title ?? "",
    kind: row.kind as SessionRecord["kind"],
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    status: row.status,
    model: row.model,
    gitCommit: row.gitCommit,
  };
}

function sessionToRow(session: SessionRecord): schema.SessionInsert {
  return {
    id: session.id,
    title: session.title,
    kind: session.kind,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    model: session.model,
    gitCommit: session.gitCommit,
  };
}

function messageRowToRecord(row: schema.MessageRow): MessageRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    toolCallId: row.toolCallId,
    toolCalls: (row.toolCallsJson ?? null) as JsonValue | null,
    attachments: (row.attachmentsJson ?? null) as JsonValue | null,
    usage: row.usageJson ?? null,
    ts: row.ts,
  };
}

function parseEventPayload(payloadJson: string): JsonObject {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
  } catch {
    // Fall through.
  }
  return {};
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function deleteTraceFile(tracePath: string): Promise<DeleteSessionResult["traceMethod"]> {
  if (!existsSync(tracePath)) {
    return "missing";
  }

  const trashArgs = tracePath.startsWith("-") ? ["--", tracePath] : [tracePath];
  const trashResult = spawnSync("trash", trashArgs, { encoding: "utf8" });
  if (trashResult.status === 0 || !existsSync(tracePath)) {
    return "trash";
  }

  try {
    await unlink(tracePath);
    return "unlink";
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const trashHint = formatTrashError(trashResult);
    throw new Error(
      `Failed to delete trace file ${tracePath}: ${trashHint ? `${message} (${trashHint})` : message}`,
    );
  }
}

function formatTrashError(result: ReturnType<typeof spawnSync>): string | undefined {
  const parts: string[] = [];
  if (result.error !== undefined) {
    parts.push(result.error.message);
  }
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (stderr !== "") {
    parts.push(stderr.split("\n")[0] ?? stderr);
  }
  return parts.length === 0 ? undefined : `trash: ${parts.join(" · ").slice(0, 200)}`;
}
