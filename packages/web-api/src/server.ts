#!/usr/bin/env bun
import { trpcServer } from "@hono/trpc-server";
import { ensureRuntimeDirs, getStrataPaths } from "@strata/core";
import { loadDotenv } from "@strata/ingest/common";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { finishNotionMcpAuth } from "./notionMcp.js";
import {
  connectorSummaries,
  createWebApiServices,
  repoRoot,
  type WebApiOptions,
} from "./services.js";
import { appRouter } from "./trpc.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4174;

export function createWebApiApp(options: WebApiOptions = {}): Hono {
  const app = new Hono();
  const services = createWebApiServices(options);

  app.use(
    "*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
      allowHeaders: ["Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      repoRoot: repoRoot(options),
    }),
  );

  // Compatibility endpoints for curl smoke tests. The React app uses tRPC.
  app.get("/api/connectors", (c) =>
    c.json({
      connectors: connectorSummaries(options),
    }),
  );

  app.get("/api/connectors/notion/mcp/callback", async (c) => {
    try {
      const result = await finishNotionMcpAuth(c.req.url, options);
      return c.html(callbackRedirectHtml({ status: "ok", message: result.message }));
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return c.html(callbackRedirectHtml({ status: "error", message }), 400);
    }
  });

  app.use(
    "/api/trpc/*",
    trpcServer({
      endpoint: "/api/trpc",
      router: appRouter,
      createContext: () => ({ services }),
    }),
  );

  return app;
}

export function createWebApiHandler(
  options: WebApiOptions = {},
): (request: Request) => Response | Promise<Response> {
  const app = createWebApiApp(options);
  return (request) => app.fetch(request);
}

export async function startWebApiServer(
  options: WebApiOptions = {},
): Promise<ReturnType<typeof Bun.serve>> {
  const root = repoRoot(options);
  await loadDotenv(`${root}/.env`);
  await ensureRuntimeDirs(getStrataPaths(root));
  const host = options.env?.STRATA_WEB_HOST ?? Bun.env.STRATA_WEB_HOST ?? DEFAULT_HOST;
  const port = positiveInt(options.env?.STRATA_WEB_PORT ?? Bun.env.STRATA_WEB_PORT, DEFAULT_PORT);
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: createWebApiHandler({ ...options, repoRoot: root }),
  });
  console.log(`Strata web API listening on http://${server.hostname}:${server.port}`);
  return server;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

if (import.meta.main) {
  await startWebApiServer();
}

function callbackRedirectHtml(opts: { status: "ok" | "error"; message: string }): string {
  const params = new URLSearchParams({
    status: opts.status,
    message: opts.message,
  }).toString();
  const target = escapeAttr(`/connectors/notion?${params}`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0;url=${target}" />
    <meta name="color-scheme" content="dark light" />
    <title>Strata — connecting…</title>
    <style>
      html,body{margin:0;height:100%;background:#09090b;color:#a1a1aa;}
      body{font:13px/1.55 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;}
      @media (prefers-color-scheme: light){html,body{background:#fafaf9;color:#52525b;}}
    </style>
  </head>
  <body>Completing connection…</body>
</html>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
