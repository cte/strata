#!/usr/bin/env bun
import { trpcServer } from "@hono/trpc-server";
import { ensureRuntimeDirs, getStrataPaths } from "@strata/core";
import { loadDotenv } from "@strata/ingest/common";
import { TerminalHttpBridge, TerminalSessionManager } from "@strata/terminal-backend";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { SessionChangeNotice } from "./changeFeed.js";
import {
  ChatRunConflictError,
  type ChatRunEvent,
  type ChatRunEventEnvelope,
  type ChatStreamCloseReason,
  type StartChatRunInput,
  type StartedChatRun,
} from "./chat.js";
import { finishModelAuth, modelAuthCompleteHtml } from "./modelAuth.js";
import { finishNotionMcpAuth } from "./notionMcp.js";
import {
  connectorSummaries,
  createWebApiServices,
  repoRoot,
  type WebApiOptions,
} from "./services.js";
import { appRouter } from "./trpc.js";
import { isWebAuthExemptPath, WebAuthController } from "./webAuth.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4174;
const WEB_API_IDLE_TIMEOUT_SECONDS = 255;
const CHAT_STREAM_HEARTBEAT_MS = 5_000;

export function createWebApiApp(options: WebApiOptions = {}): Hono {
  const app = new Hono();
  const services = createWebApiServices(options);
  const auth = WebAuthController.create(options);
  const root = repoRoot(options);
  const terminals = new TerminalHttpBridge(
    new TerminalSessionManager(root, options.env ?? Bun.env),
  );

  app.use(
    "*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  app.use("*", async (c, next) => {
    const url = new URL(c.req.url);
    if (isWebAuthExemptPath(url.pathname, c.req.method) || auth.isAuthenticated(c.req.raw)) {
      await next();
      return;
    }
    return c.json(errorResponse("unauthorized", "Unlock Strata web with your passcode."), 401, {
      "www-authenticate": 'Bearer realm="Strata web"',
    });
  });

  app.get("/api/auth/status", (c) => c.json(auth.status(c.req.raw)));

  app.post("/api/auth/session", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { passcode?: unknown } | null;
    if (auth.enabled && (body === null || typeof body.passcode !== "string")) {
      return c.json(errorResponse("bad_request", "Passcode is required."), 400);
    }
    const result = auth.createSession(
      typeof body?.passcode === "string" ? body.passcode : "",
      c.req.raw,
    );
    if (result === undefined) {
      return c.json(errorResponse("unauthorized", "Incorrect passcode."), 401);
    }
    c.header("set-cookie", result.cookie);
    return c.json(result.status);
  });

  app.post("/api/auth/logout", (c) => {
    const result = auth.logout(c.req.raw);
    c.header("set-cookie", result.cookie);
    return c.json(result.status);
  });

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
      return c.html(
        callbackRedirectHtml("/connectors/notion", { status: "ok", message: result.message }),
      );
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return c.html(callbackRedirectHtml("/connectors/notion", { status: "error", message }), 400);
    }
  });

  app.get("/api/auth/models/:provider/callback", async (c) => {
    try {
      const result = await finishModelAuth(c.req.url, c.req.param("provider"), options);
      return c.html(modelAuthCompleteHtml("ok", result.message));
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return c.html(modelAuthCompleteHtml("error", message), 400);
    }
  });

  app.post("/api/chat/runs", async (c) => {
    let input: StartChatRunInput;
    try {
      input = await parseStartChatRunInput(c.req.raw);
    } catch (error: unknown) {
      return c.json(errorResponse("bad_request", messageFromError(error)), 400);
    }

    try {
      const run = await services.chat.startRun(input);
      return streamChatRun(
        run,
        c.req.raw.signal,
        services.chat,
        positiveNumber(options.chatStreamHeartbeatMs, CHAT_STREAM_HEARTBEAT_MS),
      );
    } catch (error: unknown) {
      if (error instanceof ChatRunConflictError) {
        return c.json(
          {
            error: {
              code: "chat_run_conflict",
              message: error.message,
              runId: error.runId,
              sessionId: error.sessionId,
            },
          },
          409,
        );
      }
      const message = messageFromError(error);
      const status = message === "Chat message is required." ? 400 : 500;
      return c.json(
        errorResponse(status === 400 ? "bad_request" : "chat_run_failed", message),
        status,
      );
    }
  });

  app.post("/api/chat/runs/:runId/cancel", async (c) => {
    const runId = c.req.param("runId");
    if (!(await services.chat.cancelRun(runId))) {
      return c.json(errorResponse("not_found", `No active chat run: ${runId}`), 404);
    }
    return c.json({ cancelled: true, runId });
  });

  app.get("/api/chat/runs/:runId/events", (c) => {
    const runId = c.req.param("runId");
    const events = services.chat.subscribeRunEvents(runId, lastEventId(c.req.raw));
    if (events === undefined) {
      return c.json(errorResponse("not_found", `No chat run: ${runId}`), 404);
    }
    return streamChatRunEvents(
      runId,
      events,
      c.req.raw.signal,
      services.chat,
      positiveNumber(options.chatStreamHeartbeatMs, CHAT_STREAM_HEARTBEAT_MS),
    );
  });

  app.get("/api/changes", (c) =>
    streamSessionChanges(
      services.changes.subscribe(),
      c.req.raw.signal,
      positiveNumber(options.chatStreamHeartbeatMs, CHAT_STREAM_HEARTBEAT_MS),
    ),
  );

  app.post("/api/terminal/sessions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      cols?: unknown;
      rows?: unknown;
    } | null;
    if (body === null) return c.json(terminals.create());

    const size = parseTerminalSize(body);
    if (size === undefined) {
      return c.json(errorResponse("bad_request", "Terminal size must include cols and rows."), 400);
    }
    return c.json(terminals.create(size));
  });

  app.get("/api/terminal/sessions/:sessionId/stream", (c) => {
    const response = terminals.stream(c.req.param("sessionId"), c.req.raw.signal);
    if (response === undefined) {
      return c.json(errorResponse("not_found", "No terminal session."), 404);
    }
    return response;
  });

  app.post("/api/terminal/sessions/:sessionId/input", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { data?: unknown } | null;
    if (typeof body?.data !== "string") {
      return c.json(errorResponse("bad_request", "Terminal input data must be a string."), 400);
    }
    if (!terminals.write(c.req.param("sessionId"), body.data)) {
      return c.json(errorResponse("not_found", "No terminal session."), 404);
    }
    return c.json({ ok: true });
  });

  app.post("/api/terminal/sessions/:sessionId/resize", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      cols?: unknown;
      rows?: unknown;
    } | null;
    const size = parseTerminalSize(body);
    if (size === undefined) {
      return c.json(errorResponse("bad_request", "Terminal size must include cols and rows."), 400);
    }
    if (!terminals.resize(c.req.param("sessionId"), size)) {
      return c.json(errorResponse("not_found", "No terminal session."), 404);
    }
    return c.json({ ok: true, ...size });
  });

  app.delete("/api/terminal/sessions/:sessionId", async (c) => {
    await terminals.close(c.req.param("sessionId"), "client closed");
    return c.json({ ok: true });
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
  const handler = createWebApiHandler({ ...options, repoRoot: root });

  const server = Bun.serve({
    hostname: host,
    port,
    idleTimeout: WEB_API_IDLE_TIMEOUT_SECONDS,
    fetch: handler,
  });

  const auth = WebAuthController.create({ ...options, repoRoot: root });
  console.log(`Strata web API listening on http://${server.hostname}:${server.port}`);
  if (!auth.enabled) {
    console.log("Strata web auth: disabled by STRATA_WEB_AUTH");
  } else if (auth.source === "unset") {
    console.warn(
      "Strata web auth: STRATA_PASSCODE is not set — the web UI is locked and cannot be unlocked until you set a 4-digit passcode in your .env.",
    );
  } else if (auth.passcodeMalformed) {
    console.warn(
      "Strata web auth: STRATA_PASSCODE should be exactly 4 digits — unlock will fail until it is corrected.",
    );
  } else {
    console.log("Strata web auth: STRATA_PASSCODE enabled");
  }
  return server;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseTerminalSize(
  body: { cols?: unknown; rows?: unknown } | null,
): { cols: number; rows: number } | undefined {
  if (body === null) return undefined;
  const cols = terminalDimension(body.cols);
  const rows = terminalDimension(body.rows);
  if (cols === undefined || rows === undefined) return undefined;
  return { cols, rows };
}

function terminalDimension(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const dimension = Math.floor(value);
  return dimension > 0 && dimension <= 1_000 ? dimension : undefined;
}

function lastEventId(request: Request): number {
  const url = new URL(request.url);
  const raw = url.searchParams.get("after") ?? request.headers.get("last-event-id") ?? "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

if (import.meta.main) {
  await startWebApiServer();
}

function callbackRedirectHtml(
  path: string,
  opts: { status: "ok" | "error"; message: string },
): string {
  const params = new URLSearchParams({
    status: opts.status,
    message: opts.message,
  }).toString();
  const target = escapeAttr(`${path}?${params}`);

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

const CHAT_PROVIDERS = new Set(["openai-codex", "openai-compatible", "anthropic-claude"]);

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

async function parseStartChatRunInput(request: Request): Promise<StartChatRunInput> {
  const value = await request.json().catch(() => {
    throw new Error("Request body must be valid JSON.");
  });
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.message !== "string" || raw.message.trim() === "") {
    throw new Error("Chat message is required.");
  }

  const input: StartChatRunInput = { message: raw.message };
  if (raw.continueSessionId !== undefined) {
    if (typeof raw.continueSessionId !== "string" || raw.continueSessionId.trim() === "") {
      throw new Error("continueSessionId must be a non-empty string.");
    }
    input.continueSessionId = raw.continueSessionId;
  }
  if (raw.provider !== undefined) {
    if (typeof raw.provider !== "string" || !CHAT_PROVIDERS.has(raw.provider)) {
      throw new Error("provider must be openai-codex, openai-compatible, or anthropic-claude.");
    }
    input.provider = raw.provider as NonNullable<StartChatRunInput["provider"]>;
  }
  if (raw.model !== undefined) {
    if (typeof raw.model !== "string" || raw.model.trim() === "") {
      throw new Error("model must be a non-empty string.");
    }
    input.model = raw.model;
  }
  if (raw.reasoningEffort !== undefined) {
    if (typeof raw.reasoningEffort !== "string" || !THINKING_LEVELS.has(raw.reasoningEffort)) {
      throw new Error("reasoningEffort is invalid.");
    }
    input.reasoningEffort = raw.reasoningEffort as NonNullable<
      StartChatRunInput["reasoningEffort"]
    >;
  }
  if (raw.attachments !== undefined) {
    if (!Array.isArray(raw.attachments)) {
      throw new Error("attachments must be an array.");
    }
    input.attachments = raw.attachments.map(parseAttachment);
  }
  return input;
}

function parseAttachment(value: unknown): NonNullable<StartChatRunInput["attachments"]>[number] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("attachments must contain objects.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "image") {
    throw new Error("Only image attachments are supported.");
  }
  if (typeof raw.mimeType !== "string" || raw.mimeType.trim() === "") {
    throw new Error("attachment mimeType must be a non-empty string.");
  }
  if (typeof raw.dataBase64 !== "string" || raw.dataBase64.trim() === "") {
    throw new Error("attachment dataBase64 must be a non-empty string.");
  }
  const attachment: NonNullable<StartChatRunInput["attachments"]>[number] = {
    kind: "image",
    mimeType: raw.mimeType,
    dataBase64: raw.dataBase64,
  };
  if (raw.name !== undefined) {
    if (typeof raw.name !== "string") {
      throw new Error("attachment name must be a string.");
    }
    attachment.name = raw.name;
  }
  return attachment;
}

function streamChatRun(
  run: StartedChatRun,
  requestSignal: AbortSignal,
  chat: ReturnType<typeof createWebApiServices>["chat"],
  heartbeatMs: number,
): Response {
  return streamChatRunEvents(run.runId, run.events, requestSignal, chat, heartbeatMs);
}

function streamChatRunEvents(
  runId: string,
  events: AsyncIterable<ChatRunEventEnvelope>,
  requestSignal: AbortSignal,
  chat: ReturnType<typeof createWebApiServices>["chat"],
  heartbeatMs: number,
): Response {
  const encoder = new TextEncoder();
  let disconnected = false;
  let iterator: AsyncIterator<ChatRunEventEnvelope> | undefined;
  const closeStream = async (reason: ChatStreamCloseReason) => {
    if (disconnected) {
      return;
    }
    disconnected = true;
    await chat.recordStreamClosed(runId, reason);
    await iterator?.return?.();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const abortListener = () => void closeStream("request_aborted");
      requestSignal.addEventListener("abort", abortListener, { once: true });
      iterator = events[Symbol.asyncIterator]();
      const heartbeat = setInterval(() => {
        if (disconnected) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          void closeStream("request_aborted");
        }
      }, heartbeatMs);
      try {
        while (!disconnected) {
          const next = await iterator.next();
          if (next.done === true) {
            break;
          }
          controller.enqueue(encoder.encode(formatSseEvent(next.value)));
        }
      } catch (error: unknown) {
        if (!disconnected && !requestSignal.aborted) {
          controller.enqueue(
            encoder.encode(formatSseEvent({ id: 0, event: agentFailedEvent(error) })),
          );
        }
      } finally {
        clearInterval(heartbeat);
        requestSignal.removeEventListener("abort", abortListener);
        if (!disconnected) {
          controller.close();
        }
      }
    },
    cancel: () => closeStream("reader_cancelled"),
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function streamSessionChanges(
  notices: AsyncIterable<SessionChangeNotice>,
  requestSignal: AbortSignal,
  heartbeatMs: number,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let iterator: AsyncIterator<SessionChangeNotice> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stop = () => {
        if (!closed) {
          closed = true;
          void iterator?.return?.();
        }
      };
      requestSignal.addEventListener("abort", stop, { once: true });
      iterator = notices[Symbol.asyncIterator]();
      const heartbeat = setInterval(() => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          stop();
        }
      }, heartbeatMs);
      try {
        while (!closed) {
          const next = await iterator.next();
          if (next.done === true) {
            break;
          }
          controller.enqueue(
            encoder.encode(`event: changed\ndata: ${JSON.stringify(next.value)}\n\n`),
          );
        }
      } catch {
        // Stream torn down; fall through to cleanup.
      } finally {
        clearInterval(heartbeat);
        requestSignal.removeEventListener("abort", stop);
        if (!closed) {
          controller.close();
        }
      }
    },
    cancel: () => {
      closed = true;
      void iterator?.return?.();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

function formatSseEvent(envelope: ChatRunEventEnvelope): string {
  return `id: ${envelope.id}\nevent: ${envelope.event.type}\ndata: ${JSON.stringify(envelope.event)}\n\n`;
}

function agentFailedEvent(error: unknown): ChatRunEvent {
  return {
    type: "agent.failed",
    message: messageFromError(error),
  };
}

function errorResponse(
  code: string,
  message: string,
): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
