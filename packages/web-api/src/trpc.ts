import type { TokenUsage } from "@strata/core/types";
import type {
  ConnectorName,
  ConnectorPullResult,
  ConnectorStatus,
} from "@strata/ingest/connector-types";
import { initTRPC } from "@trpc/server";
import { z } from "zod";

export interface ConnectorSummary {
  name: ConnectorName;
  displayName: string;
  description: string;
  state: ConnectorStatus["state"];
  configured: boolean;
  message: string;
  capabilities: string[];
}

export interface ConnectorSessionResult extends ConnectorPullResult {
  sessionId: string;
}

export interface NotionMcpStatus {
  authenticated: boolean;
  state: "connected" | "not_connected" | "auth_pending" | "requires_reconnect";
  message: string;
  serverUrl: string;
  expiresAt?: string;
}

export interface NotionMcpStartResult {
  authenticated: boolean;
  authorizationUrl?: string;
  callbackUrl: string;
  message: string;
}

export interface NotionMcpToolSummary {
  name: string;
  description: string;
}

export interface GranolaStatus {
  state: "connected" | "not_configured" | "invalid";
  configured: boolean;
  message: string;
  validatedAt?: string;
}

export type ModelAuthProviderName = "openai-codex" | "anthropic-claude";

export interface ModelAuthProviderStatus {
  provider: ModelAuthProviderName;
  displayName: string;
  authenticated: boolean;
  state: "connected" | "not_connected" | "auth_pending";
  message: string;
  expiresAt?: number;
}

export interface ModelAuthStatus {
  providers: ModelAuthProviderStatus[];
}

export interface ModelAuthStartResult {
  provider: ModelAuthProviderName;
  authenticated: false;
  authorizationUrl: string;
  callbackUrl: string;
  message: string;
}

export interface McpServerStatus {
  slug: string;
  displayName: string;
  serverUrl: string;
  enabled: boolean;
  selectedTools: string[];
  headerNames: string[];
  apiKeyConfigured: boolean;
  state: "enabled" | "disabled";
  message: string;
  updatedAt?: string;
}

export interface McpSettingsStatus {
  servers: McpServerStatus[];
}

export interface McpToolSummary {
  name: string;
  description: string;
}

export type ChatProviderName = "openai-codex" | "openai-compatible" | "anthropic-claude";

export type ChatSessionKind = "chat" | "query";
export type ChatSessionStatus = "running" | "completed" | "failed" | "interrupted";
export type ChatMessageRole = "system" | "user" | "assistant" | "tool";
export type BrowserJsonValue =
  | null
  | boolean
  | number
  | string
  | BrowserJsonValue[]
  | { [key: string]: BrowserJsonValue };

export interface ChatModelStatus {
  provider: ChatProviderName;
  model: string;
  codexLoggedIn: boolean;
  apiKeyConfigured: boolean;
  anthropicLoggedIn: boolean;
  codexExpiresAt?: number;
  anthropicExpiresAt?: number;
}

export interface ChatModelSummary {
  id: string;
  description: string;
}

export interface ChatFileEntry {
  path: string;
  isDirectory: boolean;
}

export interface ChatSkillEntry {
  name: string;
  description: string;
  path: string;
  source: "strata" | "agents";
  disableModelInvocation: boolean;
}

export interface ChatSkillInvocation {
  name: string;
  prompt: string;
}

export interface WikiTreeEntry {
  path: string;
  name: string;
  type: "directory" | "file";
  children?: WikiTreeEntry[];
}

export interface WikiPageDetail {
  path: string;
  content: string;
  chars: number;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  kind: ChatSessionKind;
  startedAt: string;
  endedAt: string | null;
  status: ChatSessionStatus;
  model: string | null;
}

export interface ChatMessageSummary {
  id: number;
  role: ChatMessageRole;
  content: string;
  ts: string;
  toolCallId: string | null;
  toolCalls: BrowserJsonValue | null;
  attachments: BrowserJsonValue | null;
  usage: TokenUsage | null;
}

export interface ChatSessionDetail {
  session: ChatSessionSummary;
  messages: ChatMessageSummary[];
}

export interface ChatSessionDeleteResult {
  id: string;
  title: string;
  traceMethod: "trash" | "unlink" | "missing";
}

export interface ChatQueuedMessageSummary {
  id: string;
  sessionId?: string;
  runId?: string;
  message: string;
  attachments: BrowserJsonValue;
  provider?: string;
  model?: string;
  reasoningEffort?: string;
  createdAt: string;
}

export interface ChatActiveRunSummary {
  runId: string;
  startedAt: string;
  updatedAt?: string;
  endedAt?: string | null;
  status: ChatSessionStatus;
  cancelled: boolean;
  lastEventId?: number;
  sessionId?: string;
  continueSessionId?: string;
  stoppedReason?: string;
  errorMessage?: string;
}

