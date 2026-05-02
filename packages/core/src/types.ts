export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type SessionKind = "chat" | "query" | "ingest" | "lint" | "learn" | "trace";
export type SessionStatus = "running" | "completed" | "failed" | "interrupted";
export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface CortexPaths {
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
}
