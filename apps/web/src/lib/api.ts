import type { AppRouter } from "@strata/web-api/trpc";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
    }),
  ],
});

type RouterOutput = inferRouterOutputs<AppRouter>;
type RouterInput = inferRouterInputs<AppRouter>;

export type ConnectorSummary = RouterOutput["connectors"]["list"]["connectors"][number];
export type NotionMcpStatus = RouterOutput["connectors"]["notion"]["mcp"]["status"];
export type NotionMcpStartResult = RouterOutput["connectors"]["notion"]["mcp"]["start"];
export type NotionMcpToolsResult = RouterOutput["connectors"]["notion"]["mcp"]["listTools"];
export type GranolaStatus = RouterOutput["connectors"]["granola"]["status"];
export type GranolaConfigureInput = RouterInput["connectors"]["granola"]["configure"];
export type ModelAuthStatus = RouterOutput["auth"]["models"]["status"];
export type ModelAuthProviderStatus = ModelAuthStatus["providers"][number];
export type ModelAuthProviderName = ModelAuthProviderStatus["provider"];
export type ModelAuthStartResult = RouterOutput["auth"]["models"]["start"];
export type McpSettingsStatus = RouterOutput["mcps"]["status"];
export type McpServerStatus = McpSettingsStatus["servers"][number];
export type McpSettingsUpdateInput = RouterInput["mcps"]["update"];
export type McpToolSummary = RouterOutput["mcps"]["tools"]["list"]["tools"][number];
export type ChatModelStatus = RouterOutput["chat"]["models"]["status"];

export type ChatModelSummary = RouterOutput["chat"]["models"]["list"]["models"][number];
export type ChatFileEntry = RouterOutput["chat"]["files"]["list"]["entries"][number];
export type ChatSkillEntry = RouterOutput["chat"]["skills"]["list"]["skills"][number];
export type ChatSkillInvocation = RouterOutput["chat"]["skills"]["invoke"];
export type ChatActiveRunSummary = RouterOutput["chat"]["runs"]["active"]["runs"][number];
export type ChatRunSummary = NonNullable<RouterOutput["chat"]["runs"]["get"]["run"]>;
export type ChatQueuedMessageSummary = RouterOutput["chat"]["queue"]["list"]["messages"][number];
export type ChatQueuedMessageAddInput = RouterInput["chat"]["queue"]["add"];
export type ChatQueueTargetInput = RouterInput["chat"]["queue"]["list"];
export type ChatQueueTarget = { sessionId?: string; runId?: string };
export type ChatSessionSummary = RouterOutput["chat"]["sessions"]["list"]["sessions"][number];
export type ChatSessionDetail = NonNullable<RouterOutput["chat"]["sessions"]["get"]>;
export type ChatSessionDeleteResult = RouterOutput["chat"]["sessions"]["delete"];
export type ChatMessageSummary = ChatSessionDetail["messages"][number];
export type WikiTreeEntry = RouterOutput["wiki"]["tree"]["tree"][number];
export type WikiPageDetail = RouterOutput["wiki"]["page"];

export interface ChatImageAttachment {
  kind: "image";
  mimeType: string;
  dataBase64: string;
  name?: string;
}

export interface StartChatRunRequest {
  message: string;
  continueSessionId?: string;
  model?: string;
  provider?: "openai-codex" | "openai-compatible" | "anthropic-claude";

  reasoningEffort?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  attachments?: ChatImageAttachment[];
}

import type { ChatRunEvent } from "@strata/web-api/chat-events";

export type { ChatRunEvent as ChatStreamEvent } from "@strata/web-api/chat-events";

export interface ChatStreamEventMeta {
  id: number | null;
}

type ChatStreamEvent = ChatRunEvent;

export async function getConnectors(): Promise<ConnectorSummary[]> {
  const body = await trpc.connectors.list.query();
  return body.connectors;
}

export async function getNotionMcpStatus(): Promise<NotionMcpStatus> {
  return trpc.connectors.notion.mcp.status.query();
}

export async function startNotionMcpAuth(origin: string): Promise<NotionMcpStartResult> {
  return trpc.connectors.notion.mcp.start.mutate({ origin });
}

export async function listNotionMcpTools(): Promise<NotionMcpToolsResult> {
  return trpc.connectors.notion.mcp.listTools.query();
}

