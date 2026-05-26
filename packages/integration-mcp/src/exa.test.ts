import { describe, expect, test } from "bun:test";
import { ToolRegistry } from "@strata/tools";
import { createExaMcpToolPack } from "./exa.js";

describe("Exa MCP tool pack", () => {
  test("registers Exa search and fetch tools from remote MCP metadata", async () => {
    const registry = new ToolRegistry();
    await createExaMcpToolPack({ fetchImpl: fakeFetch(), requireConfigured: false }).register(
      registry,
      {
        repoRoot: "/tmp/strata",
        env: {},
      },
    );

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "mcp.exa.webFetch",
      "mcp.exa.webSearch",
    ]);
    expect(registry.get("mcp.exa.webSearch").inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
    });
  });

  test("does not register tools when disabled", async () => {
    const registry = new ToolRegistry();
    await createExaMcpToolPack({ fetchImpl: fakeFetch() }).register(registry, {
      repoRoot: "/tmp/strata",
      env: { STRATA_EXA_MCP_ENABLED: "false" },
    });
    expect(registry.list()).toEqual([]);
  });
});

function fakeFetch(): typeof fetch {
  let initialized = false;
  return Object.assign(
    async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; id?: unknown };
      if (body.method === "initialize") {
        initialized = true;
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "fake-exa", version: "0.1.0" },
          },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list" && initialized) {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "web_search_exa",
                description: "Search the web",
                inputSchema: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
              },
              {
                name: "web_fetch_exa",
                description: "Fetch pages",
                inputSchema: {
                  type: "object",
                  properties: { urls: { type: "array", items: { type: "string" } } },
                  required: ["urls"],
                },
              },
              {
                name: "web_search_advanced_exa",
                description: "Advanced search",
                inputSchema: { type: "object", properties: {} },
              },
            ],
          },
        });
      }
      throw new Error(`Unexpected MCP request: ${body.method}`);
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}