export const notionConfigInput = z.object({
  pageId: z.string(),
  token: z.string().optional(),
  version: z.string().optional(),
});

export type NotionConnectorInput = z.output<typeof notionConfigInput>;

export const notionMcpStartInput = z.object({
  origin: z.string().url().optional(),
});

export type NotionMcpStartInput = z.output<typeof notionMcpStartInput>;

export const granolaConfigureInput = z.object({
  apiToken: z.string().min(1, "API key is required."),
});

export type GranolaConfigureRpcInput = z.output<typeof granolaConfigureInput>;

export const chatSessionsListInput = z.object({
  limit: z.number().int().min(1).max(500).default(20),
});

export type ChatSessionsListInput = z.output<typeof chatSessionsListInput>;

export const chatSessionGetInput = z.object({
  sessionId: z.string().min(1),
});

export type ChatSessionGetInput = z.output<typeof chatSessionGetInput>;

export const chatSessionForkInput = z.object({
  sessionId: z.string().min(1),
});

export type ChatSessionForkInput = z.output<typeof chatSessionForkInput>;

export const chatSessionDeleteInput = z.object({
  sessionId: z.string().min(1),
});

export type ChatSessionDeleteInput = z.output<typeof chatSessionDeleteInput>;

export const chatSessionsSearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ChatSessionsSearchInput = z.output<typeof chatSessionsSearchInput>;

export const chatRunGetInput = z.object({
  runId: z.string().min(1),
});

export type ChatRunGetInput = z.output<typeof chatRunGetInput>;

export const chatQueueTargetInput = z
  .object({
    sessionId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .refine((value) => value.sessionId !== undefined || value.runId !== undefined, {
    message: "sessionId or runId is required.",
  });

export type ChatQueueTargetInput = z.output<typeof chatQueueTargetInput>;

export const chatQueueAddInput = chatQueueTargetInput.extend({
  id: z.string().min(1),
  message: z.string().min(1),
  attachments: z.array(z.any()).default([]),
  provider: z.enum(["openai-codex", "openai-compatible", "anthropic-claude"]).optional(),
  model: z.string().min(1).optional(),
  reasoningEffort: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
});

export type ChatQueueAddInput = z.output<typeof chatQueueAddInput>;

export const chatQueueRemoveInput = z.object({
  id: z.string().min(1),
});

export type ChatQueueRemoveInput = z.output<typeof chatQueueRemoveInput>;

export const chatFilesListInput = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ChatFilesListInput = z.output<typeof chatFilesListInput>;

export const chatModelsListInput = z.object({
  provider: z.enum(["openai-codex", "openai-compatible", "anthropic-claude"]),
});

export type ChatModelsListInput = z.output<typeof chatModelsListInput>;

export const chatSkillsListInput = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).default(40),
});

export type ChatSkillsListInput = z.output<typeof chatSkillsListInput>;

export const chatSkillInvokeInput = z.object({
  name: z.string().min(1),
  args: z.string().default(""),
});

export type ChatSkillInvokeInput = z.output<typeof chatSkillInvokeInput>;

export const modelAuthProviderInput = z.object({
  provider: z.enum(["openai-codex", "anthropic-claude"]),
});

export type ModelAuthProviderInput = z.output<typeof modelAuthProviderInput>;

export const modelAuthStartInput = modelAuthProviderInput.extend({
  origin: z.string().url().optional(),
});

export type ModelAuthStartInput = z.output<typeof modelAuthStartInput>;

export const modelAuthCompleteInput = modelAuthProviderInput.extend({
  authorizationResponse: z.string().min(1),
});

export type ModelAuthCompleteInput = z.output<typeof modelAuthCompleteInput>;

export const mcpServerInput = z.object({
  slug: z.string().min(1),
});

export type McpServerInput = z.output<typeof mcpServerInput>;

export const mcpSettingsUpdateInput = mcpServerInput.extend({
  displayName: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  serverUrl: z.string().url().optional(),
  selectedTools: z.array(z.string().min(1)).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
});

export type McpSettingsUpdateInput = z.output<typeof mcpSettingsUpdateInput>;

export const mcpSettingsDeleteInput = mcpServerInput;

export type McpSettingsDeleteInput = z.output<typeof mcpSettingsDeleteInput>;

export const mcpToolsListInput = mcpServerInput.extend({
  serverUrl: z.string().url().optional(),
});

export type McpToolsListInput = z.output<typeof mcpToolsListInput>;

export const wikiTreeInput = z.object({
  includeRaw: z.boolean().default(false),
});