export async function disconnectNotionMcp(): Promise<NotionMcpStatus> {
  return trpc.connectors.notion.mcp.disconnect.mutate();
}

export async function getGranolaStatus(): Promise<GranolaStatus> {
  return trpc.connectors.granola.status.query();
}

export async function configureGranola(input: GranolaConfigureInput): Promise<GranolaStatus> {
  return trpc.connectors.granola.configure.mutate(input);
}

export async function disconnectGranola(): Promise<GranolaStatus> {
  return trpc.connectors.granola.disconnect.mutate();
}

export async function getModelAuthStatus(): Promise<ModelAuthStatus> {
  return trpc.auth.models.status.query();
}

export async function startModelAuth(
  provider: ModelAuthProviderName,
  origin: string,
): Promise<ModelAuthStartResult> {
  return trpc.auth.models.start.mutate({ provider, origin });
}

export async function completeModelAuth(
  provider: ModelAuthProviderName,
  authorizationResponse: string,
): Promise<ModelAuthStatus> {
  return trpc.auth.models.complete.mutate({ provider, authorizationResponse });
}

export async function disconnectModelAuth(
  provider: ModelAuthProviderName,
): Promise<ModelAuthStatus> {
  return trpc.auth.models.disconnect.mutate({ provider });
}

export async function getMcpSettingsStatus(): Promise<McpSettingsStatus> {
  return trpc.mcps.status.query();
}

export async function updateMcpSettings(input: McpSettingsUpdateInput): Promise<McpSettingsStatus> {
  return trpc.mcps.update.mutate(input);
}

export async function deleteMcpSettings(slug: string): Promise<McpSettingsStatus> {
  return trpc.mcps.delete.mutate({ slug });
}

export async function listMcpTools(slug: string, serverUrl?: string): Promise<McpToolSummary[]> {
  const body = await trpc.mcps.tools.list.query({
    slug,
    ...(serverUrl === undefined ? {} : { serverUrl }),
  });
  return body.tools;
}

export async function getChatModelStatus(): Promise<ChatModelStatus> {
  return trpc.chat.models.status.query();
}

export async function listChatModels(
  provider: NonNullable<StartChatRunRequest["provider"]>,
): Promise<ChatModelSummary[]> {
  const body = await trpc.chat.models.list.query({ provider });
  return body.models;
}

export async function listChatFiles(query: string, limit = 20): Promise<ChatFileEntry[]> {
  const body = await trpc.chat.files.list.query({ query, limit });
  return body.entries;
}

export async function listChatSkills(query: string, limit = 40): Promise<ChatSkillEntry[]> {
  const body = await trpc.chat.skills.list.query({ query, limit });
  return body.skills;
}

export async function invokeChatSkill(name: string, args: string): Promise<ChatSkillInvocation> {
  return trpc.chat.skills.invoke.query({ name, args });
}

export async function listActiveChatRuns(): Promise<ChatActiveRunSummary[]> {
  const body = await trpc.chat.runs.active.query();
  return body.runs;
}

export async function getChatRun(runId: string): Promise<ChatRunSummary | null> {
  const body = await trpc.chat.runs.get.query({ runId });
  return body.run;
}

export async function listChatQueuedMessages(
  target: ChatQueueTarget,
): Promise<ChatQueuedMessageSummary[]> {
  const body = await trpc.chat.queue.list.query(target as ChatQueueTargetInput);
  return body.messages;
}

export async function addChatQueuedMessage(
  input: ChatQueuedMessageAddInput,
): Promise<ChatQueuedMessageSummary> {
  return trpc.chat.queue.add.mutate(input);
}

export async function removeChatQueuedMessage(id: string): Promise<boolean> {
  const body = await trpc.chat.queue.remove.mutate({ id });
  return body.removed;
}

export async function clearChatQueuedMessages(target: ChatQueueTarget): Promise<number> {
  const body = await trpc.chat.queue.clear.mutate(target as ChatQueueTargetInput);
  return body.removed;
}

export async function listChatSessions(limit = 20): Promise<ChatSessionSummary[]> {
  const body = await trpc.chat.sessions.list.query({ limit });
  return body.sessions;
}

export async function getChatSession(sessionId: string): Promise<ChatSessionDetail | null> {
  return trpc.chat.sessions.get.query({ sessionId });
}

