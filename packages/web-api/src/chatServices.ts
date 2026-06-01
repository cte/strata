import path from "node:path";
import {
  defaultModel,
  getAnthropicCredentials,
  getChatGptCredentials,
  getModelApiKey,
  inferDefaultProvider,
  listModels,
  parseModelProvider,
} from "@strata/agent";

import { findRepoFiles } from "@strata/core/repo-files";
import { SessionStore } from "@strata/core/session-store";
import { listSkills, readSkill, type SkillMetadata } from "@strata/core/skill-store";
import type { MessagePageOptions, MessageRecord, SessionRecord } from "@strata/core/types";
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
  ChatSessionRenameInput,
  ChatSessionSummary,
  ChatSessionsListInput,
  ChatSessionsSearchInput,
  ChatSkillEntry,
  ChatSkillInvocation,
  ChatSkillInvokeInput,
  ChatSkillsListInput,
  ChatToolCallSummary,
  ChatToolResultDetail,
  ChatToolResultGetInput,
  ChatToolStatus,
} from "./trpc.js";

const CHAT_SESSION_KIND_LIST = ["chat", "query"] as const;
const CHAT_SESSION_KINDS = new Set<string>(CHAT_SESSION_KIND_LIST);

export type SessionStoreGetter = () => Promise<SessionStore>;

