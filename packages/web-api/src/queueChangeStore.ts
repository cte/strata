import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { getStrataPaths } from "@strata/core";
import { nowIso } from "@strata/core/events";

export interface QueueChangeRecord {
  id: number;
  ts: string;
  sessionId?: string;
  runId?: string;
}

export interface QueueChangeTarget {
  sessionId?: string;
  runId?: string;
}

export interface QueueChangesSinceResult {
  maxQueueChangeId: number;
  sessionIds: string[];
  runIds: string[];
}

export class QueueChangeStore {
  private readonly db: Database;

  constructor(repoRoot?: string) {
    const paths = getStrataPaths(repoRoot);
    mkdirSync(path.dirname(paths.stateDbPath), { recursive: true });
    this.db = new Database(paths.stateDbPath, { create: true });
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA journal_mode = WAL");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  appendQueueChange(target: QueueChangeTarget): QueueChangeRecord {
    if (target.sessionId === undefined && target.runId === undefined) {
      throw new Error("Queue change requires a session id or run id.");
    }
    const ts = nowIso();
    const [row] = this.db
      .query(
        `
          insert into web_chat_queue_changes (ts, session_id, run_id)
          values (?, ?, ?)
          returning id
        `,
      )
      .all(ts, target.sessionId ?? null, target.runId ?? null) as Array<{ id: number }>;
    return {
      id: row?.id ?? 0,
      ts,
      ...(target.sessionId === undefined ? {} : { sessionId: target.sessionId }),
      ...(target.runId === undefined ? {} : { runId: target.runId }),
    };
  }

  latestQueueChangeId(): number {
    const row = this.db
      .query("select coalesce(max(id), 0) as id from web_chat_queue_changes")
      .get() as {
      id: number;
    };
    return row.id;
  }

  queueChangesSince(afterId: number): QueueChangesSinceResult {
    const rows = this.db
      .query(
        `
          select id, session_id, run_id
          from web_chat_queue_changes
          where id > ?
          order by id asc
        `,
      )
      .all(afterId) as Array<{ id: number; session_id: string | null; run_id: string | null }>;
    const sessionIds = new Set<string>();
    const runIds = new Set<string>();
    let maxQueueChangeId = afterId;
    for (const row of rows) {
      maxQueueChangeId = Math.max(maxQueueChangeId, row.id);
      if (row.session_id !== null) {
        sessionIds.add(row.session_id);
      }
      if (row.run_id !== null) {
        runIds.add(row.run_id);
      }
    }
    return {
      maxQueueChangeId,
      sessionIds: [...sessionIds],
      runIds: [...runIds],
    };
  }

  private ensureSchema(): void {
    this.db.run(`
      create table if not exists web_chat_queue_changes (
        id integer primary key autoincrement,
        ts text not null,
        session_id text,
        run_id text,
        check (session_id is not null or run_id is not null)
      )
    `);
    this.db.run(`
      create index if not exists idx_web_chat_queue_changes_id
      on web_chat_queue_changes(id)
    `);
  }
}
