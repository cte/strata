import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

// A Routine's recurring triggers. Always fire `routine.run` for `routine_id`
// (the reshaped successor to `job_schedules`; see docs/adr/0002). Cadence and
// run-state columns are carried over verbatim so the scheduler's lease/next-run
// logic is unchanged — only the keying (routine_id, not job_name) differs.
export const routineTriggers = sqliteTable(
  "routine_triggers",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    name: text("name"),
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
    index("idx_routine_triggers_due").on(table.enabled, table.nextRunAt),
    index("idx_routine_triggers_routine").on(table.routineId),
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

export const routines = sqliteTable(
  "routines",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull(),
    prompt: text("prompt").notNull(),
    inputSchemaJson: text("input_schema_json").notNull(),
    defaultInputJson: text("default_input_json"),
    outputSchemaJson: text("output_schema_json"),
    outputMode: text("output_mode").notNull(),
    toolProfile: text("tool_profile").notNull(),
    requiredSkillsJson: text("required_skills_json").notNull(),
    preRunStepsJson: text("pre_run_steps_json").notNull(),
    publicationPolicyJson: text("publication_policy_json").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_routines_status").on(table.status, sql`${table.updatedAt} desc`),
    index("idx_routines_updated").on(sql`${table.updatedAt} desc`),
  ],
);

export const routineRuns = sqliteTable(
  "routine_runs",
  {
    id: text("id").primaryKey(),
    routineId: text("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    routineVersion: integer("routine_version").notNull(),
    inputJson: text("input_json").notNull(),
    status: text("status").notNull(),
    taskStatus: text("task_status"),
    jobSessionId: text("job_session_id").references(() => sessions.id, { onDelete: "set null" }),
    agentSessionId: text("agent_session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    childSessionIdsJson: text("child_session_ids_json").notNull(),
    outputArtifactIdsJson: text("output_artifact_ids_json").notNull(),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [
    index("idx_routine_runs_routine").on(table.routineId, sql`${table.startedAt} desc`),
    index("idx_routine_runs_started").on(sql`${table.startedAt} desc`),
    index("idx_routine_runs_status").on(table.status, sql`${table.startedAt} desc`),
  ],
);

export const routineArtifacts = sqliteTable(
  "routine_artifacts",
  {
    id: text("id").primaryKey(),
    routineRunId: text("routine_run_id")
      .notNull()
      .references(() => routineRuns.id, { onDelete: "cascade" }),
    routineId: text("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    schemaName: text("schema_name").notNull(),
    schemaVersion: text("schema_version").notNull(),
    payloadJson: text("payload_json").notNull(),
    validationStatus: text("validation_status").notNull(),
    taskStatus: text("task_status").notNull(),
    dedupeKey: text("dedupe_key"),
    sourceRefsJson: text("source_refs_json").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_routine_artifacts_run").on(table.routineRunId, sql`${table.createdAt} desc`),
    index("idx_routine_artifacts_routine").on(table.routineId, sql`${table.createdAt} desc`),
    index("idx_routine_artifacts_dedupe").on(table.routineId, table.dedupeKey),
  ],
);

// Durable reviewer feedback on raw-to-wiki classification outcomes (the
// "Classification correction" feedback unit of the taxonomy-suggestion loop).
// Decoupled from session lifecycle on purpose: corrections persist as eval
// ground truth even if the originating ingest session/trace is cleaned up, so
// target_session_id is a plain reference, not a foreign key.
export const classificationCorrections = sqliteTable(
  "classification_corrections",
  {
    id: text("id").primaryKey(),
    createdAt: text("created_at").notNull(),
    source: text("source").notNull(),
    targetSessionId: text("target_session_id").notNull(),
    targetEventId: integer("target_event_id").notNull(),
    rawPath: text("raw_path").notNull(),
    observedJson: text("observed_json").notNull(),
    verdict: text("verdict").notNull(),
    correctionJson: text("correction_json"),
    derivedProposalPath: text("derived_proposal_path"),
    status: text("status").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (table) => [
    index("idx_classification_corrections_dedupe").on(table.dedupeKey),
    index("idx_classification_corrections_created").on(sql`${table.createdAt} desc`),
    index("idx_classification_corrections_status").on(table.status, sql`${table.createdAt} desc`),
  ],
);

export const webChatRuns = sqliteTable(
  "web_chat_runs",
  {
    runId: text("run_id").primaryKey(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    endedAt: text("ended_at"),
    cancelled: integer("cancelled").notNull().default(0),
    sessionId: text("session_id"),
    continueSessionId: text("continue_session_id"),
    stoppedReason: text("stopped_reason"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("idx_web_chat_runs_status_updated").on(table.status, sql`${table.updatedAt} desc`),
    index("idx_web_chat_runs_session").on(table.sessionId),
  ],
);

export const webChatRunEvents = sqliteTable(
  "web_chat_run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => webChatRuns.runId, { onDelete: "cascade" }),
    ts: text("ts").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
  },
  (table) => [index("idx_web_chat_run_events_run_id").on(table.runId, table.id)],
);

export const webChatQueuedMessages = sqliteTable(
  "web_chat_queued_messages",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id"),
    runId: text("run_id"),
    message: text("message").notNull(),
    attachmentsJson: text("attachments_json").notNull(),
    delivery: text("delivery").notNull().default("follow-up"),
    provider: text("provider"),
    model: text("model"),
    reasoningEffort: text("reasoning_effort"),
    createdAt: text("created_at").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    index("idx_web_chat_queued_messages_session").on(
      table.sessionId,
      table.position,
      table.createdAt,
      table.id,
    ),
    index("idx_web_chat_queued_messages_run").on(
      table.runId,
      table.position,
      table.createdAt,
      table.id,
    ),
    check(
      "web_chat_queued_messages_target_check",
      sql`${table.sessionId} is not null or ${table.runId} is not null`,
    ),
  ],
);

export const webChatQueueChanges = sqliteTable(
  "web_chat_queue_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: text("ts").notNull(),
    sessionId: text("session_id"),
    runId: text("run_id"),
  },
  (table) => [
    index("idx_web_chat_queue_changes_id").on(table.id),
    check(
      "web_chat_queue_changes_target_check",
      sql`${table.sessionId} is not null or ${table.runId} is not null`,
    ),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
export type EventInsert = typeof events.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
export type RoutineTriggerRow = typeof routineTriggers.$inferSelect;
export type RoutineTriggerInsert = typeof routineTriggers.$inferInsert;
export type IngestActivityRunRow = typeof ingestActivityRuns.$inferSelect;
export type RoutineRow = typeof routines.$inferSelect;
export type RoutineRunRow = typeof routineRuns.$inferSelect;
export type RoutineArtifactRow = typeof routineArtifacts.$inferSelect;
export type ClassificationCorrectionRow = typeof classificationCorrections.$inferSelect;
export type ClassificationCorrectionInsertRow = typeof classificationCorrections.$inferInsert;
export type WebChatRunRow = typeof webChatRuns.$inferSelect;
export type WebChatRunEventRow = typeof webChatRunEvents.$inferSelect;
export type WebChatQueuedMessageRow = typeof webChatQueuedMessages.$inferSelect;
export type WebChatQueueChangeRow = typeof webChatQueueChanges.$inferSelect;
