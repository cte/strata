import path from "node:path";
import {
  getStrataPaths,
  type JsonObject,
  type JsonValue,
  type SessionKind,
  type SessionStatus,
  SessionStore,
  type TraceEvent,
} from "@strata/core";
import type { ConnectorName } from "./connectors/types.js";
import type { ClassificationReason } from "./raw-to-wiki/types.js";

export type IngestActivitySource = ConnectorName | "all" | "unknown";
export type IngestActivityStage = "job" | "connector" | "raw_to_wiki";
export type IngestActivityResultFilter =
  | "failed"
  | "other"
  | "raw_written"
  | "search_indexed"
  | "skipped_or_previewed"
  | "wiki_indexed";
export type IngestActivityItemStatus =
  | "completed"
  | "failed"
  | "indexed"
  | "previewed"
  | "skipped"
  | "written";

export interface IngestActivityCounts {
  rawScanned: number;
  rawWritten: number;
  rawSkipped: number;
  rawIndexed: number;
  rawIndexSkipped: number;
  wikiPagesTouched: number;
  failures: number;
  searchIndexed: number;
  itemCount: number;
}

export interface IngestActivityRunSummary {
  sessionId: string;
  title: string;
  kind: SessionKind;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  stage: IngestActivityStage;
  operation: string;
  source: IngestActivitySource | null;
  connector: ConnectorName | null;
  dryRun: boolean | null;
  jobName: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  parentSessionId: string | null;
  relatedSessionIds: string[];
  summary: string | null;
  errorMessage: string | null;
  counts: IngestActivityCounts;
  tracePath: string;
}

export interface IngestActivityItem {
  id: string;
  eventId: number;
  ts: string;
  stage: IngestActivityStage;
  status: IngestActivityItemStatus;
  source: IngestActivitySource | null;
  operation: string;
  sourceId: string | null;
  title: string | null;
  rawPath: string | null;
  sourceUrl: string | null;
  primaryKind: string | null;
  primaryPath: string | null;
  peoplePaths: string[];
  projectPaths: string[];
  decisionPaths: string[];
  threadPaths: string[];
  writtenPaths: string[];
  classificationReasons: ClassificationReason[];
  reason: string | null;
  message: string | null;
  relatedSessionIds: string[];
}

export interface IngestActivityRunDetail extends IngestActivityRunSummary {
  items: IngestActivityItem[];
  itemsTruncated: boolean;
}

export interface ListIngestActivityOptions {
  repoRoot?: string;
  limit?: number;
  source?: IngestActivitySource | "all";
  resultFilters?: IngestActivityResultFilter[];
  writesOrIndexesOnly?: boolean;
}

export interface GetIngestActivityRunOptions {
  repoRoot?: string;
  sessionId: string;
  itemLimit?: number;
  resultFilters?: IngestActivityResultFilter[];
  writesOrIndexesOnly?: boolean;
}

export interface ListIngestActivityResult {
  runs: IngestActivityRunSummary[];
}

interface SessionRow {
  id: string;
  title: string | null;
  kind: string;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  model: string | null;
  gitCommit: string | null;
}

interface ProjectionCandidateSessionRow extends SessionRow {
  lastEventId: number;
}

interface EventRow {
  id: number;
  ts: string;
  type: string;
  payloadJson: string;
}

interface ActivityProjectionStateRow {
  sessionId: string;
  lastEventId: number;
}

interface ActivityProjectionStatsRow {
  count: number;
  maxLastEventId: number | null;
}

interface ActivityProjectionRow {
  sessionId: string;
  projectedAt: string;
  lastEventId: number;
  title: string;
  kind: string;
  status: SessionStatus;
  startedAt: string;
  endedAt: string | null;
  stage: IngestActivityStage;
  operation: string;
  source: string | null;
  connector: string | null;
  dryRun: number | null;
  jobName: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  summary: string | null;
  errorMessage: string | null;
  relatedSessionIdsJson: string;
  rawScanned: number;
  rawWritten: number;
  rawSkipped: number;
  rawIndexed: number;
  rawIndexSkipped: number;
  wikiPagesTouched: number;
  failures: number;
  searchIndexed: number;
  itemCount: number;
  hasWritesOrWikiIndexes: number;
}

interface ScheduleRow {
  id: string;
  name: string;
  lastSessionId: string | null;
}

