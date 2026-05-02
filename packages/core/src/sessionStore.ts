import { Database } from "bun:sqlite";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { createSessionId, nowIso, safeJsonStringify } from "./events.js";
import { getCortexPaths } from "./paths.js";
import type {
  CortexPaths,
  CreateSessionInput,
  JsonObject,
  MessageInput,
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
    const result = this.db
      .query(
        `insert into messages (session_id, role, content, tool_call_id, tool_calls_json, ts)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.sessionId, input.role, input.content, input.toolCallId ?? null, toolCallsJson, ts);

    await this.appendEvent(input.sessionId, `message.${input.role}`, {
      content: input.content,
      toolCallId: input.toolCallId ?? null,
      toolCalls: input.toolCalls ?? null,
    });

    return Number(result.lastInsertRowid);
  }

  listSessions(limit = 20): SessionRecord[] {
    const rows = this.db
      .query("select * from sessions order by started_at desc limit ?")
      .all(limit) as SessionRow[];
    return rows.map(rowToSession);
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
