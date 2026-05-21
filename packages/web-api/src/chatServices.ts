import {
  defaultModel,
  getChatGptCredentials,
  inferDefaultProvider,
  listModels,
  parseModelProvider,
} from "@strata/agent";
import { findRepoFiles } from "@strata/core/repo-files";
import { SessionStore } from "@strata/core/session-store";
import type { MessageRecord, SessionRecord } from "@strata/core/types";
import { repoRoot, runtimeEnv, type WebApiOptions } from "./runtime.js";
import type {
  BrowserJsonValue,
  ChatFilesListInput,
  ChatMessageSummary,
  ChatModelStatus,
  ChatModelSummary,
  ChatModelsListInput,
  ChatSessionDetail,
  ChatSessionForkInput,
  ChatSessionGetInput,
  ChatSessionSummary,
  ChatSessionsListInput,
  ChatSessionsSearchInput,
} from "./trpc.js";

const CHAT_SESSION_KINDS = new Set(["chat", "query"]);
const MAX_SESSION_SCAN = 200;

export type SessionStoreGetter = () => Promise<SessionStore>;

export async function chatModelStatus(options: WebApiOptions): Promise<ChatModelStatus> {
  const root = repoRoot(options);
  const env = runtimeEnv(options);
  const provider =
    parseModelProvider(env.STRATA_PROVIDER) ??
    (await inferDefaultProvider({ repoRoot: root, env }));
  const model = defaultModel(provider, { env });
  const credentials = await getChatGptCredentials(root);
  const status: ChatModelStatus = {
    provider,
    model,
    codexLoggedIn: credentials !== undefined,
    apiKeyConfigured: env.STRATA_API_KEY !== undefined || env.OPENAI_API_KEY !== undefined,
  };
  if (credentials?.expiresAt !== undefined) {
    status.codexExpiresAt = credentials.expiresAt;
  }
  return status;
}

export async function listChatModels(
  input: ChatModelsListInput,
  options: WebApiOptions,
): Promise<{ models: ChatModelSummary[] }> {
  return {
    models: await listModels(input.provider, {
      repoRoot: repoRoot(options),
      env: runtimeEnv(options),
    }),
  };
}

export function listChatFiles(
  input: ChatFilesListInput,
  options: WebApiOptions,
): { entries: ReturnType<typeof findRepoFiles> } {
  return {
    entries: findRepoFiles({
      repoRoot: repoRoot(options),
      query: input.query,
      limit: input.limit,
    }),
  };
}

export async function listChatSessions(
  input: ChatSessionsListInput,
  getSessionStore: SessionStoreGetter,
): Promise<{ sessions: ChatSessionSummary[] }> {
  const store = await getSessionStore();
  return {
    sessions: store
      .listSessions(sessionScanLimit(input.limit))
      .filter((session) => isChatSessionKind(session.kind))
      .slice(0, input.limit)
      .map(sessionToChatSummary),
  };
}

export async function getChatSession(
  input: ChatSessionGetInput,
  getSessionStore: SessionStoreGetter,
): Promise<ChatSessionDetail | null> {
  const store = await getSessionStore();
  const session = store.getSession(input.sessionId);
  if (session === undefined || !isChatSessionKind(session.kind)) {
    return null;
  }
  return {
    session: sessionToChatSummary(session),
    messages: store.listMessages(session.id).map(messageToChatSummary),
  };
}

export async function forkChatSession(
  input: ChatSessionForkInput,
  getSessionStore: SessionStoreGetter,
): Promise<ChatSessionDetail> {
  const store = await getSessionStore();
  const source = store.getSession(input.sessionId);
  if (source === undefined || !isChatSessionKind(source.kind)) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  const cloned = await store.cloneSession(input.sessionId);
  return {
    session: sessionToChatSummary(cloned),
    messages: store.listMessages(cloned.id).map(messageToChatSummary),
  };
}

export async function searchChatSessions(
  input: ChatSessionsSearchInput,
  getSessionStore: SessionStoreGetter,
): Promise<{ sessions: ChatSessionSummary[] }> {
  const store = await getSessionStore();
  return {
    sessions: store
      .searchSessions(input.query, sessionScanLimit(input.limit))
      .filter((session) => isChatSessionKind(session.kind))
      .slice(0, input.limit)
      .map(sessionToChatSummary),
  };
}

function sessionScanLimit(limit: number): number {
  return Math.max(limit, Math.min(MAX_SESSION_SCAN, limit * 4));
}

function isChatSessionKind(kind: string): kind is ChatSessionSummary["kind"] {
  return CHAT_SESSION_KINDS.has(kind);
}

function sessionToChatSummary(session: SessionRecord): ChatSessionSummary {
  if (!isChatSessionKind(session.kind)) {
    throw new Error(`Session is not a chat/query session: ${session.id}`);
  }
  return {
    id: session.id,
    title: session.title,
    kind: session.kind,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: session.status,
    model: session.model,
  };
}

function messageToChatSummary(message: MessageRecord): ChatMessageSummary {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ts: message.ts,
    toolCallId: message.toolCallId,
    toolCalls: message.toolCalls as BrowserJsonValue | null,
    attachments: message.attachments as BrowserJsonValue | null,
    usage: message.usage,
  };
}
