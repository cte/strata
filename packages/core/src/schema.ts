import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JsonValue, MessageRole, SessionStatus, TokenUsage } from "./types.js";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    kind: text("kind").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    status: text("status").$type<SessionStatus>().notNull(),
    model: text("model"),
    gitCommit: text("git_commit"),
  },
  (table) => [index("idx_sessions_started").on(sql`${table.startedAt} desc`)],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    ts: text("ts").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [index("idx_events_session").on(table.sessionId, table.ts)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").$type<MessageRole>().notNull(),
    content: text("content").notNull(),
    toolCallId: text("tool_call_id"),
    toolCallsJson: text("tool_calls_json", { mode: "json" }).$type<JsonValue>(),
    attachmentsJson: text("attachments_json", { mode: "json" }).$type<JsonValue>(),
    usageJson: text("usage_json", { mode: "json" }).$type<TokenUsage>(),
    ts: text("ts").notNull(),
  },
  (table) => [index("idx_messages_session").on(table.sessionId, table.ts)],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
export type EventInsert = typeof events.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
