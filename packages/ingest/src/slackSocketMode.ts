import { asObject, type JsonObject } from "./common.js";
import type { ConnectorRuntime } from "./connectors/types.js";
import { SlackApiClient } from "./slackClient.js";
import { type SlackConnectorConfig, slackConnector, slackTokens } from "./slackConnector.js";

export interface SlackSocketModeListenerOptions {
  config: SlackConnectorConfig;
  runtime: ConnectorRuntime;
  signal?: AbortSignal;
  webSocketImpl?: typeof WebSocket;
  onEvent?: (event: SlackSocketModeEventResult) => void;
  onStatus?: (message: string) => void;
}

export interface SlackSocketModeEventResult {
  channel: string;
  threadTs: string;
  rawPath?: string;
  written?: boolean;
  skipped?: boolean;
}

export interface SlackSocketEnvelope {
  envelope_id?: string;
  payload?: JsonObject;
  type?: string;
}

export async function runSlackSocketModeListener(
  options: SlackSocketModeListenerOptions,
): Promise<void> {
  const tokens = slackTokens(options.config, options.runtime);
  if (tokens.appToken === "") {
    throw new Error("Set SLACK_APP_TOKEN before running Slack Socket Mode.");
  }
  if (tokens.historyToken === "") {
    throw new Error("Set SLACK_USER_TOKEN or SLACK_BOT_TOKEN before running Slack Socket Mode.");
  }

  const fetchImpl = options.runtime.fetchImpl ?? globalThis.fetch;
  const appClient = new SlackApiClient({ token: tokens.appToken, fetchImpl });
  const { url } = await appClient.appsConnectionsOpen();
  const WebSocketImpl = options.webSocketImpl ?? globalThis.WebSocket;

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    let settled = false;

    const finish = (error?: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const abort = () => {
      socket.close();
      finish();
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    socket.addEventListener("open", () => {
      options.onStatus?.("connected to Slack Socket Mode");
    });
    socket.addEventListener("message", (message) => {
      void handleSocketMessage(message.data, socket, options).catch((error: unknown) => {
        options.onStatus?.(error instanceof Error ? error.message : String(error));
      });
    });
    socket.addEventListener("error", () => {
      finish(new Error("Slack Socket Mode WebSocket error."));
    });
    socket.addEventListener("close", () => {
      options.signal?.removeEventListener("abort", abort);
      finish();
    });
  });
}

async function handleSocketMessage(
  data: unknown,
  socket: WebSocket,
  options: SlackSocketModeListenerOptions,
): Promise<void> {
  const envelope = parseEnvelope(data);
  if (!envelope) {
    debugStatus(options, "ignored unreadable socket frame");
    return;
  }
  debugStatus(options, `received ${describeSlackSocketEnvelope(envelope)}`);
  if (envelope.envelope_id) {
    socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
  }

  const payload = asObject(envelope.payload);
  if (!isSlackEventCallbackPayload(payload)) {
    return;
  }
  const target = slackThreadTargetFromEvent(payload.event);
  if (!target) {
    debugStatus(options, "ignored events_api payload without a message thread target");
    return;
  }
  debugStatus(options, `capturing thread channel=${target.channel} threadTs=${target.threadTs}`);

  const result = await slackConnector.pull(
    {
      ...options.config,
      channel: target.channel,
      mode: "thread",
      threadTs: target.threadTs,
    },
    options.runtime,
  );
  options.onEvent?.({
    channel: target.channel,
    threadTs: target.threadTs,
    rawPath: result.rawPath,
    written: result.written,
    skipped: result.skipped,
  });
}

export function describeSlackSocketEnvelope(envelope: SlackSocketEnvelope): string {
  const payload = asObject(envelope.payload);
  const event = asObject(payload?.event);
  return [
    `envelope=${envelope.type ?? "unknown"}`,
    `payload=${stringValue(payload?.type) || "none"}`,
    `event=${stringValue(event?.type) || "none"}`,
    `subtype=${stringValue(event?.subtype) || "none"}`,
  ].join(" ");
}

export function isSlackEventCallbackPayload(payload: JsonObject | null): payload is JsonObject {
  return payload?.type === "event_callback" || payload?.type === "events_api";
}

export function slackThreadTargetFromEvent(
  value: unknown,
): { channel: string; threadTs: string } | null {
  const event = asObject(value);
  if (!event || event.type !== "message") {
    return null;
  }
  const channel = stringValue(event.channel);
  const nestedMessage = asObject(event.message);
  const threadTs =
    stringValue(event.thread_ts) ||
    stringValue(nestedMessage?.thread_ts) ||
    stringValue(event.ts) ||
    stringValue(nestedMessage?.ts);
  if (channel === "" || threadTs === "") {
    return null;
  }
  return { channel, threadTs };
}

function parseEnvelope(data: unknown): SlackSocketEnvelope | null {
  const text =
    typeof data === "string"
      ? data
      : data instanceof ArrayBuffer
        ? new TextDecoder().decode(data)
        : data instanceof Uint8Array
          ? new TextDecoder().decode(data)
          : "";
  if (text === "") {
    return null;
  }
  const parsed = asObject(JSON.parse(text));
  return parsed ? (parsed as SlackSocketEnvelope) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function debugStatus(options: SlackSocketModeListenerOptions, message: string): void {
  if (!isSocketDebugEnabled(options.runtime.env.SLACK_SOCKET_DEBUG)) {
    return;
  }
  options.onStatus?.(`[slack:socket] ${message}`);
}

function isSocketDebugEnabled(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
