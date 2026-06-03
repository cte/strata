import { SessionStore } from "@strata/core/session-store";
import {
  configureGranola,
  disconnectGranola,
  getGranolaStatus,
} from "@strata/ingest/granola-connector";
import {
  addWikiActionForWeb,
  deleteWikiActionForWeb,
  listWikiActionsForWeb,
  updateWikiActionForWeb,
} from "./actionServices.js";
import { getIngestActivityForWeb, listIngestActivityForWeb } from "./activityServices.js";
import { SessionChangeFeed } from "./changeFeed.js";
import { createChatService } from "./chat.js";
import {
  chatModelStatus,
  compactChatSession,
  deleteChatSession,
  forkChatSession,
  getChatSession,
  getChatToolResult,
  invokeChatSkill,
  listChatFiles,
  listChatModels,
  listChatSessions,
  listChatSkills,
  renameChatSession,
  searchChatSessions,
} from "./chatServices.js";
import {
  connectorSummaries,
  deleteConnectorConfigProfileForWeb,
  listConnectorConfigProfilesForWeb,
  runConnectorSession,
  runNotionSession,
  saveConnectorConfigProfileForWeb,
  setDefaultConnectorConfigProfileForWeb,
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
  clearModelApiKey,
  completeModelAuth,
  disconnectModelAuth,
  getModelAuthStatus,
  setModelApiKey,
  startModelAuth,
} from "./modelAuth.js";

