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
