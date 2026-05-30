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
export type ConnectorRunInput = RouterInput["connectors"]["run"];
export type ConnectorRunResult = RouterOutput["connectors"]["run"];
export type ConnectorConfigName = RouterInput["connectors"]["config"]["list"]["connector"];
export type ConnectorConfigProfilesResult = RouterOutput["connectors"]["config"]["list"];
export type ConnectorConfigProfile = ConnectorConfigProfilesResult["profiles"][number];
export type ConnectorConfigProfileSaveInput = RouterInput["connectors"]["config"]["save"];
export type NotionMcpStatus = RouterOutput["connectors"]["notion"]["mcp"]["status"];
export type NotionMcpStartResult = RouterOutput["connectors"]["notion"]["mcp"]["start"];
export type NotionMcpToolsResult = RouterOutput["connectors"]["notion"]["mcp"]["listTools"];
export type GranolaStatus = RouterOutput["connectors"]["granola"]["status"];
export type GranolaConfigureInput = RouterInput["connectors"]["granola"]["configure"];
export type ModelAuthStatus = RouterOutput["auth"]["models"]["status"];
export type ModelAuthProviderStatus = ModelAuthStatus["providers"][number];
export type ModelAuthProviderName = ModelAuthProviderStatus["provider"];
export type ModelAuthStartResult = RouterOutput["auth"]["models"]["start"];
export type ModelApiKeyStatus = ModelAuthStatus["apiKeys"][number];
export type ModelApiKeyTarget = ModelApiKeyStatus["target"];
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
export type WikiActionItem = RouterOutput["wiki"]["actions"]["list"]["actions"][number];
export type WikiActionOwnerFilter = NonNullable<RouterInput["wiki"]["actions"]["list"]["owner"]>;
export type WikiActionStatusFilter = NonNullable<RouterInput["wiki"]["actions"]["list"]["status"]>;
export type WikiActionAddInput = RouterInput["wiki"]["actions"]["add"];
export type WikiActionUpdateInput = RouterInput["wiki"]["actions"]["update"];
export type IngestActivityRun = RouterOutput["activity"]["list"]["runs"][number];
export type IngestActivityDetail = NonNullable<RouterOutput["activity"]["get"]>;
export type IngestActivityItem = IngestActivityDetail["items"][number];
export type IngestActivitySource = RouterInput["activity"]["list"]["source"];
export type IngestActivityResultFilter = NonNullable<
  RouterInput["activity"]["list"]["resultFilters"]
>[number];
export type ProposalSummary = RouterOutput["proposals"]["list"]["proposals"][number];
export type ProposalDetail = NonNullable<RouterOutput["proposals"]["get"]>;
export type ProposalStatusFilter = RouterInput["proposals"]["list"]["status"];
export type ProposalKindFilter = RouterInput["proposals"]["list"]["kind"];
export type ProposalActionResult = RouterOutput["proposals"]["accept"];
export type ProposalStatusResult = RouterOutput["proposals"]["defer"];
export type RoutineSummary = RouterOutput["routines"]["list"]["routines"][number];
export type RoutineDetail = NonNullable<RouterOutput["routines"]["get"]["routine"]>;
export type RoutineRunRecord = RouterOutput["routines"]["runs"]["list"]["runs"][number];
export type RoutineArtifactRecord =
  RouterOutput["routines"]["artifacts"]["list"]["artifacts"][number];
export type RoutineRunResult = RouterOutput["routines"]["run"];
export type RoutineStatusFilter = RouterInput["routines"]["list"]["status"];
export type RoutineRunInput = RouterInput["routines"]["run"];
export type RoutineCreateInput = RouterInput["routines"]["create"];
export type RoutineUpdateInput = RouterInput["routines"]["update"];
export type RoutineStatus = RouterInput["routines"]["setStatus"]["status"];
export type RoutineTemplateSummary =
  RouterOutput["routines"]["templates"]["list"]["templates"][number];
export type JobMetadata = RouterOutput["jobs"]["list"]["jobs"][number];
export type RoutineTrigger = RouterOutput["routines"]["triggers"]["list"]["triggers"][number];
export type RoutineTriggerCreateInput = RouterInput["routines"]["triggers"]["create"];
export type RoutineTriggerUpdateInput = RouterInput["routines"]["triggers"]["update"];
export type RoutineTriggerRunResult = RouterOutput["routines"]["triggers"]["runNow"];
export type RetrievalIndexStatus = RouterOutput["system"]["retrievalIndex"]["status"];
export type RetrievalIndexRefreshInput = RouterInput["system"]["retrievalIndex"]["refresh"];
export type RetrievalIndexRefreshResult = RouterOutput["system"]["retrievalIndex"]["refresh"];

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