import { disconnectNotionMcp, getNotionMcpStatus, listNotionMcpTools } from "./notionMcp.js";
import {
  applyProposalFromWeb,
  deferProposalFromWeb,
  getProposalForWeb,
  listProposalsForWeb,
  rejectProposalFromWeb,
} from "./proposalServices.js";
import {
  getRetrievalIndexStatusForWeb,
  refreshRetrievalIndexForWeb,
} from "./retrievalIndexServices.js";
import {
  createRoutineForWeb,
  createRoutineFromTemplateForWeb,
  createRoutineTriggerForWeb,
  deleteRoutineForWeb,
  deleteRoutineTriggerForWeb,
  getRoutineForWeb,
  listRoutineArtifactsForWeb,
  listRoutineRunsForWeb,
  listRoutinesForWeb,
  listRoutineTemplatesForWeb,
  listRoutineTriggersForWeb,
  runRoutineForWeb,
  runRoutineTriggerNowFromWeb,
  setRoutineStatusForWeb,
  updateRoutineForWeb,
  updateRoutineTriggerForWeb,
} from "./routineServices.js";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import { correctTaxonomyReviewForWeb, listTaxonomyReviewForWeb } from "./taxonomyReviewServices.js";

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
    moveChatQueuedMessage: (input) =>
      chat.moveQueuedMessage(input.id, input.beforeId).then((message) => ({ message })),
    setChatQueuedMessageDelivery: (input) =>
      chat.setQueuedMessageDelivery(input.id, input.delivery).then((message) => ({ message })),
    clearChatQueuedMessages: (input) =>
      chat.clearQueuedMessages(queueTarget(input)).then((removed) => ({ removed })),
    listChatSessions: (input) => listChatSessions(input, getSessionStore),
    getChatSession: (input) => getChatSession(input, getSessionStore),
    getChatToolResult: (input) => getChatToolResult(input, getSessionStore),
    forkChatSession: (input) => forkChatSession(input, getSessionStore),
    compactChatSession: (input) => {
      const activeRun = chat.getActiveRunForSession(input.sessionId);
      if (activeRun !== undefined) {
        throw new Error(`Cannot compact a session with an active run: ${input.sessionId}`);
      }
      return compactChatSession(input, getSessionStore, options);
    },
    deleteChatSession: (input) => {
      const activeRun = chat.getActiveRunForSession(input.sessionId);
      if (activeRun !== undefined) {
        throw new Error(`Cannot delete a session with an active run: ${input.sessionId}`);
      }
      return deleteChatSession(input, getSessionStore);
    },
    renameChatSession: (input) => renameChatSession(input, getSessionStore),
    searchChatSessions: (input) => searchChatSessions(input, getSessionStore),
    getWikiTree: (input) => getWikiTree(input, options),
    getWikiPage: (input) => getWikiPage(input, options),
    listWikiActions: (input) => listWikiActionsForWeb(input, options),
    updateWikiAction: (input) => updateWikiActionForWeb(input, options),
    addWikiAction: (input) => addWikiActionForWeb(input, options),
    deleteWikiAction: (input) => deleteWikiActionForWeb(input, options),
    listIngestActivity: (input) => listIngestActivityForWeb(input, options),
    getIngestActivity: (input) => getIngestActivityForWeb(input, options),
    listTaxonomyReview: (input) => listTaxonomyReviewForWeb(input, options),
    correctTaxonomyReview: (input) => correctTaxonomyReviewForWeb(input, options),
    listProposals: (input) => listProposalsForWeb(input, options),
    getProposal: (input) => getProposalForWeb(input, options),
    applyProposal: (input) => applyProposalFromWeb(input, options),
    rejectProposal: (input) => rejectProposalFromWeb(input, options),
    deferProposal: (input) => deferProposalFromWeb(input, options),
    listRoutines: (input) => listRoutinesForWeb(input, options),
    getRoutine: (input) => getRoutineForWeb(input, options),
    createRoutine: (input) => createRoutineForWeb(input, options),
    updateRoutine: (input) => updateRoutineForWeb(input, options),
    setRoutineStatus: (input) => setRoutineStatusForWeb(input, options),
    deleteRoutine: (input) => deleteRoutineForWeb(input, options),
    listRoutineTemplates: () => listRoutineTemplatesForWeb(),
    createRoutineFromTemplate: (input) => createRoutineFromTemplateForWeb(input, options),
    runRoutine: (input) => runRoutineForWeb(input, options),
    listRoutineRuns: (input) => listRoutineRunsForWeb(input, options),
    listRoutineArtifacts: (input) => listRoutineArtifactsForWeb(input, options),
    listRoutineTriggers: (input) => listRoutineTriggersForWeb(input, options),
    createRoutineTrigger: (input) => createRoutineTriggerForWeb(input, options),
    updateRoutineTrigger: (input) => updateRoutineTriggerForWeb(input, options),
    deleteRoutineTrigger: (input) => deleteRoutineTriggerForWeb(input, options),
    runRoutineTriggerNow: (input) => runRoutineTriggerNowFromWeb(input, options),
    retrievalIndexStatus: () => getRetrievalIndexStatusForWeb(options),
    refreshRetrievalIndex: (input) => refreshRetrievalIndexForWeb(input, options),

    modelAuthStatus: () => getModelAuthStatus(options),
    startModelAuth: (input) => startModelAuth(input, input.origin, options),
    completeModelAuth: async (input) => {
      await completeModelAuth(input, options);
      return getModelAuthStatus(options);
    },
    disconnectModelAuth: (input) => disconnectModelAuth(input.provider, options),
    setModelApiKey: (input) => setModelApiKey(input, options),
    clearModelApiKey: (input) => clearModelApiKey(input, options),

    mcpSettingsStatus: () => getMcpSettingsStatus(options),
    updateMcpSettings: (input) => updateMcpSettings(input, options),
    deleteMcpSettings: (input) => deleteMcpSettings(input, options),
    listMcpTools: (input) => listMcpTools(input, options),

    connectorSummaries: () => connectorSummaries(options),
    runConnectorSession: (input) => runConnectorSession(input, options),
    listConnectorConfigProfiles: (input) => listConnectorConfigProfilesForWeb(input, options),
    saveConnectorConfigProfile: (input) => saveConnectorConfigProfileForWeb(input, options),
    deleteConnectorConfigProfile: (input) => deleteConnectorConfigProfileForWeb(input, options),
    setDefaultConnectorConfigProfile: (input) =>
      setDefaultConnectorConfigProfileForWeb(input, options),

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
    delivery: input.delivery,
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
  renameChatSession,
  searchChatSessions,
} from "./chatServices.js";
export {
  connectorSummaries,
  deleteConnectorConfigProfileForWeb,
  listConnectorConfigProfilesForWeb,
  runConnectorSession,
  runNotionSession,
  saveConnectorConfigProfileForWeb,
  setDefaultConnectorConfigProfileForWeb,
  startNotionMcp,
  validateNotion,
} from "./connectorServices.js";
// Public re-exports for callers that imported these directly from `services.js`
// before the split. The new homes are `runtime.ts`, `chatServices.ts`, and
// `connectorServices.ts` — but `services.ts` remains the documented entry point
// of the package so existing imports keep working.
export { repoRoot, runtime, runtimeEnv, type WebApiOptions } from "./runtime.js";
