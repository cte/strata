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

export interface WebApiServices {
  health(): { ok: true; repoRoot: string };
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