export type WikiTreeInput = z.output<typeof wikiTreeInput>;

export const wikiPageGetInput = z.object({
  path: z.string().min(1),
  includeRaw: z.boolean().default(false),
});

export type WikiPageGetInput = z.output<typeof wikiPageGetInput>;

export interface WebApiServices {
  health(): { ok: true; repoRoot: string };
  chatModelStatus(): Promise<ChatModelStatus>;
  listChatModels(input: ChatModelsListInput): Promise<{ models: ChatModelSummary[] }>;
  listChatFiles(input: ChatFilesListInput): { entries: ChatFileEntry[] };
  listChatSkills(input: ChatSkillsListInput): Promise<{ skills: ChatSkillEntry[] }>;
  invokeChatSkill(input: ChatSkillInvokeInput): Promise<ChatSkillInvocation>;
  listActiveChatRuns(): { runs: ChatActiveRunSummary[] };
  getChatRun(input: ChatRunGetInput): { run: ChatActiveRunSummary | null };
  listChatQueuedMessages(input: ChatQueueTargetInput): { messages: ChatQueuedMessageSummary[] };
  addChatQueuedMessage(input: ChatQueueAddInput): Promise<ChatQueuedMessageSummary>;
  removeChatQueuedMessage(input: ChatQueueRemoveInput): Promise<{ removed: boolean }>;
  clearChatQueuedMessages(input: ChatQueueTargetInput): Promise<{ removed: number }>;
  listChatSessions(input: ChatSessionsListInput): Promise<{ sessions: ChatSessionSummary[] }>;
  getChatSession(input: ChatSessionGetInput): Promise<ChatSessionDetail | null>;
  forkChatSession(input: ChatSessionForkInput): Promise<ChatSessionDetail>;
  deleteChatSession(input: ChatSessionDeleteInput): Promise<ChatSessionDeleteResult>;
  searchChatSessions(input: ChatSessionsSearchInput): Promise<{ sessions: ChatSessionSummary[] }>;
  getWikiTree(input: WikiTreeInput): Promise<{ tree: WikiTreeEntry[] }>;
  getWikiPage(input: WikiPageGetInput): Promise<WikiPageDetail>;

  modelAuthStatus(): Promise<ModelAuthStatus>;
  startModelAuth(input: ModelAuthStartInput): Promise<ModelAuthStartResult>;
  completeModelAuth(input: ModelAuthCompleteInput): Promise<ModelAuthStatus>;
  disconnectModelAuth(input: ModelAuthProviderInput): Promise<ModelAuthStatus>;

  mcpSettingsStatus(): Promise<McpSettingsStatus>;
  updateMcpSettings(input: McpSettingsUpdateInput): Promise<McpSettingsStatus>;
  deleteMcpSettings(input: McpSettingsDeleteInput): Promise<McpSettingsStatus>;
  listMcpTools(input: McpToolsListInput): Promise<{ tools: McpToolSummary[] }>;

  connectorSummaries(): ConnectorSummary[];

  validateNotion(config: NotionConnectorInput): Promise<ConnectorStatus>;
  runNotionSession(
    operation: "dry_run" | "pull",
    config: NotionConnectorInput,
  ): Promise<ConnectorSessionResult>;
  notionMcpStatus(): Promise<NotionMcpStatus>;
  startNotionMcp(input: NotionMcpStartInput): Promise<NotionMcpStartResult>;
  listNotionMcpTools(): Promise<{ tools: NotionMcpToolSummary[] }>;
  disconnectNotionMcp(): Promise<NotionMcpStatus>;
  granolaStatus(): Promise<GranolaStatus>;
  configureGranola(input: GranolaConfigureRpcInput): Promise<GranolaStatus>;
  disconnectGranola(): Promise<GranolaStatus>;
}

export interface WebApiContext {
  services: WebApiServices;
}

const t = initTRPC.context<WebApiContext>().create();

