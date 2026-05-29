import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
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

export const jobSchedules = sqliteTable(
  "job_schedules",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    jobName: text("job_name").notNull(),
    inputJson: text("input_json").notNull(),
    triggerJson: text("trigger_json").notNull(),
    enabled: integer("enabled").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    lastSessionId: text("last_session_id"),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    lockedAt: text("locked_at"),
  },
  (table) => [
    index("idx_job_schedules_due").on(table.enabled, table.nextRunAt),
    index("idx_job_schedules_job").on(table.jobName),
  ],
);

export const ingestActivityRuns = sqliteTable(
  "ingest_activity_runs",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    projectedAt: text("projected_at").notNull(),
    lastEventId: integer("last_event_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    status: text("status").$type<SessionStatus>().notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    stage: text("stage").notNull(),
    operation: text("operation").notNull(),
    source: text("source"),
    connector: text("connector"),
    dryRun: integer("dry_run"),
    jobName: text("job_name"),
    scheduleId: text("schedule_id"),
    scheduleName: text("schedule_name"),
    summary: text("summary"),
    errorMessage: text("error_message"),
    relatedSessionIdsJson: text("related_session_ids_json").notNull(),
    rawScanned: integer("raw_scanned").notNull(),
    rawWritten: integer("raw_written").notNull(),
    rawSkipped: integer("raw_skipped").notNull(),
    rawIndexed: integer("raw_indexed").notNull(),
    rawIndexSkipped: integer("raw_index_skipped").notNull(),
    wikiPagesTouched: integer("wiki_pages_touched").notNull(),
    failures: integer("failures").notNull(),
    searchIndexed: integer("search_indexed").notNull(),
    itemCount: integer("item_count").notNull(),
    hasWritesOrWikiIndexes: integer("has_writes_or_wiki_indexes").notNull(),
  },
  (table) => [
    index("idx_ingest_activity_runs_started").on(sql`${table.startedAt} desc`),
    index("idx_ingest_activity_runs_write_index").on(
      table.hasWritesOrWikiIndexes,
      sql`${table.startedAt} desc`,
    ),
    index("idx_ingest_activity_runs_source").on(table.source, sql`${table.startedAt} desc`),
  ],
);

export const extractionRuns = sqliteTable(
  "extraction_runs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    scopeJson: text("scope_json").notNull(),
    day: text("day"),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    extractorVersion: text("extractor_version").notNull(),
    verifierVersion: text("verifier_version").notNull(),
    model: text("model"),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    dryRun: integer("dry_run").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    rejectedCount: integer("rejected_count").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_extraction_runs_name_day").on(
      table.name,
      table.day,
      table.extractorVersion,
      table.verifierVersion,
      table.status,
    ),
    index("idx_extraction_runs_session").on(table.sessionId),
  ],
);

export const extractionCandidates = sqliteTable(
  "extraction_candidates",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => extractionRuns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    day: text("day").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceKind: text("source_kind").notNull(),
    sourceType: text("source_type").notNull(),
    lineStart: integer("line_start").notNull(),
    lineEnd: integer("line_end").notNull(),
    evidenceSpanId: text("evidence_span_id").notNull(),
    evidenceText: text("evidence_text").notNull(),
    candidateHash: text("candidate_hash").notNull(),
    candidateKind: text("candidate_kind").notNull(),
    candidateText: text("candidate_text").notNull(),
    status: text("status").notNull(),
    verificationJson: text("verification_json").notNull(),
    deterministicReasonsJson: text("deterministic_reasons_json").notNull(),
    metadataJson: text("metadata_json").notNull(),
    publishedTarget: text("published_target"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_extraction_candidates_day_status").on(table.name, table.day, table.status),
    index("idx_extraction_candidates_run").on(table.runId),
    uniqueIndex("idx_extraction_candidates_dedupe").on(
      table.name,
      table.day,
      table.sourcePath,
      table.lineStart,
      table.lineEnd,
      table.candidateHash,
    ),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
export type EventInsert = typeof events.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
export type JobScheduleRow = typeof jobSchedules.$inferSelect;
export type JobScheduleInsert = typeof jobSchedules.$inferInsert;
export type IngestActivityRunRow = typeof ingestActivityRuns.$inferSelect;
export type ExtractionRunRow = typeof extractionRuns.$inferSelect;
export type ExtractionCandidateRow = typeof extractionCandidates.$inferSelect;
