import { SessionStore } from "@strata/core/session-store";
import {
  configureGranola,
  disconnectGranola,
  getGranolaStatus,
} from "@strata/ingest/granola-connector";
import { createChatService } from "./chat.js";
import {
  chatModelStatus,
  forkChatSession,
  getChatSession,
  listChatFiles,
  listChatModels,
  listChatSessions,
  searchChatSessions,
} from "./chatServices.js";
import {
  connectorSummaries,
  runNotionSession,
  startNotionMcp,
  validateNotion,
} from "./connectorServices.js";
import { disconnectNotionMcp, getNotionMcpStatus, listNotionMcpTools } from "./notionMcp.js";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type { GranolaConfigureRpcInput, WebApiServices } from "./trpc.js";

export interface WebApiServiceContainer extends WebApiServices {
  chat: ReturnType<typeof createChatService>;
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
  return {
    chat,
    health: () => ({
      ok: true,
      repoRoot: repoRoot(options),
    }),
    chatModelStatus: () => chatModelStatus(options),
    listChatModels: (input) => listChatModels(input, options),
    listChatFiles: (input) => listChatFiles(input, options),
    listActiveChatRuns: () => ({ runs: chat.listActiveRuns() }),
    getChatRun: (input) => ({ run: chat.getRun(input.runId) ?? null }),
    listChatSessions: (input) => listChatSessions(input, getSessionStore),
    getChatSession: (input) => getChatSession(input, getSessionStore),
    forkChatSession: (input) => forkChatSession(input, getSessionStore),
    searchChatSessions: (input) => searchChatSessions(input, getSessionStore),
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

export {
  chatModelStatus,
  forkChatSession,
  getChatSession,
  listChatFiles,
  listChatModels,
  listChatSessions,
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