interface ParentJobLink {
  parentSessionId: string;
  jobName: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_ITEM_LIMIT = 200;
const FILTERED_DETAIL_ITEM_SCAN_LIMIT = 2000;
const WRITE_OR_INDEX_RESULT_FILTERS: readonly IngestActivityResultFilter[] = [
  "raw_written",
  "wiki_indexed",
];
const ACTIVITY_RESULT_FILTERS = new Set<IngestActivityResultFilter>([
  "failed",
  "other",
  "raw_written",
  "search_indexed",
  "skipped_or_previewed",
  "wiki_indexed",
]);
const RESULT_FILTER_SQL: Record<IngestActivityResultFilter, string> = {
  raw_written: "(dry_run is not 1 and raw_written > 0)",
  wiki_indexed: "(dry_run is not 1 and raw_indexed > 0)",
  search_indexed: "search_indexed > 0",
  skipped_or_previewed: "(dry_run = 1 or raw_skipped > 0 or raw_index_skipped > 0)",
  failed: "failures > 0",
  other:
    "(dry_run is not 1 and raw_written = 0 and raw_indexed = 0 and raw_skipped = 0 and raw_index_skipped = 0 and search_indexed = 0 and failures = 0)",
};
const SUMMARY_EXCLUDED_EVENT_TYPES = new Set([
  "raw_to_wiki.index.item",
  "raw_to_wiki.index.skipped",
  "raw_to_wiki.granola.index.item",
  "raw_to_wiki.granola.index.skipped",
]);
const DETAIL_ITEM_EVENT_TYPES = [
  "raw_to_wiki.index.item",
  "raw_to_wiki.index.skipped",
  "raw_to_wiki.granola.index.item",
  "raw_to_wiki.granola.index.skipped",
] as const;

export async function listIngestActivity(
  options: ListIngestActivityOptions = {},
): Promise<ListIngestActivityResult> {
  const store = await SessionStore.open(getStrataPaths(options.repoRoot).repoRoot);
  try {
    return listIngestActivityFromStore(store, options);
  } finally {
    store.close();
  }
}

export function listIngestActivityFromStore(
  store: SessionStore,
  options: Omit<ListIngestActivityOptions, "repoRoot"> = {},
): ListIngestActivityResult {
  const limit = boundedLimit(options.limit, DEFAULT_LIMIT);
  const sourceFilter = normalizeSourceFilter(options.source);
  const resultFilters = normalizeResultFilterSet(options);
  refreshActivityRunProjection(store);
  const schedules = scheduleByLastSessionId(store);
  const summaries = listProjectedActivityRuns(store, { limit, sourceFilter, resultFilters });
  applyCurrentScheduleLinks(summaries, schedules);
  applyParentJobLinks(summaries);
  return { runs: summaries };
}

export async function getIngestActivityRun(
  options: GetIngestActivityRunOptions,
): Promise<IngestActivityRunDetail | null> {
  const store = await SessionStore.open(getStrataPaths(options.repoRoot).repoRoot);
  try {
    return getIngestActivityRunFromStore(store, options);
  } finally {
    store.close();
  }
}

export function getIngestActivityRunFromStore(
  store: SessionStore,
  options: Omit<GetIngestActivityRunOptions, "repoRoot">,
): IngestActivityRunDetail | null {
  const row = getSessionRow(store, options.sessionId);
  if (row === null) {
    return null;
  }
  const schedules = scheduleByLastSessionId(store);
  const summary = summarizeSession(store, row, listSummaryEvents(store, row.id), schedules);
  applyParentJobLinkForDetail(store, summary, schedules);
  const itemLimit = boundedLimit(options.itemLimit, DEFAULT_ITEM_LIMIT);
  const resultFilters = normalizeResultFilterSet(options);
  const detailItemScanLimit =
    resultFilters !== null ? Math.max(itemLimit, FILTERED_DETAIL_ITEM_SCAN_LIMIT) : itemLimit;
  const { events, itemEventCount } = listDetailEvents(store, row.id, detailItemScanLimit);
  const { items, truncated } = normalizeItems(events, itemLimit, { resultFilters });
  return {
    ...summary,
    items,
    itemsTruncated: truncated || itemEventCount > detailItemScanLimit,
  };
}

function refreshActivityRunProjection(store: SessionStore): void {
  if (!tableExists(store, "ingest_activity_runs")) {
    return;
  }
  const stats = activityProjectionStats(store);
  const candidates =
    stats.count === 0
      ? listProjectionCandidateSessions(store)
      : listChangedProjectionCandidateSessions(store, stats.maxLastEventId ?? 0);
  const existing = activityProjectionStates(store);
  const schedules = new Map<string, ScheduleRow>();
  const projectedAt = new Date().toISOString();
  const stale = candidates.filter((row) => existing.get(row.id)?.lastEventId !== row.lastEventId);
  if (stale.length === 0) {
    return;
  }
  try {
    store.db.run("begin immediate");
    for (const row of stale) {
      const summary = summarizeSession(store, row, listSummaryEvents(store, row.id), schedules);
      upsertActivityRunProjection(store, summary, row.lastEventId, projectedAt);
    }
    store.db.run("commit");
  } catch (cause) {
    try {
      store.db.run("rollback");
    } catch {
      // The lock may have happened before the transaction opened.
    }
    if (isSqliteBusyError(cause)) {
      return;
    }
    throw cause;
  }
}

function listProjectedActivityRuns(
  store: SessionStore,
  options: {
    limit: number;
    sourceFilter: IngestActivitySource | null;
    resultFilters: Set<IngestActivityResultFilter> | null;
  },
): IngestActivityRunSummary[] {
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (options.sourceFilter !== null) {
    where.push("(source = ? or source is null)");
    bindings.push(options.sourceFilter);
  }
  const resultFilterWhere = resultFilterWhereClause(options.resultFilters);
  if (resultFilterWhere !== null) {
    where.push(resultFilterWhere);
  }
  bindings.push(options.limit);
  const rows = store.db
    .query<ActivityProjectionRow, Array<string | number>>(
      `select
        session_id as sessionId,
        projected_at as projectedAt,
        last_event_id as lastEventId,
        title,
        kind,
        status,
        started_at as startedAt,
        ended_at as endedAt,
        stage,
        operation,
        source,
        connector,
        dry_run as dryRun,
        job_name as jobName,
        schedule_id as scheduleId,
        schedule_name as scheduleName,
        summary,
        error_message as errorMessage,
        related_session_ids_json as relatedSessionIdsJson,
        raw_scanned as rawScanned,
        raw_written as rawWritten,
        raw_skipped as rawSkipped,
        raw_indexed as rawIndexed,
        raw_index_skipped as rawIndexSkipped,
        wiki_pages_touched as wikiPagesTouched,
        failures,
        search_indexed as searchIndexed,
        item_count as itemCount,
        has_writes_or_wiki_indexes as hasWritesOrWikiIndexes
      from ingest_activity_runs
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by started_at desc
      limit ?`,
    )
    .all(...bindings);
  return rows.map((row) => projectionRowToSummary(store, row));
}

function listProjectionCandidateSessions(store: SessionStore): ProjectionCandidateSessionRow[] {
  return store.db
    .query<ProjectionCandidateSessionRow, []>(
      `select
        s.id,
        s.title,
        s.kind,
        s.started_at as startedAt,
        s.ended_at as endedAt,
        s.status,
        s.model,
        s.git_commit as gitCommit,
        max(e_all.id) as lastEventId
      from sessions s
      join events e_all on e_all.session_id = s.id
      where exists (
        select 1
        from events e
        where e.session_id = s.id
          and (
            e.type like 'job.%'
            or e.type like 'connector.%'
            or e.type like 'raw_to_wiki.%'
          )
      )
      group by s.id
      order by s.started_at desc`,
    )
    .all();
}

function listChangedProjectionCandidateSessions(
  store: SessionStore,
  afterEventId: number,
): ProjectionCandidateSessionRow[] {
  return store.db
    .query<ProjectionCandidateSessionRow, [number]>(
      `select
        s.id,
        s.title,
        s.kind,
        s.started_at as startedAt,
        s.ended_at as endedAt,
        s.status,
        s.model,
        s.git_commit as gitCommit,
        max(e_all.id) as lastEventId
      from sessions s
      join events e_all on e_all.session_id = s.id
      where s.id in (
        select distinct session_id
        from events
        where id > ?
      )
        and exists (
          select 1
          from events e
          where e.session_id = s.id
            and (
              e.type like 'job.%'
              or e.type like 'connector.%'
              or e.type like 'raw_to_wiki.%'
            )
        )
      group by s.id
      order by s.started_at desc`,
    )
    .all(afterEventId);
}

function activityProjectionStats(store: SessionStore): ActivityProjectionStatsRow {
  return (
    store.db
      .query<ActivityProjectionStatsRow, []>(
        `select
          count(*) as count,
          max(last_event_id) as maxLastEventId
        from ingest_activity_runs`,
      )
      .get() ?? { count: 0, maxLastEventId: null }
  );
}

function activityProjectionStates(store: SessionStore): Map<string, ActivityProjectionStateRow> {
  const rows = store.db
    .query<ActivityProjectionStateRow, []>(
      `select
        session_id as sessionId,
        last_event_id as lastEventId
      from ingest_activity_runs`,
    )
    .all();
  return new Map(rows.map((row) => [row.sessionId, row]));
}

function upsertActivityRunProjection(
  store: SessionStore,
  summary: IngestActivityRunSummary,
  lastEventId: number,
  projectedAt: string,
): void {
  store.db
    .query<
      never,
      [
        string,
        string,
        number,
        string,
        string,
        string,
        string,
        string | null,
        string,
        string,
        string | null,
        string | null,
        number | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
        string,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ]
    >(
      `insert or replace into ingest_activity_runs (
        session_id,
        projected_at,
        last_event_id,
        title,
        kind,
        status,
        started_at,
        ended_at,
        stage,
        operation,
        source,
        connector,
        dry_run,
        job_name,
        schedule_id,
        schedule_name,
        summary,
        error_message,
        related_session_ids_json,
        raw_scanned,
        raw_written,
        raw_skipped,
        raw_indexed,
        raw_index_skipped,
        wiki_pages_touched,
        failures,
        search_indexed,
        item_count,
        has_writes_or_wiki_indexes
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      summary.sessionId,
      projectedAt,
      lastEventId,
      summary.title,
      summary.kind,
      summary.status,
      summary.startedAt,
      summary.endedAt,
      summary.stage,
      summary.operation,
      summary.source,
      summary.connector,
      summary.dryRun === null ? null : Number(summary.dryRun),
      summary.jobName,
      summary.scheduleId,
      summary.scheduleName,
      summary.summary,
      summary.errorMessage,
      JSON.stringify(summary.relatedSessionIds),
      summary.counts.rawScanned,
      summary.counts.rawWritten,
      summary.counts.rawSkipped,
      summary.counts.rawIndexed,
      summary.counts.rawIndexSkipped,
      summary.counts.wikiPagesTouched,
      summary.counts.failures,
      summary.counts.searchIndexed,
      summary.counts.itemCount,
      Number(activityRunResultedInWriteOrIndex(summary)),
    );
}

function projectionRowToSummary(
  store: SessionStore,
  row: ActivityProjectionRow,
): IngestActivityRunSummary {
  return {
    sessionId: row.sessionId,
    title: row.title,
    kind: row.kind as SessionKind,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    stage: activityStageValue(row.stage),
    operation: row.operation,
    source: sourceFromValue(row.source ?? undefined),
    connector: connectorNameValue(row.connector ?? undefined),
    dryRun: row.dryRun === null ? null : row.dryRun === 1,
    jobName: row.jobName,
    scheduleId: row.scheduleId,
    scheduleName: row.scheduleName,
    parentSessionId: null,
    relatedSessionIds: parseStringArrayJson(row.relatedSessionIdsJson),
    summary: row.summary,
    errorMessage: row.errorMessage,
    counts: {
      rawScanned: row.rawScanned,
      rawWritten: row.rawWritten,
      rawSkipped: row.rawSkipped,
      rawIndexed: row.rawIndexed,
      rawIndexSkipped: row.rawIndexSkipped,
      wikiPagesTouched: row.wikiPagesTouched,
      failures: row.failures,
      searchIndexed: row.searchIndexed,
      itemCount: row.itemCount,
    },
    tracePath: path.relative(
      store.paths.repoRoot,
      path.join(store.paths.traceDir, `${row.sessionId}.jsonl`),
    ),
  };
}

function activityStageValue(value: string): IngestActivityStage {
  if (value === "job" || value === "connector" || value === "raw_to_wiki") {
    return value;
  }
  return "raw_to_wiki";
}

function parseStringArrayJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function getSessionRow(store: SessionStore, sessionId: string): SessionRow | null {
  return (
    store.db
      .query<SessionRow, [string]>(
        `select
          id,
          title,
          kind,
          started_at as startedAt,
          ended_at as endedAt,
          status,
          model,
          git_commit as gitCommit
        from sessions
        where id = ?`,
      )
      .get(sessionId) ?? null
  );
}

function listSummaryEvents(store: SessionStore, sessionId: string): TraceEvent[] {
  const rows = store.db
    .query<EventRow, [string]>(
      `select id, ts, type, payload_json as payloadJson
      from events
      where session_id = ?
      order by id asc`,
    )
    .all(sessionId);
  return rows
    .filter((row) => !SUMMARY_EXCLUDED_EVENT_TYPES.has(row.type))
    .map((row) => eventRowToTraceEvent(sessionId, row));
}

function listDetailEvents(
  store: SessionStore,
  sessionId: string,
  itemLimit: number,
): { events: TraceEvent[]; itemEventCount: number } {
  const placeholders = DETAIL_ITEM_EVENT_TYPES.map(() => "?").join(", ");
  const itemTypeBindings = [sessionId, ...DETAIL_ITEM_EVENT_TYPES] satisfies [
    string,
    string,
    string,
    string,
    string,
  ];
  const limitedItemTypeBindings = [sessionId, ...DETAIL_ITEM_EVENT_TYPES, itemLimit] satisfies [
    string,
    string,
    string,
    string,
    string,
    number,
  ];
  const coreRows = store.db
    .query<EventRow, [string, string, string, string, string]>(
      `select id, ts, type, payload_json as payloadJson
      from events
      where session_id = ?
        and type not in (${placeholders})
      order by id asc`,
    )
    .all(...itemTypeBindings);
  const itemRows = store.db
    .query<EventRow, [string, string, string, string, string, number]>(
      `select id, ts, type, payload_json as payloadJson
      from events
      where session_id = ?
        and type in (${placeholders})
      order by id asc
      limit ?`,
    )
    .all(...limitedItemTypeBindings);
  const countRow = store.db
    .query<{ count: number }, [string, string, string, string, string]>(
      `select count(*) as count
      from events
      where session_id = ?
        and type in (${placeholders})`,
    )
    .get(...itemTypeBindings);
  const events = [...coreRows, ...itemRows]
    .sort((a, b) => a.id - b.id)
    .map((row) => eventRowToTraceEvent(sessionId, row));
  return { events, itemEventCount: countRow?.count ?? 0 };
}

function eventRowToTraceEvent(sessionId: string, row: EventRow): TraceEvent {
  return {
    id: row.id,
    sessionId,
    ts: row.ts,
    type: row.type,
    payload: parsePayload(row.payloadJson),
  };
}

function scheduleByLastSessionId(store: SessionStore): Map<string, ScheduleRow> {
  if (!tableExists(store, "routine_triggers")) {
    return new Map();
  }
  const rows = store.db
    .query<ScheduleRow, []>(
      `select
        id,
        coalesce(name, routine_id) as name,
        last_session_id as lastSessionId
      from routine_triggers
      where last_session_id is not null`,
    )
    .all();
  const map = new Map<string, ScheduleRow>();
  for (const row of rows) {
    if (row.lastSessionId !== null) {
      map.set(row.lastSessionId, row);
    }
  }
  return map;
}

function tableExists(store: SessionStore, tableName: string): boolean {
  const row = store.db
    .query<{ name: string }, [string]>(
      "select name from sqlite_master where type = 'table' and name = ?",
    )
    .get(tableName);
  return row !== null && row !== undefined;
}

function isSqliteBusyError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === "SQLITE_BUSY" || cause.code === "SQLITE_LOCKED")
  );
}

function summarizeSession(
  store: SessionStore,
  row: SessionRow,
  events: TraceEvent[],
  schedules: Map<string, ScheduleRow>,
): IngestActivityRunSummary {
  const schedule = schedules.get(row.id);
  const summary: IngestActivityRunSummary = {
    sessionId: row.id,
    title: row.title ?? row.kind,
    kind: row.kind as SessionKind,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    stage: "raw_to_wiki",
    operation: "ingest",
    source: null,
    connector: null,
    dryRun: null,
    jobName: null,
    scheduleId: schedule?.id ?? null,
    scheduleName: schedule?.name ?? null,
    parentSessionId: null,
    relatedSessionIds: [],
    summary: null,
    errorMessage: null,
    counts: emptyCounts(),
    tracePath: path.relative(
      store.paths.repoRoot,
      path.join(store.paths.traceDir, `${row.id}.jsonl`),
    ),
  };
  const wikiPaths = new Set<string>();
  for (const event of events) {
    applyEventToSummary(summary, wikiPaths, event);
  }
  summary.counts.wikiPagesTouched = Math.max(summary.counts.wikiPagesTouched, wikiPaths.size);
  return summary;
}

function applyEventToSummary(
  summary: IngestActivityRunSummary,
  wikiPaths: Set<string>,
  event: TraceEvent,
): void {
  const payload = event.payload;
  if (event.type === "job.started") {
    summary.stage = "job";
    summary.jobName = stringValue(payload.jobName) ?? summary.jobName;
    summary.operation = summary.jobName ?? "job";
    const input = objectValue(payload.input);
    const source = sourceFromValue(input?.connector ?? input?.source);
    summary.source = source ?? summary.source;
    summary.dryRun = booleanValue(input?.dryRun) ?? summary.dryRun;
    const schedule = objectValue(payload.schedule);
    summary.scheduleId = stringValue(schedule?.id) ?? summary.scheduleId;
    summary.scheduleName = stringValue(schedule?.name) ?? summary.scheduleName;
    return;
  }
  if (event.type === "job.completed") {
    summary.stage = "job";
    summary.jobName = stringValue(payload.jobName) ?? summary.jobName;
    summary.operation = summary.jobName ?? summary.operation;
    summary.summary = stringValue(payload.summary) ?? summary.summary;
    const output = objectValue(payload.output);
    const metrics = objectValue(output?.metrics);
    applyJobMetrics(summary, metrics);
    const details = objectValue(output?.details);
    applyJobDetails(summary, details);
    const schedule = objectValue(payload.schedule);
    summary.scheduleId = stringValue(schedule?.id) ?? summary.scheduleId;
    summary.scheduleName = stringValue(schedule?.name) ?? summary.scheduleName;
    return;
  }
  if (event.type === "job.failed") {
    summary.stage = "job";
    summary.jobName = stringValue(payload.jobName) ?? summary.jobName;
    summary.operation = summary.jobName ?? summary.operation;
    summary.errorMessage = stringValue(payload.message) ?? summary.errorMessage;
    summary.counts.failures += 1;
    const schedule = objectValue(payload.schedule);
    summary.scheduleId = stringValue(schedule?.id) ?? summary.scheduleId;
    summary.scheduleName = stringValue(schedule?.name) ?? summary.scheduleName;
    return;
  }

  const connectorEvent = parseConnectorEventType(event.type);
  if (connectorEvent !== null) {
    summary.stage = "connector";
    summary.connector = connectorEvent.connector;
    summary.source = connectorEvent.connector;
    summary.operation = connectorEvent.operation;
    summary.dryRun =
      connectorEvent.operation === "dry_run"
        ? true
        : (booleanValue(payload.dryRun) ?? summary.dryRun);
    if (connectorEvent.phase === "completed") {
      summary.summary = stringValue(payload.title) ?? summary.summary;
      const items = arrayValue(payload.items);
      if (items.length > 0) {
        summary.counts.itemCount = Math.max(summary.counts.itemCount, items.length);
        for (const item of items) {
          const object = objectValue(item);
          if (object === null) continue;
          if (booleanValue(object.written) === true) summary.counts.rawWritten += 1;
          if (booleanValue(object.skipped) === true) summary.counts.rawSkipped += 1;
        }
      } else {
        summary.counts.itemCount = Math.max(
          summary.counts.itemCount,
          numberValue(objectValue(payload.metadata), "itemCount") ?? 1,
        );
        if (booleanValue(payload.written) === true) summary.counts.rawWritten += 1;
        if (booleanValue(payload.skipped) === true) summary.counts.rawSkipped += 1;
      }
      const failures = arrayValue(payload.failures);
      summary.counts.failures += failures.length;
    } else if (connectorEvent.phase === "failed" || connectorEvent.phase === "failure") {
      summary.errorMessage = stringValue(payload.message) ?? summary.errorMessage;
      summary.counts.failures += 1;
    }
    return;
  }

  if (
    event.type === "raw_to_wiki.index.started" ||
    event.type === "raw_to_wiki.granola.index.started"
  ) {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.index";
    summary.source = sourceFromValue(payload.source) ?? summary.source ?? "granola";
    summary.dryRun = booleanValue(payload.dryRun) ?? summary.dryRun;
    summary.counts.rawScanned = Math.max(
      summary.counts.rawScanned,
      arrayValue(payload.rawPaths).length,
    );
    return;
  }
  if (
    event.type === "raw_to_wiki.index.completed" ||
    event.type === "raw_to_wiki.granola.index.completed"
  ) {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.index";
    summary.source = sourceFromValue(payload.source) ?? summary.source ?? "granola";
    summary.dryRun = booleanValue(payload.dryRun) ?? summary.dryRun;
    summary.counts.rawScanned = Math.max(
      summary.counts.rawScanned,
      numberValue(payload, "scanned") ?? 0,
    );
    summary.counts.rawIndexed = Math.max(
      summary.counts.rawIndexed,
      numberValue(payload, "indexedCount") ?? arrayValue(payload.indexed).length,
    );
    summary.counts.rawIndexSkipped = Math.max(
      summary.counts.rawIndexSkipped,
      arrayValue(payload.skipped).length,
    );
    return;
  }
  if (
    event.type === "raw_to_wiki.index.failed" ||
    event.type === "raw_to_wiki.granola.index.failed"
  ) {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.index";
    summary.errorMessage = stringValue(payload.message) ?? summary.errorMessage;
    summary.counts.failures += 1;
    return;
  }
  if (event.type === "raw_to_wiki.index.item" || event.type === "raw_to_wiki.granola.index.item") {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.index";
    summary.source = sourceFromValue(payload.source) ?? summary.source ?? "granola";
    summary.dryRun = booleanValue(payload.dryRun) ?? summary.dryRun;
    summary.counts.rawIndexed += 1;
    for (const writtenPath of stringArray(payload.writtenPaths)) {
      wikiPaths.add(writtenPath);
    }
    const primaryPath = stringValue(payload.primaryPath);
    if (primaryPath !== null) wikiPaths.add(primaryPath);
    return;
  }
  if (
    event.type === "raw_to_wiki.index.skipped" ||
    event.type === "raw_to_wiki.granola.index.skipped"
  ) {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.index";
    summary.source =
      sourceFromValue(payload.source) ??
      summary.source ??
      sourceFromRawPath(stringValue(payload.rawPath));
    summary.counts.rawIndexSkipped += 1;
    return;
  }
  if (event.type === "raw_to_wiki.granola.started") {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.propose";
    summary.source = "granola";
    summary.counts.rawScanned = Math.max(
      summary.counts.rawScanned,
      arrayValue(payload.rawPaths).length,
    );
    return;
  }
  if (event.type === "raw_to_wiki.granola.completed") {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.propose";
    summary.source = "granola";
    summary.counts.rawScanned = Math.max(
      summary.counts.rawScanned,
      numberValue(payload, "scanned") ?? 0,
    );
    summary.counts.itemCount = Math.max(
      summary.counts.itemCount,
      numberValue(payload, "proposalCount") ?? 0,
    );
    summary.counts.rawIndexSkipped = Math.max(
      summary.counts.rawIndexSkipped,
      arrayValue(payload.skipped).length,
    );
    return;
  }
  if (event.type === "raw_to_wiki.granola.failed") {
    summary.stage = "raw_to_wiki";
    summary.operation = "raw.propose";
    summary.source = "granola";
    summary.errorMessage = stringValue(payload.message) ?? summary.errorMessage;
    summary.counts.failures += 1;
  }
}

function applyJobMetrics(summary: IngestActivityRunSummary, metrics: JsonObject | null): void {
  if (metrics === null) {
    return;
  }
  summary.counts.itemCount = Math.max(
    summary.counts.itemCount,
    numberValue(metrics, "itemCount") ?? 0,
  );
  summary.counts.rawWritten = Math.max(
    summary.counts.rawWritten,
    numberValue(metrics, "writtenCount") ?? 0,
  );
  summary.counts.rawSkipped = Math.max(
    summary.counts.rawSkipped,
    numberValue(metrics, "skippedCount") ?? 0,
  );
  summary.counts.rawIndexed = Math.max(
    summary.counts.rawIndexed,
    numberValue(metrics, "indexedCount") ?? numberValue(metrics, "indexed") ?? 0,
  );
  summary.counts.rawIndexSkipped = Math.max(
    summary.counts.rawIndexSkipped,
    numberValue(metrics, "indexSkippedCount") ?? 0,
  );
  summary.counts.searchIndexed = Math.max(
    summary.counts.searchIndexed,
    numberValue(metrics, "searchIndexed") ?? 0,
  );
  addRelatedSession(summary, stringValue(metrics.connectorSessionId));
  addRelatedSession(summary, stringValue(metrics.rawToWikiSessionId));
  addRelatedSession(summary, stringValue(metrics.maintenanceSessionId));
}

function applyJobDetails(summary: IngestActivityRunSummary, details: JsonObject | null): void {
  if (details === null) {
    return;
  }
  const connector = objectValue(details.connector);
  const rawToWiki = objectValue(details.rawToWiki);
  const searchIndex = objectValue(details.searchIndex);
  summary.source = sourceFromValue(connector?.connector ?? rawToWiki?.source) ?? summary.source;
  summary.connector = connectorNameValue(connector?.connector) ?? summary.connector;
  summary.dryRun =
    booleanValue(connector?.dryRun) ?? booleanValue(rawToWiki?.dryRun) ?? summary.dryRun;
  addRelatedSession(summary, stringValue(connector?.sessionId));
  addRelatedSession(summary, stringValue(rawToWiki?.sessionId));
  summary.counts.rawScanned = Math.max(
    summary.counts.rawScanned,
    numberValue(rawToWiki, "scanned") ?? 0,
  );
  summary.counts.rawIndexed = Math.max(
    summary.counts.rawIndexed,
    arrayValue(rawToWiki?.indexed).length,
  );
  summary.counts.rawIndexSkipped = Math.max(
    summary.counts.rawIndexSkipped,
    arrayValue(rawToWiki?.skipped).length,
  );
  summary.counts.searchIndexed = Math.max(
    summary.counts.searchIndexed,
    numberValue(searchIndex, "indexed") ?? 0,
  );
}

function normalizeItems(
  events: TraceEvent[],
  itemLimit: number,
  options: { resultFilters?: Set<IngestActivityResultFilter> | null } = {},
): { items: IngestActivityItem[]; truncated: boolean } {
  const items: IngestActivityItem[] = [];
  let truncated = false;
  const completedConnectorKeys = new Set(
    events
      .map((event) => parseConnectorEventType(event.type))
      .filter((event) => event?.phase === "completed")
      .map((event) => `${event?.connector}:${event?.operation}`),
  );
  const hasExplicitRawSkipped = events.some(
    (event) =>
      event.type === "raw_to_wiki.index.skipped" ||
      event.type === "raw_to_wiki.granola.index.skipped",
  );
  const push = (item: IngestActivityItem): void => {
    if (
      options.resultFilters !== undefined &&
      options.resultFilters !== null &&
      !activityItemMatchesResultFilters(item, options.resultFilters)
    ) {
      return;
    }
    if (items.length >= itemLimit) {
      truncated = true;
      return;
    }
    items.push(item);
  };

  for (const event of events) {
    const connectorEvent = parseConnectorEventType(event.type);
    if (connectorEvent?.phase === "completed") {
      const payload = event.payload;
      const source = connectorEvent.connector;
      const operation = connectorEvent.operation;
      const dryRun = booleanValue(payload.dryRun) ?? operation === "dry_run";
      const connectorItems = arrayValue(payload.items);
      if (connectorItems.length === 0) {
        const sourceId = stringValue(payload.sourceId);
        const title = stringValue(payload.title);
        const rawPath = stringValue(payload.rawPath);
        if (sourceId !== null || rawPath !== null || title !== null) {
          push({
            ...baseActivityItem(
              event,
              "connector",
              connectorStatus(payload, dryRun),
              source,
              operation,
            ),
            sourceId,
            title,
            rawPath,
            sourceUrl: stringValue(payload.sourceUrl),
          });
        }
      } else {
        connectorItems.forEach((value, index) => {
          const item = objectValue(value);
          if (item === null) return;
          push({
            ...baseActivityItem(
              event,
              "connector",
              connectorStatus(item, dryRun),
              source,
              operation,
            ),
            id: `${event.id}:item:${index}`,
            sourceId: stringValue(item.sourceId),
            title: stringValue(item.title),
            rawPath: stringValue(item.rawPath),
            sourceUrl: stringValue(item.sourceUrl),
          });
        });
      }
      arrayValue(payload.failures).forEach((value, index) => {
        const failure = objectValue(value);
        if (failure === null) return;
        push({
          ...baseActivityItem(event, "connector", "failed", source, operation),
          id: `${event.id}:failure:${index}`,
          sourceId: stringValue(failure.sourceId),
          message: stringValue(failure.message),
        });
      });
      continue;
    }
    if (connectorEvent?.phase === "item") {
      const key = `${connectorEvent.connector}:${connectorEvent.operation}`;
      if (completedConnectorKeys.has(key)) {
        continue;
      }
      const payload = event.payload;
      const dryRun = booleanValue(payload.dryRun) ?? connectorEvent.operation === "dry_run";
      push({
        ...baseActivityItem(
          event,
          "connector",
          connectorStatus(payload, dryRun),
          connectorEvent.connector,
          connectorEvent.operation,
        ),
        sourceId: stringValue(payload.sourceId),
        title: stringValue(payload.title),
        rawPath: stringValue(payload.rawPath),
        sourceUrl: stringValue(payload.sourceUrl),
      });
      continue;
    }
    if (connectorEvent?.phase === "failed" || connectorEvent?.phase === "failure") {
      push({
        ...baseActivityItem(
          event,
          "connector",
          "failed",
          connectorEvent.connector,
          connectorEvent.operation,
        ),
        message: stringValue(event.payload.message),
      });
      continue;
    }

    const rawIndexItem = rawToWikiIndexItemFromEvent(event);
    if (rawIndexItem !== null) {
      push(rawIndexItem);
      continue;
    }

    if (
      event.type === "raw_to_wiki.index.skipped" ||
      event.type === "raw_to_wiki.granola.index.skipped"
    ) {
      const payload = event.payload;
      push({
        ...baseActivityItem(
          event,
          "raw_to_wiki",
          "skipped",
          sourceFromValue(payload.source) ?? sourceFromRawPath(stringValue(payload.rawPath)),
          "raw.index",
        ),
        rawPath: stringValue(payload.rawPath),
        reason: stringValue(payload.reason),
        classificationReasons: classificationReasonArray(payload.classificationReasons),
      });
      continue;
    }

    if (
      !hasExplicitRawSkipped &&
      (event.type === "raw_to_wiki.index.completed" ||
        event.type === "raw_to_wiki.granola.index.completed")
    ) {
      const source = sourceFromValue(event.payload.source) ?? "granola";
      arrayValue(event.payload.skipped).forEach((value, index) => {
        const skipped = objectValue(value);
        if (skipped === null) return;
        push({
          ...baseActivityItem(event, "raw_to_wiki", "skipped", source, "raw.index"),
          id: `${event.id}:skipped:${index}`,
          rawPath: stringValue(skipped.rawPath),
          reason: stringValue(skipped.reason),
          classificationReasons: classificationReasonArray(skipped.classificationReasons),
        });
      });
      continue;
    }

    if (
      event.type === "raw_to_wiki.index.failed" ||
      event.type === "raw_to_wiki.granola.index.failed"
    ) {
      push({
        ...baseActivityItem(event, "raw_to_wiki", "failed", null, "raw.index"),
        message: stringValue(event.payload.message),
      });
    }
  }

  return { items, truncated };
}

function baseActivityItem(
  event: TraceEvent,
  stage: IngestActivityStage,
  status: IngestActivityItemStatus,
  source: IngestActivitySource | null,
  operation: string,
): IngestActivityItem {
  return {
    id: `${event.id}`,
    eventId: event.id,
    ts: event.ts,
    stage,
    status,
    source,
    operation,
    sourceId: null,
    title: null,
    rawPath: null,
    sourceUrl: null,
    primaryKind: null,
    primaryPath: null,
    peoplePaths: [],
    projectPaths: [],
    decisionPaths: [],
    threadPaths: [],
    writtenPaths: [],
    classificationReasons: [],
    reason: null,
    message: null,
    relatedSessionIds: [],
  };
}

/**
 * Build an {@link IngestActivityItem} from a single `raw_to_wiki.index.item`
 * event (or its `granola` variant), or `null` for any other event type. Shared
 * by per-session detail assembly and the cross-session reader below so both
 * read raw-to-wiki classification outcomes identically.
 */
export function rawToWikiIndexItemFromEvent(event: TraceEvent): IngestActivityItem | null {
  if (event.type !== "raw_to_wiki.index.item" && event.type !== "raw_to_wiki.granola.index.item") {
    return null;
  }
  const payload = event.payload;
  return {
    ...baseActivityItem(
      event,
      "raw_to_wiki",
      booleanValue(payload.dryRun) === true ? "previewed" : "indexed",
      sourceFromValue(payload.source) ?? sourceFromRawPath(stringValue(payload.rawPath)),
      "raw.index",
    ),
    title: stringValue(payload.title),
    rawPath: stringValue(payload.rawPath),
    primaryKind: stringValue(payload.primaryKind),
    primaryPath: stringValue(payload.primaryPath),
    peoplePaths: stringArray(payload.peoplePaths),
    projectPaths: stringArray(payload.projectPaths),
    decisionPaths: stringArray(payload.decisionPaths),
    threadPaths: stringArray(payload.threadPaths),
    writtenPaths: stringArray(payload.writtenPaths),
    classificationReasons: classificationReasonArray(payload.classificationReasons),
  };
}

/** A raw-to-wiki index item paired with the session that emitted it. */
export interface RawToWikiIndexRecord {
  sessionId: string;
  item: IngestActivityItem;
}

/**
 * Read `raw_to_wiki.index.item` events directly from the event log across all
 * sessions, most-recent first. Raw-to-wiki indexing runs in its own sessions
 * that are *not* projected into `ingest_activity_runs`, so consumers that need
 * classification outcomes (e.g. the taxonomy review queue) must read the events
 * rather than walk the materialized run-list.
 */
export function listRawToWikiIndexItems(
  store: SessionStore,
  options: { limit?: number } = {},
): RawToWikiIndexRecord[] {
  const limit = Math.max(1, Math.min(options.limit ?? 2000, 20000));
  const rows = store.db
    .query<EventRow & { sessionId: string }, [number]>(
      `select id, session_id as sessionId, ts, type, payload_json as payloadJson
      from events
      where type in ('raw_to_wiki.index.item', 'raw_to_wiki.granola.index.item')
      order by id desc
      limit ?`,
    )
    .all(limit);
  const records: RawToWikiIndexRecord[] = [];
  for (const row of rows) {
    const item = rawToWikiIndexItemFromEvent(eventRowToTraceEvent(row.sessionId, row));
    if (item !== null) {
      records.push({ sessionId: row.sessionId, item });
    }
  }
  return records;
}

function connectorStatus(payload: JsonObject, dryRun: boolean): IngestActivityItemStatus {
  if (booleanValue(payload.written) === true) return "written";
  if (booleanValue(payload.skipped) === true) return "skipped";
  if (dryRun) return "previewed";
  return "completed";
}

function activityRunResultedInWriteOrIndex(summary: IngestActivityRunSummary): boolean {
  if (summary.dryRun === true) {
    return false;
  }
  return summary.counts.rawWritten > 0 || summary.counts.rawIndexed > 0;
}

function activityItemMatchesResultFilters(
  item: IngestActivityItem,
  resultFilters: Set<IngestActivityResultFilter>,
): boolean {
  if (resultFilters.size === 0) {
    return false;
  }
  switch (item.status) {
    case "written":
      return resultFilters.has("raw_written");
    case "indexed":
      return resultFilters.has("wiki_indexed");
    case "previewed":
    case "skipped":
      return resultFilters.has("skipped_or_previewed");
    case "failed":
      return resultFilters.has("failed");
    case "completed":
      return resultFilters.has("other");
  }
}

function resultFilterWhereClause(
  resultFilters: Set<IngestActivityResultFilter> | null,
): string | null {
  if (resultFilters === null) {
    return null;
  }
  if (resultFilters.size === 0) {
    return "0 = 1";
  }
  return `(${Array.from(resultFilters)
    .map((filter) => RESULT_FILTER_SQL[filter])
    .join(" or ")})`;
}

function applyCurrentScheduleLinks(
  summaries: IngestActivityRunSummary[],
  schedules: Map<string, ScheduleRow>,
): void {
  for (const summary of summaries) {
    const schedule = schedules.get(summary.sessionId);
    if (schedule === undefined) {
      continue;
    }
    summary.scheduleId = schedule.id;
    summary.scheduleName = schedule.name;
  }
}

function applyParentJobLinks(summaries: IngestActivityRunSummary[]): void {
  const childLinks = new Map<string, ParentJobLink>();
  for (const summary of summaries) {
    if (summary.stage !== "job") {
      continue;
    }
    for (const childSessionId of summary.relatedSessionIds) {
      if (childSessionId === summary.sessionId) {
        continue;
      }
      childLinks.set(childSessionId, {
        parentSessionId: summary.sessionId,
        jobName: summary.jobName,
        scheduleId: summary.scheduleId,
        scheduleName: summary.scheduleName,
      });
    }
  }
  for (const summary of summaries) {
    const link = childLinks.get(summary.sessionId);
    if (link === undefined) {
      continue;
    }
    summary.parentSessionId = link.parentSessionId;
    summary.jobName = summary.jobName ?? link.jobName;
    summary.scheduleId = summary.scheduleId ?? link.scheduleId;
    summary.scheduleName = summary.scheduleName ?? link.scheduleName;
  }
}

function applyParentJobLinkForDetail(
  store: SessionStore,
  summary: IngestActivityRunSummary,
  schedules: Map<string, ScheduleRow>,
): void {
  if (summary.stage === "job") {
    return;
  }
  const pattern = `%${escapeLike(summary.sessionId)}%`;
  const rows = store.db
    .query<SessionRow, [string]>(
      `select
        s.id,
        s.title,
        s.kind,
        s.started_at as startedAt,
        s.ended_at as endedAt,
        s.status,
        s.model,
        s.git_commit as gitCommit
      from sessions s
      join events e on e.session_id = s.id
      where s.kind = 'job'
        and e.type = 'job.completed'
        and e.payload_json like ? escape '\\'
      order by s.started_at desc
      limit 10`,
    )
    .all(pattern);
  for (const row of rows) {
    const parent = summarizeSession(store, row, listSummaryEvents(store, row.id), schedules);
    if (!parent.relatedSessionIds.includes(summary.sessionId)) {
      continue;
    }
    summary.parentSessionId = parent.sessionId;
    summary.jobName = summary.jobName ?? parent.jobName;
    summary.scheduleId = summary.scheduleId ?? parent.scheduleId;
    summary.scheduleName = summary.scheduleName ?? parent.scheduleName;
    return;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function parseConnectorEventType(
  type: string,
): { connector: ConnectorName; operation: string; phase: string } | null {
  const match = /^connector\.([^.]+)\.([^.]+)\.([^.]+)$/.exec(type);
  if (match === null) {
    return null;
  }
  const connector = connectorNameValue(match[1]);
  if (connector === null) {
    return null;
  }
  return {
    connector,
    operation: match[2] ?? "pull",
    phase: match[3] ?? "completed",
  };
}

function connectorNameValue(value: JsonValue | undefined): ConnectorName | null {
  return value === "granola" || value === "notion" || value === "slack" ? value : null;
}

function sourceFromValue(value: JsonValue | undefined): IngestActivitySource | null {
  if (
    value === "granola" ||
    value === "notion" ||
    value === "slack" ||
    value === "all" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function sourceFromRawPath(rawPath: string | null): IngestActivitySource | null {
  if (rawPath === null) {
    return null;
  }
  if (rawPath.includes("/granola/")) return "granola";
  if (rawPath.includes("/notion/")) return "notion";
  if (rawPath.includes("/slack/")) return "slack";
  return null;
}

function addRelatedSession(summary: IngestActivityRunSummary, sessionId: string | null): void {
  if (sessionId === null || summary.relatedSessionIds.includes(sessionId)) {
    return;
  }
  summary.relatedSessionIds.push(sessionId);
}

function emptyCounts(): IngestActivityCounts {
  return {
    rawScanned: 0,
    rawWritten: 0,
    rawSkipped: 0,
    rawIndexed: 0,
    rawIndexSkipped: 0,
    wikiPagesTouched: 0,
    failures: 0,
    searchIndexed: 0,
    itemCount: 0,
  };
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(value), MAX_LIMIT));
}

function normalizeSourceFilter(
  value: IngestActivitySource | "all" | undefined,
): IngestActivitySource | null {
  if (value === undefined || value === "all") {
    return null;
  }
  return value;
}

function normalizeResultFilterSet(options: {
  resultFilters?: IngestActivityResultFilter[];
  writesOrIndexesOnly?: boolean;
}): Set<IngestActivityResultFilter> | null {
  if (options.resultFilters !== undefined) {
    return new Set(
      options.resultFilters.filter((filter): filter is IngestActivityResultFilter =>
        ACTIVITY_RESULT_FILTERS.has(filter),
      ),
    );
  }
  if (options.writesOrIndexesOnly === true) {
    return new Set(WRITE_OR_INDEX_RESULT_FILTERS);
  }
  return null;
}

function parsePayload(payloadJson: string): JsonObject {
  try {
    const parsed = JSON.parse(payloadJson) as unknown;
    const object = objectValue(parsed);
    return object ?? {};
  } catch {
    return {};
  }
}

function objectValue(value: unknown): JsonObject | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function arrayValue(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: JsonObject | null, key: string): number | null {
  if (value === null) {
    return null;
  }
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function classificationReasonArray(value: JsonValue | undefined): ClassificationReason[] {
  return arrayValue(value)
    .map((item) => objectValue(item))
    .filter((item): item is ClassificationReason => {
      if (item === null) return false;
      return (
        typeof item.kind === "string" &&
        (item.source === "generic" || item.source === "taxonomy") &&
        typeof item.label === "string"
      );
    });
}
