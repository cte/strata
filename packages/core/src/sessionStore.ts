import { Database } from "bun:sqlite";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createSessionId, nowIso, safeJsonStringify } from "./events.js";
import { getCortexPaths } from "./paths.js";
import type {
  CortexPaths,
  CreateSessionInput,
  JsonObject,
  JsonValue,
  MessageInput,
  MessageRecord,
  MessageRole,
  SessionRecord,
  SessionStatus,
} from "./types.js";

type SessionRow = {
  id: string;
  title: string | null;
  kind: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  model: string | null;
  git_commit: string | null;
};

export class SessionStore {
  readonly paths: CortexPaths;
  readonly db: Database;

  constructor(paths: CortexPaths = getCortexPaths()) {
    this.paths = paths;
    this.db = new Database(paths.stateDbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  static async open(repoRoot?: string): Promise<SessionStore> {
    const paths = getCortexPaths(repoRoot);
    await ensureRuntimeDirs(paths);
    return new SessionStore(paths);
  }

  close(): void {
    this.db.close();
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const ts = nowIso();
    const session: SessionRecord = {
      id: createSessionId(),
      title: input.title ?? input.kind,
      kind: input.kind,
      startedAt: ts,
      endedAt: null,
      status: "running",
      model: input.model ?? null,
      gitCommit: input.gitCommit ?? null,
    };

    this.db
      .query(
        `insert into sessions (id, title, kind, started_at, ended_at, status, model, git_commit)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.title,
        session.kind,
        session.startedAt,
        session.endedAt,
        session.status,
        session.model,
        session.gitCommit,
      );

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
    this.db
      .query("update sessions set ended_at = ?, status = ? where id = ?")
      .run(ts, status, sessionId);
    await this.appendEvent(sessionId, "session.ended", { status, endedAt: ts });
  }

  async appendEvent(sessionId: string, type: string, payload: JsonObject = {}): Promise<number> {
    const ts = nowIso();
    const payloadJson = safeJsonStringify(payload);
    const result = this.db
      .query("insert into events (session_id, ts, type, payload_json) values (?, ?, ?, ?)")
      .run(sessionId, ts, type, payloadJson);
    const id = Number(result.lastInsertRowid);

    await appendFile(
      path.join(this.paths.traceDir, `${sessionId}.jsonl`),
      `${safeJsonStringify({ id, sessionId, ts, type, payload })}\n`,
      "utf8",
    );

    return id;
  }

  async appendMessage(input: MessageInput): Promise<number> {
    const ts = nowIso();
    const toolCallsJson = input.toolCalls === undefined ? null : safeJsonStringify(input.toolCalls);
    const attachmentsJson =
      input.attachments === undefined ? null : safeJsonStringify(input.attachments);
    const result = this.db
      .query(
        `insert into messages (session_id, role, content, tool_call_id, tool_calls_json, attachments_json, ts)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sessionId,
        input.role,
        input.content,
        input.toolCallId ?? null,
        toolCallsJson,
        attachmentsJson,
        ts,
      );

    await this.appendEvent(input.sessionId, `message.${input.role}`, {
      content: input.content,
      toolCallId: input.toolCallId ?? null,
      toolCalls: input.toolCalls ?? null,
      attachments: input.attachments ?? null,
    });

    return Number(result.lastInsertRowid);
  }

  listSessions(limit = 20): SessionRecord[] {
    const rows = this.db
      .query("select * from sessions order by started_at desc limit ?")
      .all(limit) as SessionRow[];
    return rows.map(rowToSession);
  }

  deleteMessages(sessionId: string): number {
    const result = this.db.query("delete from messages where session_id = ?").run(sessionId);
    return Number(result.changes);
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.db.query("update sessions set title = ? where id = ?").run(title, sessionId);
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
    const rows = this.db
      .query(
        `select id, session_id, role, content, tool_call_id, tool_calls_json, attachments_json, ts
         from messages
         where session_id = ?
         order by id asc`,
      )
      .all(sessionId) as {
      id: number;
      session_id: string;
      role: string;
      content: string;
      tool_call_id: string | null;
      tool_calls_json: string | null;
      attachments_json: string | null;
      ts: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      toolCallId: row.tool_call_id,
      toolCalls:
        row.tool_calls_json === null ? null : (JSON.parse(row.tool_calls_json) as JsonValue),
      attachments:
        row.attachments_json === null ? null : (JSON.parse(row.attachments_json) as JsonValue),
      ts: row.ts,
    }));
  }

  getSession(sessionId: string): SessionRecord | undefined {
    const row = this.db.query("select * from sessions where id = ?").get(sessionId) as
      | SessionRow
      | undefined;
    return row === undefined ? undefined : rowToSession(row);
  }

  searchSessions(query: string, limit = 20): SessionRecord[] {
    const like = `%${escapeLike(query)}%`;
    const rows = this.db
      .query(
        `select distinct s.*
         from sessions s
         left join messages m on m.session_id = s.id
         left join events e on e.session_id = s.id
         where s.title like ? escape '\\'
            or s.kind like ? escape '\\'
            or m.content like ? escape '\\'
            or e.type like ? escape '\\'
            or e.payload_json like ? escape '\\'
         order by s.started_at desc
         limit ?`,
      )
      .all(like, like, like, like, like, limit) as SessionRow[];
    return rows.map(rowToSession);
  }

  private initSchema(): void {
    this.db.run(`
      create table if not exists sessions (
        id text primary key,
        title text,
        kind text not null,
        started_at text not null,
        ended_at text,
        status text not null,
        model text,
        git_commit text
      )
    `);
    this.db.run(`
      create table if not exists events (
        id integer primary key,
        session_id text not null references sessions(id) on delete cascade,
        ts text not null,
        type text not null,
        payload_json text not null
      )
    `);
    this.db.run(`
      create table if not exists messages (
        id integer primary key,
        session_id text not null references sessions(id) on delete cascade,
        role text not null,
        content text not null,
        tool_call_id text,
        tool_calls_json text,
        ts text not null
      )
    `);
    this.db.run("create index if not exists idx_sessions_started on sessions(started_at desc)");
    this.db.run("create index if not exists idx_events_session on events(session_id, ts)");
    this.db.run("create index if not exists idx_messages_session on messages(session_id, ts)");

    // Migrations on existing DBs. SQLite ALTER TABLE ADD COLUMN is non-destructive.
    if (!this.columnExists("messages", "attachments_json")) {
      this.db.run("alter table messages add column attachments_json text");
    }
  }

  private columnExists(table: string, column: string): boolean {
    const rows = this.db.query(`pragma table_info(${table})`).all() as { name: string }[];
    return rows.some((row) => row.name === column);
  }
}

export async function ensureRuntimeDirs(paths: CortexPaths = getCortexPaths()): Promise<void> {
  await mkdir(paths.traceDir, { recursive: true });
  await mkdir(paths.reflectionsDir, { recursive: true });
  await mkdir(paths.curatorReportsDir, { recursive: true });
  await mkdir(paths.memoryDir, { recursive: true });
  await mkdir(paths.skillsDir, { recursive: true });
  await mkdir(paths.proposalsDir, { recursive: true });
}

function rowToSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    title: row.title ?? "",
    kind: row.kind as SessionRecord["kind"],
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as SessionStatus,
    model: row.model,
    gitCommit: row.git_commit,
  };
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
