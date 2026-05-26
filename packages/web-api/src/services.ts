import { SessionStore } from "@strata/core/session-store";
import {
  configureGranola,
  disconnectGranola,
  getGranolaStatus,
} from "@strata/ingest/granola-connector";
import { SessionChangeFeed } from "./changeFeed.js";
import { createChatService } from "./chat.js";
import {
  chatModelStatus,
  deleteChatSession,
  forkChatSession,
  getChatSession,
  invokeChatSkill,
  listChatFiles,
  listChatModels,
  listChatSessions,
  listChatSkills,
  searchChatSessions,
} from "./chatServices.js";
import {
  connectorSummaries,
  runNotionSession,
  startNotionMcp,
  validateNotion,
} from "./connectorServices.js";
import {
  deleteMcpSettings,
  getMcpSettingsStatus,
  listMcpTools,
  updateMcpSettings,
} from "./mcpSettings.js";
import {
  completeModelAuth,
  disconnectModelAuth,
  getModelAuthStatus,
  startModelAuth,
} from "./modelAuth.js";

import { disconnectNotionMcp, getNotionMcpStatus, listNotionMcpTools } from "./notionMcp.js";
import { repoRoot, type WebApiOptions } from "./runtime.js";

import type {
  ChatQueueAddInput,
  ChatQueueTargetInput,
  GranolaConfigureRpcInput,
  WebApiServices,
} from "./trpc.js";
import { getWikiPage, getWikiTree } from "./wikiServices.js";

export interface WebApiServiceContainer extends WebApiServices {
  chat: ReturnType<typeof createChatService>;
  changes: SessionChangeFeed;
}

export function createWebApiServices(options: WebApiOptions = {}): WebApiServiceContainer {
  const chat = createChatService(options);
  let sessionStorePromise: Promise<SessionStore> | undefined;
  const getSessionStore = (): Promise<SessionStore> => {
    if (sessionStorePromise === undefined) {
      sessionStorePromise = SessionStore.open(repoRoot(options));
    }
    return sessionStorePromise;
  };
  const changes = new SessionChangeFeed(getSessionStore, undefined, repoRoot(options));
  return {
    chat,
    changes,
    health: () => ({
      ok: true,
      repoRoot: repoRoot(options),
    }),
    chatModelStatus: () => chatModelStatus(options),
    listChatModels: (input) => listChatModels(input, options),
    listChatFiles: (input) => listChatFiles(input, options),
    listChatSkills: (input) => listChatSkills(input, options),
    invokeChatSkill: (input) => invokeChatSkill(input, options),
    listActiveChatRuns: () => ({ runs: chat.listActiveRuns() }),
    getChatRun: (input) => ({ run: chat.getRun(input.runId) ?? null }),
    listChatQueuedMessages: (input) => ({ messages: chat.listQueuedMessages(queueTarget(input)) }),
    addChatQueuedMessage: (input) => chat.addQueuedMessage(queueAddInput(input)),
    removeChatQueuedMessage: (input) =>
      chat.removeQueuedMessage(input.id).then((removed) => ({ removed })),
    clearChatQueuedMessages: (input) =>
      chat.clearQueuedMessages(queueTarget(input)).then((removed) => ({ removed })),
    listChatSessions: (input) => listChatSessions(input, getSessionStore),
    getChatSession: (input) => getChatSession(input, getSessionStore),
    forkChatSession: (input) => forkChatSession(input, getSessionStore),
    deleteChatSession: (input) => {
      const activeRun = chat.getActiveRunForSession(input.sessionId);
      if (activeRun !== undefined) {
        throw new Error(`Cannot delete a session with an active run: ${input.sessionId}`);
      }
      return deleteChatSession(input, getSessionStore);
    },
    searchChatSessions: (input) => searchChatSessions(input, getSessionStore),
    getWikiTree: (input) => getWikiTree(input, options),
    getWikiPage: (input) => getWikiPage(input, options),

    modelAuthStatus: () => getModelAuthStatus(options),
    startModelAuth: (input) => startModelAuth(input, input.origin, options),
    completeModelAuth: async (input) => {
      await completeModelAuth(input, options);
      return getModelAuthStatus(options);
    },
    disconnectModelAuth: (input) => disconnectModelAuth(input.provider, options),

    mcpSettingsStatus: () => getMcpSettingsStatus(options),
    updateMcpSettings: (input) => updateMcpSettings(input, options),
    deleteMcpSettings: (input) => deleteMcpSettings(input, options),
    listMcpTools: (input) => listMcpTools(input, options),

    connectorSummaries: () => connectorSummaries(options),

    validateNotion: (config) => validateNotion(config, options),
    runNotionSession: (operation, config) => runNotionSession(operation, config, options),
    notionMcpStatus: () => getNotionMcpStatus(options),
    startNotionMcp: (input) => startNotionMcp(input, options),
    listNotionMcpTools: async () => ({ tools: await listNotionMcpTools(options) }),
    disconnectNotionMcp: () => disconnectNotionMcp(options),
    granolaStatus: () => getGranolaStatus(options),
    configureGranola: (input: GranolaConfigureRpcInput) => configureGranola(input, options),
    disconnectGranola: () => disconnectGranola(options),
  };
}

function queueTarget(input: ChatQueueTargetInput): { sessionId?: string; runId?: string } {
  return {
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    ...(input.runId === undefined ? {} : { runId: input.runId }),
  };
}

function queueAddInput(input: ChatQueueAddInput) {
  return {
    ...queueTarget(input),
    id: input.id,
    message: input.message,
    attachments: input.attachments,
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
  };
}

export {
  chatModelStatus,
  deleteChatSession,
  forkChatSession,
  getChatSession,
  invokeChatSkill,
  listChatFiles,
  listChatModels,
  listChatSessions,
  listChatSkills,
  searchChatSessions,
} from "./chatServices.js";
export {
  connectorSummaries,
  runNotionSession,
  startNotionMcp,
  validateNotion,
} from "./connectorServices.js";
// Public re-exports for callers that imported these directly from `services.js`
// before the split. The new homes are `runtime.ts`, `chatServices.ts`, and
// `connectorServices.ts` — but `services.ts` remains the documented entry point
// of the package so existing imports keep working.
export { repoRoot, runtime, runtimeEnv, type WebApiOptions } from "./runtime.js";
