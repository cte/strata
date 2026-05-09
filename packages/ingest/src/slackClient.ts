import { asObject, asObjects, type JsonObject } from "./common.js";

export interface SlackApiClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleepMs?: (ms: number) => Promise<void>;
}

export interface SlackAuthTest {
  ok: true;
  url?: string;
  team?: string;
  team_id?: string;
  user_id?: string;
  bot_id?: string;
}

export interface SlackConversation extends JsonObject {
  id: string;
  name?: string;
  is_archived?: boolean;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_member?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  created?: number;
}

export interface SlackMessage extends JsonObject {
  ts: string;
  text?: string;
  thread_ts?: string;
  latest_reply?: string;
  reply_count?: number;
  user?: string;
  username?: string;
  bot_id?: string;
  app_id?: string;
  subtype?: string;
}

export interface ConversationsListArgs {
  excludeArchived?: boolean;
  limit?: number;
  types: string[];
}

export interface ConversationsHistoryArgs {
  channel: string;
  inclusive?: boolean;
  latest?: string;
  limit?: number;
  oldest?: string;
}

export class SlackApiClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleepMs: (ms: number) => Promise<void>;

  constructor(options: SlackApiClientOptions) {
    this.token = options.token.trim();
    if (this.token === "") {
      throw new Error("Slack token is required.");
    }
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleepMs = options.sleepMs ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async authTest(): Promise<SlackAuthTest> {
    return (await this.request("auth.test", {}, "POST")) as unknown as SlackAuthTest;
  }

  async appsConnectionsOpen(): Promise<{ ok: true; url: string }> {
    const payload = await this.request("apps.connections.open", {}, "POST");
    const url = typeof payload.url === "string" ? payload.url : "";
    if (url === "") {
      throw new Error("Slack apps.connections.open did not return a WebSocket URL.");
    }
    return { ok: true, url };
  }

  async conversationsList(args: ConversationsListArgs): Promise<SlackConversation[]> {
    const channels: SlackConversation[] = [];
    let cursor = "";
    do {
      const payload = await this.request("conversations.list", {
        exclude_archived: args.excludeArchived ?? true,
        limit: args.limit ?? 200,
        types: args.types.join(","),
        ...(cursor === "" ? {} : { cursor }),
      });
      channels.push(...asObjects(payload.channels).flatMap(toSlackConversation));
      cursor = nextCursor(payload);
    } while (cursor !== "");
    return channels;
  }

  async conversationsHistory(args: ConversationsHistoryArgs): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let cursor = "";
    do {
      const payload = await this.request("conversations.history", {
        channel: args.channel,
        inclusive: args.inclusive ?? false,
        limit: args.limit ?? 200,
        ...(args.latest === undefined ? {} : { latest: args.latest }),
        ...(args.oldest === undefined ? {} : { oldest: args.oldest }),
        ...(cursor === "" ? {} : { cursor }),
      });
      messages.push(...asObjects(payload.messages).flatMap(toSlackMessage));
      cursor = nextCursor(payload);
    } while (cursor !== "");
    return messages;
  }

  async conversationsReplies(input: {
    channel: string;
    ts: string;
    limit?: number;
  }): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let cursor = "";
    do {
      const payload = await this.request("conversations.replies", {
        channel: input.channel,
        ts: input.ts,
        limit: input.limit ?? 200,
        ...(cursor === "" ? {} : { cursor }),
      });
      messages.push(...asObjects(payload.messages).flatMap(toSlackMessage));
      cursor = nextCursor(payload);
    } while (cursor !== "");
    return messages;
  }

  async conversationsInfo(channel: string): Promise<SlackConversation | null> {
    const payload = await this.request("conversations.info", { channel });
    return toSlackConversation(payload.channel).at(0) ?? null;
  }

  private async request(
    method: string,
    params: Record<string, boolean | number | string | undefined>,
    httpMethod: "GET" | "POST" = "GET",
  ): Promise<JsonObject> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const response = await this.fetchSlack(method, params, httpMethod);
      if (response.status === 429 && attempt < this.maxRetries) {
        const retryAfterSeconds = Number.parseInt(response.headers.get("retry-after") ?? "1", 10);
        await this.sleepMs(Math.max(1, retryAfterSeconds) * 1000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} calling Slack ${method}`);
      }
      const payload = asObject(await response.json());
      if (!payload?.ok) {
        throw new Error(String(payload?.error ?? "unknown Slack API error"));
      }
      return payload;
    }
    throw new Error(`Slack ${method} exceeded retry limit.`);
  }

  private fetchSlack(
    method: string,
    params: Record<string, boolean | number | string | undefined>,
    httpMethod: "GET" | "POST",
  ): Promise<Response> {
    const url = new URL(`https://slack.com/api/${method}`);
    const body = new URLSearchParams();
    let hasBody = false;
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === "") {
        continue;
      }
      const normalized = typeof value === "boolean" ? String(value) : String(value);
      if (httpMethod === "GET") {
        url.searchParams.set(key, normalized);
      } else {
        body.set(key, normalized);
        hasBody = true;
      }
    }
    return this.fetchImpl(url, {
      method: httpMethod,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(httpMethod === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(httpMethod === "POST" && hasBody ? { body } : {}),
    });
  }
}

function nextCursor(payload: JsonObject): string {
  const metadata = asObject(payload.response_metadata);
  const cursor = metadata?.next_cursor;
  return typeof cursor === "string" ? cursor : "";
}

function toSlackConversation(value: unknown): SlackConversation[] {
  const object = asObject(value);
  const id = typeof object?.id === "string" ? object.id : "";
  return id === "" ? [] : [{ ...object, id } as SlackConversation];
}

function toSlackMessage(value: unknown): SlackMessage[] {
  const object = asObject(value);
  const ts = typeof object?.ts === "string" ? object.ts : "";
  return ts === "" ? [] : [{ ...object, ts } as SlackMessage];
}
