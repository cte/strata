#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  asObject,
  asObjects,
  firstString,
  frontmatter,
  type JsonObject,
  loadDotenv,
  requireString,
  slugify,
  utcNow,
  wikiRoot,
  writeOnce,
} from "./common.js";

const rawDir = path.join(wikiRoot, "raw", "slack");

type Args = {
  channel?: string;
  threadTs?: string;
  fromJson?: string;
  title?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: pullSlack [--channel CHANNEL] [--thread-ts TS] [--from-json FILE] [--title TITLE] [--dry-run]",
      );
      process.exit(0);
    }
    if (arg === "--channel") {
      args.channel = requireString(argv[++index], "--channel requires a value");
    } else if (arg === "--thread-ts") {
      args.threadTs = requireString(argv[++index], "--thread-ts requires a value");
    } else if (arg === "--from-json") {
      args.fromJson = requireString(argv[++index], "--from-json requires a value");
    } else if (arg === "--title") {
      args.title = requireString(argv[++index], "--title requires a value");
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function slackApi(
  method: string,
  params: Record<string, string>,
  token: string,
): Promise<JsonObject> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} calling Slack ${method}`);
  }
  const payload = asObject(await response.json());
  if (!payload?.["ok"]) {
    throw new Error(String(payload?.["error"] ?? "unknown Slack API error"));
  }
  return payload;
}

async function loadMessages(
  args: Args,
): Promise<{ messages: JsonObject[]; meta: Record<string, string> }> {
  if (args.fromJson) {
    const payload = JSON.parse(await readFile(args.fromJson, "utf8")) as unknown;
    if (Array.isArray(payload)) {
      return { messages: asObjects(payload), meta: {} };
    }
    const object = asObject(payload);
    if (!object) {
      return { messages: [], meta: {} };
    }
    const messages = asObjects(object["messages"] ?? object["replies"]);
    const meta: Record<string, string> = {};
    for (const [key, value] of Object.entries(object)) {
      if (key !== "messages" && key !== "replies" && typeof value !== "object") {
        meta[key] = String(value);
      }
    }
    return { messages, meta };
  }

  const token = process.env["SLACK_BOT_TOKEN"] ?? "";
  if (!token) {
    throw new Error("Set SLACK_BOT_TOKEN in .env or use --from-json");
  }
  if (!args.channel || !args.threadTs) {
    throw new Error("Direct Slack fetch requires --channel and --thread-ts");
  }
  const payload = await slackApi(
    "conversations.replies",
    { channel: args.channel, ts: args.threadTs },
    token,
  );
  const messages = asObjects(payload["messages"]);
  return { messages, meta: { channel: args.channel, thread_ts: args.threadTs } };
}

function messageDate(ts: string): string {
  const value = Number.parseFloat(ts);
  if (!Number.isFinite(value)) {
    return utcNow().toISOString().slice(0, 10);
  }
  return new Date(value * 1000).toISOString().slice(0, 10);
}

function renderUser(message: JsonObject): string {
  return firstString(message, ["user", "username", "bot_id"], "unknown");
}

function renderMessages(messages: JsonObject[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message["subtype"] === "bot_message") {
      continue;
    }
    const ts = String(message["ts"] ?? "");
    const user = renderUser(message);
    const text = String(message["text"] ?? "").trim();
    lines.push(`## ${ts} | ${user}`, "", text || "_No text_");
    if (message["reactions"]) {
      lines.push("", `Reactions: \`${JSON.stringify(message["reactions"])}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  await loadDotenv();
  const { messages, meta } = await loadMessages(args);
  if (messages.length === 0) {
    console.error("No Slack messages found.");
    return 1;
  }

  const first = messages[0];
  if (!first) {
    console.error("No Slack messages found.");
    return 1;
  }
  const date = messageDate(String(first["ts"] ?? ""));
  const channel = args.channel ?? meta["channel"] ?? meta["channel_id"] ?? "slack";
  const threadTs =
    args.threadTs ?? meta["thread_ts"] ?? String(first["thread_ts"] ?? first["ts"] ?? "");
  const title = args.title ?? String(first["text"] ?? "Slack thread").slice(0, 80);
  const workspaceUrl = (process.env["SLACK_WORKSPACE_URL"] ?? "").replace(/\/$/, "");
  const sourceUrl =
    workspaceUrl && channel && threadTs
      ? `${workspaceUrl}/archives/${channel}/p${threadTs.replace(".", "")}`
      : "";
  const filePath = path.join(rawDir, `${date}-${slugify(channel)}-${slugify(title, "thread")}.md`);
  const content =
    frontmatter({
      type: "raw_slack_thread",
      source: "slack",
      date,
      channel,
      thread_ts: threadTs,
      title,
      source_url: sourceUrl || null,
      pulled_at: utcNow().toISOString(),
    }) + `\n# ${title}\n\n${renderMessages(messages)}`;

  if (args.dryRun) {
    console.log(path.relative(wikiRoot, filePath));
  } else if (await writeOnce(filePath, content)) {
    console.log(`wrote ${path.relative(wikiRoot, filePath)}`);
  } else {
    console.log(`skipped existing ${path.relative(wikiRoot, filePath)}`);
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