export const appRouter = t.router({
  health: t.procedure.query(({ ctx }) => ctx.services.health()),
  chat: t.router({
    models: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.chatModelStatus()),
      list: t.procedure
        .input(chatModelsListInput)
        .query(({ ctx, input }) => ctx.services.listChatModels(input)),
    }),
    files: t.router({
      list: t.procedure
        .input(chatFilesListInput)
        .query(({ ctx, input }) => ctx.services.listChatFiles(input)),
    }),
    skills: t.router({
      list: t.procedure
        .input(chatSkillsListInput)
        .query(({ ctx, input }) => ctx.services.listChatSkills(input)),
      invoke: t.procedure
        .input(chatSkillInvokeInput)
        .query(({ ctx, input }) => ctx.services.invokeChatSkill(input)),
    }),
    runs: t.router({
      active: t.procedure.query(({ ctx }) => ctx.services.listActiveChatRuns()),
      get: t.procedure
        .input(chatRunGetInput)
        .query(({ ctx, input }) => ctx.services.getChatRun(input)),
    }),
    queue: t.router({
      list: t.procedure
        .input(chatQueueTargetInput)
        .query(({ ctx, input }) => ctx.services.listChatQueuedMessages(input)),
      add: t.procedure
        .input(chatQueueAddInput)
        .mutation(({ ctx, input }) => ctx.services.addChatQueuedMessage(input)),
      remove: t.procedure
        .input(chatQueueRemoveInput)
        .mutation(({ ctx, input }) => ctx.services.removeChatQueuedMessage(input)),
      clear: t.procedure
        .input(chatQueueTargetInput)
        .mutation(({ ctx, input }) => ctx.services.clearChatQueuedMessages(input)),
    }),
    sessions: t.router({
      list: t.procedure
        .input(chatSessionsListInput)
        .query(({ ctx, input }) => ctx.services.listChatSessions(input)),
      get: t.procedure
        .input(chatSessionGetInput)
        .query(({ ctx, input }) => ctx.services.getChatSession(input)),
      fork: t.procedure
        .input(chatSessionForkInput)
        .mutation(({ ctx, input }) => ctx.services.forkChatSession(input)),
      delete: t.procedure
        .input(chatSessionDeleteInput)
        .mutation(({ ctx, input }) => ctx.services.deleteChatSession(input)),
      search: t.procedure
        .input(chatSessionsSearchInput)
        .query(({ ctx, input }) => ctx.services.searchChatSessions(input)),
    }),
  }),
  wiki: t.router({
    tree: t.procedure
      .input(wikiTreeInput)
      .query(({ ctx, input }) => ctx.services.getWikiTree(input)),
    page: t.procedure
      .input(wikiPageGetInput)
      .query(({ ctx, input }) => ctx.services.getWikiPage(input)),
  }),
  auth: t.router({
    models: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.modelAuthStatus()),
      start: t.procedure
        .input(modelAuthStartInput)
        .mutation(({ ctx, input }) => ctx.services.startModelAuth(input)),
      complete: t.procedure
        .input(modelAuthCompleteInput)
        .mutation(({ ctx, input }) => ctx.services.completeModelAuth(input)),
      disconnect: t.procedure
        .input(modelAuthProviderInput)
        .mutation(({ ctx, input }) => ctx.services.disconnectModelAuth(input)),
    }),
  }),
  mcps: t.router({
    status: t.procedure.query(({ ctx }) => ctx.services.mcpSettingsStatus()),
    update: t.procedure
      .input(mcpSettingsUpdateInput)
      .mutation(({ ctx, input }) => ctx.services.updateMcpSettings(input)),
    delete: t.procedure
      .input(mcpSettingsDeleteInput)
      .mutation(({ ctx, input }) => ctx.services.deleteMcpSettings(input)),
    tools: t.router({
      list: t.procedure
        .input(mcpToolsListInput)
        .query(({ ctx, input }) => ctx.services.listMcpTools(input)),
    }),
  }),
  connectors: t.router({
    list: t.procedure.query(({ ctx }) => ({
      connectors: ctx.services.connectorSummaries(),
    })),
    notion: t.router({
      validate: t.procedure
        .input(notionConfigInput)
        .mutation(({ ctx, input }) => ctx.services.validateNotion(input)),
      dryRun: t.procedure
        .input(notionConfigInput)
        .mutation(({ ctx, input }) => ctx.services.runNotionSession("dry_run", input)),
      pull: t.procedure
        .input(notionConfigInput)
        .mutation(({ ctx, input }) => ctx.services.runNotionSession("pull", input)),
      mcp: t.router({
        status: t.procedure.query(({ ctx }) => ctx.services.notionMcpStatus()),
        start: t.procedure
          .input(notionMcpStartInput)
          .mutation(({ ctx, input }) => ctx.services.startNotionMcp(input)),
        listTools: t.procedure.query(({ ctx }) => ctx.services.listNotionMcpTools()),
        disconnect: t.procedure.mutation(({ ctx }) => ctx.services.disconnectNotionMcp()),
      }),
    }),
    granola: t.router({
      status: t.procedure.query(({ ctx }) => ctx.services.granolaStatus()),
      configure: t.procedure
        .input(granolaConfigureInput)
        .mutation(({ ctx, input }) => ctx.services.configureGranola(input)),
      disconnect: t.procedure.mutation(({ ctx }) => ctx.services.disconnectGranola()),
    }),
  }),
});

export type AppRouter = typeof appRouter;
