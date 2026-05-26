import path from "node:path";
import {
  defaultModel,
  getAnthropicCredentials,
  getChatGptCredentials,
  inferDefaultProvider,
  listModels,
  parseModelProvider,
} from "@strata/agent";

import { findRepoFiles } from "@strata/core/repo-files";
import { SessionStore } from "@strata/core/session-store";
import { listSkills, readSkill, type SkillMetadata } from "@strata/core/skill-store";
import type { MessageRecord, SessionRecord } from "@strata/core/types";
import { repoRoot, runtimeEnv, type WebApiOptions } from "./runtime.js";
import type {
  BrowserJsonValue,
  ChatFilesListInput,
  ChatMessageSummary,
  ChatModelStatus,
  ChatModelSummary,
  ChatModelsListInput,
  ChatSessionDeleteInput,
  ChatSessionDeleteResult,
  ChatSessionDetail,
  ChatSessionForkInput,
  ChatSessionGetInput,
  ChatSessionSummary,
  ChatSessionsListInput,
  ChatSessionsSearchInput,
  ChatSkillEntry,
  ChatSkillInvocation,
  ChatSkillInvokeInput,
  ChatSkillsListInput,
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
  const anthropicCredentials = await getAnthropicCredentials(root);
  const status: ChatModelStatus = {
    provider,
    model,
    codexLoggedIn: credentials !== undefined,
    apiKeyConfigured: env.STRATA_API_KEY !== undefined || env.OPENAI_API_KEY !== undefined,
    anthropicLoggedIn: anthropicCredentials !== undefined,
  };
  if (credentials?.expiresAt !== undefined) {
    status.codexExpiresAt = credentials.expiresAt;
  }
  if (anthropicCredentials?.expiresAt !== undefined) {
    status.anthropicExpiresAt = anthropicCredentials.expiresAt;
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

export async function listChatSkills(
  input: ChatSkillsListInput,
  options: WebApiOptions,
): Promise<{ skills: ChatSkillEntry[] }> {
  const query = input.query.trim().toLowerCase();
  const skills = await listSkills(repoRoot(options));
  return {
    skills: skills
      .filter((skill) => skill.status === "active")
      .filter(
        (skill) =>
          query === "" ||
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query),
      )
      .slice(0, input.limit)
      .map(skillToChatEntry),
  };
}

export async function invokeChatSkill(
  input: ChatSkillInvokeInput,
  options: WebApiOptions,
): Promise<ChatSkillInvocation> {
  const root = repoRoot(options);
  const document = await readSkill(root, input.name);
  const trimmedArgs = input.args.trim();
  const location = path.resolve(root, document.metadata.path);
  const skillBlock = [
    `<skill name="${escapeXmlAttribute(document.metadata.name)}" location="${escapeXmlAttribute(location)}">`,
    `References are relative to ${path.dirname(location)}.`,
    "",
    stripFrontmatter(document.content).trim(),
    "</skill>",
  ].join("\n");
  return {
    name: document.metadata.name,
    prompt: trimmedArgs === "" ? skillBlock : `${skillBlock}\n\n${trimmedArgs}`,
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

export async function deleteChatSession(
  input: ChatSessionDeleteInput,
  getSessionStore: SessionStoreGetter,
): Promise<ChatSessionDeleteResult> {
  const store = await getSessionStore();
  const source = store.getSession(input.sessionId);
  if (source === undefined || !isChatSessionKind(source.kind)) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  if (source.status === "running") {
    throw new Error(`Cannot delete a running session: ${input.sessionId}`);
  }
  const result = await store.deleteSession(input.sessionId);
  return {
    id: result.id,
    title: result.title,
    traceMethod: result.traceMethod,
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

function skillToChatEntry(skill: SkillMetadata): ChatSkillEntry {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    disableModelInvocation: skill.disableModelInvocation,
  };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return content;
  }
  return content.slice(end + "\n---".length).replace(/^\s*\n/, "");
}

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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