export async function runConnector(input: ConnectorRunInput): Promise<ConnectorRunResult> {
  return trpc.connectors.run.mutate(input);
}

export async function getConnectorConfigProfiles(
  connector: ConnectorConfigName,
): Promise<ConnectorConfigProfilesResult> {
  return trpc.connectors.config.list.query({ connector });
}

export async function saveConnectorConfigProfile(
  input: ConnectorConfigProfileSaveInput,
): Promise<ConnectorConfigProfilesResult> {
  return trpc.connectors.config.save.mutate(input);
}

export async function deleteConnectorConfigProfile(
  connector: ConnectorConfigName,
  id: string,
): Promise<ConnectorConfigProfilesResult> {
  return trpc.connectors.config.delete.mutate({ connector, id });
}

export async function setDefaultConnectorConfigProfile(
  connector: ConnectorConfigName,
  id: string,
): Promise<ConnectorConfigProfilesResult> {
  return trpc.connectors.config.setDefault.mutate({ connector, id });
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

export async function setModelApiKey(input: {
  target: ModelApiKeyTarget;
  apiKey: string;
  baseUrl?: string;
}): Promise<ModelAuthStatus> {
  return trpc.auth.models.setApiKey.mutate(input);
}

export async function clearModelApiKey(target: ModelApiKeyTarget): Promise<ModelAuthStatus> {
  return trpc.auth.models.clearApiKey.mutate({ target });
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

export async function listWikiActions(input: {
  owner?: WikiActionOwnerFilter;
  status?: WikiActionStatusFilter;
  query?: string;
}): Promise<WikiActionItem[]> {
  const body = await trpc.wiki.actions.list.query(input);
  return body.actions;
}

export async function updateWikiAction(input: WikiActionUpdateInput): Promise<WikiActionItem> {
  const body = await trpc.wiki.actions.update.mutate(input);
  return body.action;
}

export async function addWikiAction(input: WikiActionAddInput): Promise<WikiActionItem> {
  const body = await trpc.wiki.actions.add.mutate(input);
  return body.action;
}

export async function deleteWikiAction(id: string): Promise<{ deleted: boolean }> {
  return trpc.wiki.actions.delete.mutate({ id });
}

export async function listIngestActivity(input: {
  limit?: number;
  source?: IngestActivitySource;
  resultFilters?: IngestActivityResultFilter[];
  writesOrIndexesOnly?: boolean;
}): Promise<IngestActivityRun[]> {
  const body = await trpc.activity.list.query(input);
  return body.runs;
}

export async function getIngestActivity(
  sessionId: string,
  itemLimit = 200,
  resultFilters?: IngestActivityResultFilter[],
): Promise<IngestActivityDetail | null> {
  return trpc.activity.get.query({ sessionId, itemLimit, resultFilters });
}

export type TaxonomyReviewItem =
  RouterOutput["ingest"]["taxonomy"]["review"]["list"]["items"][number];
export type TaxonomyReviewCorrectInput = RouterInput["ingest"]["taxonomy"]["review"]["correct"];

export async function listTaxonomyReview(input: {
  source?: "all" | "granola" | "slack" | "notion";
  limit?: number;
}): Promise<TaxonomyReviewItem[]> {
  const body = await trpc.ingest.taxonomy.review.list.query(input);
  return body.items;
}

export async function correctTaxonomyReview(
  input: TaxonomyReviewCorrectInput,
): Promise<RouterOutput["ingest"]["taxonomy"]["review"]["correct"]> {
  return trpc.ingest.taxonomy.review.correct.mutate(input);
}

export async function listProposals(input: {
  status?: ProposalStatusFilter;
  kind?: ProposalKindFilter;
  limit?: number;
}): Promise<ProposalSummary[]> {
  const body = await trpc.proposals.list.query(input);
  return body.proposals;
}

export async function getProposal(id: string): Promise<ProposalDetail | null> {
  return trpc.proposals.get.query({ id });
}

export async function acceptProposal(
  id: string,
  reason?: string,
  previewFingerprint?: string,
): Promise<ProposalActionResult> {
  return trpc.proposals.accept.mutate({
    id,
    ...(reason === undefined || reason.trim() === "" ? {} : { reason: reason.trim() }),
    ...(previewFingerprint === undefined ? {} : { previewFingerprint }),
  });
}

export async function rejectProposal(id: string, reason?: string): Promise<ProposalStatusResult> {
  return trpc.proposals.reject.mutate({
    id,
    ...(reason === undefined || reason.trim() === "" ? {} : { reason: reason.trim() }),
  });
}

export async function deferProposal(id: string, reason?: string): Promise<ProposalStatusResult> {
  return trpc.proposals.defer.mutate({
    id,
    ...(reason === undefined || reason.trim() === "" ? {} : { reason: reason.trim() }),
  });
}

export async function listRoutines(
  input: { status?: RoutineStatusFilter; limit?: number } = {},
): Promise<RoutineSummary[]> {
  const body = await trpc.routines.list.query(input);
  return body.routines;
}

export async function getRoutine(id: string): Promise<RoutineDetail | null> {
  const body = await trpc.routines.get.query({ id });
  return body.routine;
}

export async function runRoutine(input: RoutineRunInput): Promise<RoutineRunResult> {
  return trpc.routines.run.mutate(input);
}

export async function createRoutine(input: RoutineCreateInput): Promise<RoutineDetail> {
  const body = await trpc.routines.create.mutate(input);
  return body.routine;
}

export async function listRoutineTemplates(): Promise<RoutineTemplateSummary[]> {
  const body = await trpc.routines.templates.list.query();
  return body.templates;
}

export async function createRoutineFromTemplate(key: string): Promise<RoutineDetail> {
  const body = await trpc.routines.templates.create.mutate({ key });
  return body.routine;
}

export async function updateRoutine(input: RoutineUpdateInput): Promise<RoutineDetail> {
  const body = await trpc.routines.update.mutate(input);
  return body.routine;
}

export async function setRoutineStatus(id: string, status: RoutineStatus): Promise<RoutineDetail> {
  const body = await trpc.routines.setStatus.mutate({ id, status });
  return body.routine;
}

export async function deleteRoutine(id: string): Promise<boolean> {
  const body = await trpc.routines.delete.mutate({ id });
  return body.deleted;
}

export async function listRoutineRuns(
  input: { routineId?: string; limit?: number } = {},
): Promise<RoutineRunRecord[]> {
  const body = await trpc.routines.runs.list.query(input);
  return body.runs;
}

export async function listRoutineArtifacts(
  input: { routineId?: string; routineRunId?: string; limit?: number } = {},
): Promise<RoutineArtifactRecord[]> {
  const body = await trpc.routines.artifacts.list.query(input);
  return body.artifacts;
}

export async function listJobs(): Promise<JobMetadata[]> {
  const body = await trpc.jobs.list.query();
  return body.jobs;
}

export async function listRoutineTriggers(routineId: string): Promise<RoutineTrigger[]> {
  const body = await trpc.routines.triggers.list.query({ routineId });
  return body.triggers;
}

export async function createRoutineTrigger(
  input: RoutineTriggerCreateInput,
): Promise<RoutineTrigger> {
  const body = await trpc.routines.triggers.create.mutate(input);
  return body.trigger;
}

export async function updateRoutineTrigger(
  input: RoutineTriggerUpdateInput,
): Promise<RoutineTrigger> {
  const body = await trpc.routines.triggers.update.mutate(input);
  return body.trigger;
}

export async function deleteRoutineTrigger(id: string): Promise<boolean> {
  const body = await trpc.routines.triggers.delete.mutate({ id });
  return body.deleted;
}

export async function runRoutineTriggerNow(id: string): Promise<RoutineTriggerRunResult> {
  return trpc.routines.triggers.runNow.mutate({ id });
}

export async function getRetrievalIndexStatus(): Promise<RetrievalIndexStatus> {
  return trpc.system.retrievalIndex.status.query();
}

export async function refreshRetrievalIndex(
  input: RetrievalIndexRefreshInput,
): Promise<RetrievalIndexRefreshResult> {
  return trpc.system.retrievalIndex.refresh.mutate(input);
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
