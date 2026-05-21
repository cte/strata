export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type SessionKind = "chat" | "query" | "ingest" | "lint" | "learn" | "maintain" | "trace";
export type SessionStatus = "running" | "completed" | "failed" | "interrupted";
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface StrataPaths {
  repoRoot: string;
  runtimeDir: string;
  traceDir: string;
  reportsDir: string;
  reflectionsDir: string;
  curatorReportsDir: string;
  memoryDir: string;
  skillsDir: string;
  proposalsDir: string;
  stateDbPath: string;
}

export interface SessionRecord {
  id: string;
  title: string;
  kind: SessionKind;
  startedAt: string;
  endedAt: string | null;
  status: SessionStatus;
  model: string | null;
  gitCommit: string | null;
}

export interface CreateSessionInput {
  title?: string;
  kind: SessionKind;
  model?: string;
  gitCommit?: string;
}

export interface TraceEvent {
  id: number;
  sessionId: string;
  ts: string;
  type: string;
  payload: JsonObject;
}

export interface MessageInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCallId?: string;
  toolCalls?: JsonValue;
  attachments?: JsonValue;
  usage?: TokenUsage;
}

export interface MessageRecord {
  id: number;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCallId: string | null;
  toolCalls: JsonValue | null;
  attachments: JsonValue | null;
  usage: TokenUsage | null;
  ts: string;
}

/**
 * Per-turn token usage produced by a single model call.
 *
 * Stored on the assistant Message that the model call produced (denormalised
 * from the `model.response` Event payload) so transcript reads, per-turn
 * rendering, and session aggregations all read directly from the Messages
 * table without re-parsing event JSON.
 *
 * Counts are post-deduplication: `input` excludes tokens already counted as
 * `cacheRead` or `cacheWrite`. `total` and `cost` are convenience aggregates
 * that the producer (`normalizeModelUsage`) computes once.
 */
export interface TokenUsage {
  [key: string]: JsonValue;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost: number;
}
