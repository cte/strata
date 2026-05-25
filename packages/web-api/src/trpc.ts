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

export type ChatProviderName = "openai-codex" | "openai-compatible";
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
  codexExpiresAt?: number;
}

export interface ChatModelSummary {
  id: string;
  description: string;
}

export interface ChatFileEntry {
  path: string;
  isDirectory: boolean;
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

export const chatFilesListInput = z.object({
  query: z.string().default(""),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ChatFilesListInput = z.output<typeof chatFilesListInput>;

export const chatModelsListInput = z.object({
  provider: z.enum(["openai-codex", "openai-compatible"]),
});

export type ChatModelsListInput = z.output<typeof chatModelsListInput>;

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
  listActiveChatRuns(): { runs: ChatActiveRunSummary[] };
  getChatRun(input: ChatRunGetInput): { run: ChatActiveRunSummary | null };
  listChatSessions(input: ChatSessionsListInput): Promise<{ sessions: ChatSessionSummary[] }>;
  getChatSession(input: ChatSessionGetInput): Promise<ChatSessionDetail | null>;
  forkChatSession(input: ChatSessionForkInput): Promise<ChatSessionDetail>;
  deleteChatSession(input: ChatSessionDeleteInput): Promise<ChatSessionDeleteResult>;
  searchChatSessions(input: ChatSessionsSearchInput): Promise<{ sessions: ChatSessionSummary[] }>;
  getWikiTree(input: WikiTreeInput): Promise<{ tree: WikiTreeEntry[] }>;
  getWikiPage(input: WikiPageGetInput): Promise<WikiPageDetail>;

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
    runs: t.router({
      active: t.procedure.query(({ ctx }) => ctx.services.listActiveChatRuns()),
      get: t.procedure
        .input(chatRunGetInput)
        .query(({ ctx, input }) => ctx.services.getChatRun(input)),
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
