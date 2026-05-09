import type { JsonObject, JsonValue } from "@strata/core";
import { type SessionRecord, SessionStore } from "@strata/core";
import { optionalBoolean, optionalInteger, requiredNonEmptyString } from "./args.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

interface SessionsRecentArgs extends JsonObject {
  limit?: JsonValue;
  includeCurrent?: JsonValue;
}

interface SessionsSearchArgs extends JsonObject {
  query?: JsonValue;
  limit?: JsonValue;
  includeCurrent?: JsonValue;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export function registerSessionTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createSessionTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createSessionTools(): ToolDefinition[] {
  return [sessionsRecentTool, sessionsSearchTool];
}

const sessionsRecentTool: ToolDefinition<SessionsRecentArgs> = {
  name: "sessions.recent",
  description: "List recent Strata sessions for recall.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      includeCurrent: { type: "boolean", default: false },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const limit = optionalInteger(args.limit, DEFAULT_LIMIT, "limit", 1, MAX_LIMIT);
    const includeCurrent = optionalBoolean(args.includeCurrent, false, "includeCurrent");
    const store = await SessionStore.open(context.repoRoot);
    try {
      const sessions = store
        .listSessions(limit + 1)
        .filter((session) => includeCurrent || session.id !== context.sessionId)
        .slice(0, limit)
        .map(sessionToJson);
      return { sessions, count: sessions.length };
    } finally {
      store.close();
    }
  },
};

const sessionsSearchTool: ToolDefinition<SessionsSearchArgs> = {
  name: "sessions.search",
  description: "Search prior Strata sessions by title, messages, and trace events.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string" },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
      includeCurrent: { type: "boolean", default: false },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const query = requiredNonEmptyString(args.query, "query");
    const limit = optionalInteger(args.limit, DEFAULT_LIMIT, "limit", 1, MAX_LIMIT);
    const includeCurrent = optionalBoolean(args.includeCurrent, false, "includeCurrent");
    const store = await SessionStore.open(context.repoRoot);
    try {
      const sessions = store
        .searchSessions(query, limit + 1)
        .filter((session) => includeCurrent || session.id !== context.sessionId)
        .slice(0, limit)
        .map(sessionToJson);
      return { query, sessions, count: sessions.length };
    } finally {
      store.close();
    }
  },
};

function sessionToJson(session: SessionRecord): JsonObject {
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