export async function chatModelStatus(options: WebApiOptions): Promise<ChatModelStatus> {
  const root = repoRoot(options);
  const env = runtimeEnv(options);
  const provider =
    parseModelProvider(env.STRATA_PROVIDER) ??
    (await inferDefaultProvider({ repoRoot: root, env }));
  const model = defaultModel(provider, { env });
  const [credentials, anthropicCredentials, openaiKey, anthropicKey] = await Promise.all([
    getChatGptCredentials(root),
    getAnthropicCredentials(root),
    getModelApiKey("openai", root),
    getModelApiKey("anthropic", root),
  ]);
  const status: ChatModelStatus = {
    provider,
    model,
    codexLoggedIn: credentials !== undefined,
    apiKeyConfigured:
      openaiKey !== undefined ||
      env.STRATA_API_KEY !== undefined ||
      env.OPENAI_API_KEY !== undefined,
    anthropicLoggedIn: anthropicCredentials !== undefined,
    anthropicApiKeyConfigured: anthropicKey !== undefined,
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
    sessions: store.listSessions(input.limit, CHAT_SESSION_KIND_LIST).map(sessionToChatSummary),
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
  const pageOptions: MessagePageOptions = {};
  if (input.messageLimit !== undefined) {
    pageOptions.displayLimit = input.messageLimit;
  }
  if (input.beforeMessageId !== undefined) {
    pageOptions.beforeMessageId = input.beforeMessageId;
  }
  const messagePage = store.listMessagePage(session.id, pageOptions);
  return {
    session: sessionToChatSummary(session),
    messages: messagesToChatSummaries(messagePage.messages),
    messagePage: {
      hasMoreBefore: messagePage.hasMoreBefore,
      oldestDisplayMessageId: messagePage.oldestDisplayMessageId,
    },
  };
}

export async function getChatToolResult(
  input: ChatToolResultGetInput,
  getSessionStore: SessionStoreGetter,
): Promise<ChatToolResultDetail | null> {
  const store = await getSessionStore();
  const session = store.getSession(input.sessionId);
  if (session === undefined || !isChatSessionKind(session.kind)) {
    return null;
  }
  const message = store.getToolResultMessage(input.sessionId, input.toolCallId);
  if (message === undefined) {
    return null;
  }
  const summary = summarizeToolResult(message, undefined);
  return {
    sessionId: input.sessionId,
    toolCallId: input.toolCallId,
    content: message.content,
    status: summary.status,
    summary: summary.summary,
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
    messages: messagesToChatSummaries(store.listMessages(cloned.id)),
    messagePage: {
      hasMoreBefore: false,
      oldestDisplayMessageId: null,
    },
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

export async function renameChatSession(
  input: ChatSessionRenameInput,
  getSessionStore: SessionStoreGetter,
): Promise<ChatSessionSummary> {
  const store = await getSessionStore();
  const source = store.getSession(input.sessionId);
  if (source === undefined || !isChatSessionKind(source.kind)) {
    throw new Error(`Session not found: ${input.sessionId}`);
  }
  store.updateSessionTitle(input.sessionId, input.title);
  return sessionToChatSummary({ ...source, title: input.title });
}

export async function searchChatSessions(
  input: ChatSessionsSearchInput,
  getSessionStore: SessionStoreGetter,
): Promise<{ sessions: ChatSessionSummary[] }> {
  const store = await getSessionStore();
  return {
    sessions: store
      .searchSessions(input.query, input.limit, CHAT_SESSION_KIND_LIST)
      .map(sessionToChatSummary),
  };
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

interface ToolCallMetadata {
  name: string;
  argumentsText: string;
  args: Record<string, unknown> | null;
}

interface ToolResultSummary {
  status: ChatToolStatus;
  summary: string | null;
}

function messagesToChatSummaries(messages: MessageRecord[]): ChatMessageSummary[] {
  const metadata = collectToolCallMetadata(messages);
  const results = new Map<string, ToolResultSummary>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId !== null) {
      results.set(
        message.toolCallId,
        summarizeToolResult(message, metadata.get(message.toolCallId)),
      );
    }
  }
  return messages
    .filter((message) => message.role !== "tool")
    .map((message) => messageToChatSummary(message, metadata, results));
}

function collectToolCallMetadata(messages: MessageRecord[]): Map<string, ToolCallMetadata> {
  const metadata = new Map<string, ToolCallMetadata>();
  for (const message of messages) {
    if (!Array.isArray(message.toolCalls)) {
      continue;
    }
    for (const entry of message.toolCalls) {
      if (!isRecord(entry)) {
        continue;
      }
      const id = entry.id;
      const name = entry.name;
      const argumentsText = entry.argumentsText;
      if (typeof id !== "string" || typeof name !== "string") {
        continue;
      }
      const argsText = typeof argumentsText === "string" ? argumentsText : "";
      metadata.set(id, {
        name,
        argumentsText: argsText,
        args: parseRecord(argsText),
      });
    }
  }
  return metadata;
}

function messageToChatSummary(
  message: MessageRecord,
  metadata: Map<string, ToolCallMetadata>,
  results: Map<string, ToolResultSummary>,
): ChatMessageSummary {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ts: message.ts,
    toolCallId: message.toolCallId,
    toolCalls: summarizeToolCalls(message.toolCalls, metadata, results),
    attachments: message.attachments as BrowserJsonValue | null,
    usage: message.usage,
  };
}

function summarizeToolCalls(
  value: MessageRecord["toolCalls"],
  metadata: Map<string, ToolCallMetadata>,
  results: Map<string, ToolResultSummary>,
): ChatToolCallSummary[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const summaries: ChatToolCallSummary[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = entry.id;
    const name = entry.name;
    if (typeof id !== "string" || typeof name !== "string") {
      continue;
    }
    const meta = metadata.get(id) ?? {
      name,
      argumentsText: typeof entry.argumentsText === "string" ? entry.argumentsText : "",
      args: typeof entry.argumentsText === "string" ? parseRecord(entry.argumentsText) : null,
    };
    const result = results.get(id);
    summaries.push({
      id,
      name,
      argumentsText: meta.argumentsText,
      status: result?.status ?? "running",
      summary: result?.summary ?? summarizeToolCallFromArgs(name, meta.args),
      resultAvailable: result !== undefined,
    });
  }
  return summaries;
}

function summarizeToolResult(
  message: MessageRecord,
  metadata: ToolCallMetadata | undefined,
): ToolResultSummary {
  const parsed = parseJsonValue(message.content);
  if (!isRecord(parsed)) {
    return { status: "complete", summary: clipSummary(message.content) };
  }
  const ok = parsed.ok;
  if (ok === false) {
    const error = isRecord(parsed.error) ? parsed.error : {};
    return {
      status: "error",
      summary: clipSummary(stringValue(error.message) ?? "Tool failed."),
    };
  }
  const toolName = stringValue(parsed.toolName) ?? metadata?.name ?? "tool";
  const result = isRecord(parsed.result) ? parsed.result : null;
  return {
    status: "complete",
    summary:
      summarizeToolExecution(toolName, metadata?.args ?? null, result) ?? metadata?.name ?? null,
  };
}

function summarizeToolExecution(
  toolName: string,
  args: Record<string, unknown> | null,
  result: Record<string, unknown> | null,
): string | null {
  if (toolName === "wiki.search") {
    const query = stringValue(result?.query) ?? stringValue(args?.query);
    const count = numberValue(result?.count);
    return query === null
      ? null
      : count === null
        ? clipSummary(query)
        : `${clipSummary(query)} · ${count} match(es)`;
  }
  if (toolName === "fs.grep") {
    const pattern =
      stringValue(result?.pattern) ?? stringValue(args?.pattern) ?? stringValue(args?.query);
    const count = numberValue(result?.count);
    return pattern === null
      ? null
      : count === null
        ? clipSummary(pattern)
        : `${clipSummary(pattern)} · ${count} match(es)`;
  }
  if (toolName === "wiki.readPage" || toolName === "fs.read") {
    return clipSummary(stringValue(result?.path) ?? stringValue(args?.path));
  }
  if (toolName === "fs.edit" || toolName === "wiki.patchPage") {
    const targetPath = stringValue(result?.path) ?? stringValue(args?.path);
    const replacements = numberValue(result?.replacements);
    if (targetPath === null) {
      return null;
    }
    return replacements === null
      ? clipSummary(targetPath)
      : `${clipSummary(targetPath)} · ${replacements} replacement(s)`;
  }
  if (toolName === "shell.run") {
    const exitCode = numberValue(result?.exitCode);
    const command = stringValue(result?.command) ?? stringValue(args?.command);
    if (command === null) {
      return exitCode === null ? null : `exit ${exitCode}`;
    }
    const clippedCommand = clipSummary(command);
    return exitCode === null ? clippedCommand : `exit ${exitCode} · ${clippedCommand}`;
  }
  if (toolName === "memory.write" || toolName === "memory.append") {
    const document = recordValue(result?.document);
    return clipSummary(stringValue(document?.path) ?? stringValue(args?.target));
  }
  if (toolName === "todo.add" || toolName === "todo.update" || toolName === "todo.remove") {
    const item = recordValue(result?.item) ?? recordValue(result?.removed);
    const title = stringValue(item?.title) ?? stringValue(args?.title);
    const status = stringValue(item?.status);
    if (title === null) {
      return clipSummary(status);
    }
    return status === null ? clipSummary(title) : `${clipSummary(status)} · ${clipSummary(title)}`;
  }
  if (toolName === "skills.list") {
    const count = numberValue(result?.count);
    return count === null ? null : `${count} skill(s)`;
  }
  if (toolName === "skills.read") {
    const skill = recordValue(result?.skill);
    const skillMetadata = recordValue(skill?.metadata);
    return clipSummary(stringValue(skillMetadata?.name) ?? stringValue(args?.name));
  }
  return null;
}

function summarizeToolCallFromArgs(
  toolName: string,
  args: Record<string, unknown> | null,
): string | null {
  return summarizeToolExecution(toolName, args, null);
}

function parseRecord(value: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clipSummary(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= 180 ? collapsed : `${collapsed.slice(0, 177)}...`;
}