export async function forkChatSession(sessionId: string): Promise<ChatSessionDetail> {
  return trpc.chat.sessions.fork.mutate({ sessionId });
}

export async function deleteChatSession(sessionId: string): Promise<ChatSessionDeleteResult> {
  return trpc.chat.sessions.delete.mutate({ sessionId });
}

export async function searchChatSessions(query: string, limit = 20): Promise<ChatSessionSummary[]> {
  const body = await trpc.chat.sessions.search.query({ query, limit });
  return body.sessions;
}

export async function getWikiTree(includeRaw = false): Promise<WikiTreeEntry[]> {
  const body = await trpc.wiki.tree.query({ includeRaw });
  return body.tree;
}

export async function getWikiPage(path: string, includeRaw = false): Promise<WikiPageDetail> {
  return trpc.wiki.page.query({ path, includeRaw });
}

export async function startChatRun(
  input: StartChatRunRequest,
  onEvent: (event: ChatStreamEvent, meta: ChatStreamEventMeta) => void,
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch("/api/chat/runs", init);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  if (response.body === null) {
    throw new Error("Chat stream did not include a response body.");
  }

  await readChatEventStream(response.body, onEvent);
}

export async function streamChatRunEvents(
  runId: string,
  afterEventId: number,
  onEvent: (event: ChatStreamEvent, meta: ChatStreamEventMeta) => void,
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {};
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(
    `/api/chat/runs/${encodeURIComponent(runId)}/events?after=${afterEventId}`,
    init,
  );
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  if (response.body === null) {
    throw new Error("Chat replay stream did not include a response body.");
  }
  await readChatEventStream(response.body, onEvent);
}

async function readChatEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent, meta: ChatStreamEventMeta) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event !== null) {
        onEvent(event.event, event.meta);
      }
    }
  }
  buffer += decoder.decode();
  const finalEvent = parseSseFrame(buffer);
  if (finalEvent !== null) {
    onEvent(finalEvent.event, finalEvent.meta);
  }
}

/** Notice from the local change feed that some sessions advanced. */
export interface SessionChangeNotice {
  sessionIds: string[];
  maxEventId: number;
  queue?: {
    sessionIds: string[];
    runIds: string[];
    maxQueueChangeId: number;
  };
}

/**
 * Subscribe to the local realtime change feed (`GET /api/changes`). Resolves
 * when the stream ends; callers reconnect. Each notice names sessions and/or
 * web-chat queues that changed anywhere (this tab, another tab, or the CLI/TUI).
 */
export async function streamSessionChanges(
  onNotice: (notice: SessionChangeNotice) => void,
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {};
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch("/api/changes", init);
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  if (response.body === null) {
    throw new Error("Change feed did not include a response body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = (frame: string): void => {
    const dataLine = frame
      .trim()
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (dataLine === undefined) {
      return;
    }
    try {
      onNotice(JSON.parse(dataLine.slice("data: ".length)) as SessionChangeNotice);
    } catch {
      // Ignore malformed frames (e.g. heartbeats).
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      emit(frame);
    }
  }
}

export async function cancelChatRun(runId: string): Promise<boolean> {
  const response = await fetch(`/api/chat/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  return true;
}

function parseSseFrame(
  frame: string,
): { event: ChatStreamEvent; meta: ChatStreamEventMeta } | null {
  const trimmed = frame.trim();
  if (trimmed === "") {
    return null;
  }
  const idLine = trimmed.split("\n").find((line) => line.startsWith("id: "));
  const eventId = idLine === undefined ? null : Number.parseInt(idLine.slice("id: ".length), 10);
  const dataLines = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length));
  if (dataLines.length === 0) {
    return null;
  }
  return {
    event: JSON.parse(dataLines.join("\n")) as ChatStreamEvent,
    meta: { id: eventId !== null && Number.isFinite(eventId) ? eventId : null },
  };
}

async function responseErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text === "") {
    return `Request failed with HTTP ${response.status}`;
  }
  try {
    const payload = JSON.parse(text) as { error?: { message?: unknown } };
    if (typeof payload.error?.message === "string") {
      return payload.error.message;
    }
  } catch {
    // Fall through to plain text.
  }
  return text.slice(0, 500);
}
