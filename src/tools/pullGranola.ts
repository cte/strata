#!/usr/bin/env node
import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  asArray,
  asObject,
  asObjects,
  firstString,
  frontmatter,
  loadDotenv,
  requireString,
  slugify,
  utcNow,
  wikiRoot,
  writeOnce,
  type JsonObject,
} from "./common.js";

const rawDir = path.join(wikiRoot, "raw", "granola");

type Args = {
  since: string;
  fixture?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log("usage: pullGranola [--since SINCE] [--fixture FILE] [--dry-run]");
      process.exit(0);
    }
    if (arg === "--since") {
      args.since = requireString(argv[++index], "--since requires a value");
    } else if (arg === "--fixture") {
      args.fixture = requireString(argv[++index], "--fixture requires a value");
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function requestJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.json();
}

function meetingsFromPayload(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return asObjects(payload);
  }
  const object = asObject(payload);
  if (!object) {
    return [];
  }
  for (const key of ["meetings", "data", "results", "items"]) {
    const value = object[key];
    if (Array.isArray(value)) {
      return asObjects(value);
    }
  }
  return [];
}

function normalizeAttendees(value: unknown): string[] {
  return asArray(value).flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    const object = asObject(item);
    if (!object) {
      return [];
    }
    const name = firstString(object, ["name", "display_name", "email"]);
    return name ? [name] : [];
  });
}

function meetingDate(item: JsonObject): string {
  const raw = firstString(item, ["date", "start_time", "startTime", "created_at", "createdAt"]);
  return raw ? raw.slice(0, 10) : utcNow().toISOString().slice(0, 10);
}

function meetingTranscript(item: JsonObject): string {
  for (const key of ["transcript", "notes", "text", "content", "markdown"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

async function fetchDetailIfNeeded(item: JsonObject, token: string, template: string | undefined): Promise<JsonObject> {
  if (meetingTranscript(item) || !template) {
    return item;
  }
  const meetingId = firstString(item, ["id", "meeting_id", "uuid"]);
  if (!meetingId) {
    return item;
  }
  const detail = asObject(await requestJson(template.replace("{id}", encodeURIComponent(meetingId)), token));
  return detail ? { ...item, ...detail } : item;
}

function renderMeeting(item: JsonObject, pulledAt: string): { filePath: string; content: string } {
  const date = meetingDate(item);
  const title = firstString(item, ["title", "name", "summary"], "Untitled meeting");
  const attendees = normalizeAttendees(item["attendees"] ?? item["participants"]);
  const sourceUrl = firstString(item, ["source_url", "url", "app_url", "web_url"]);
  const transcript = meetingTranscript(item);
  const filePath = path.join(rawDir, `${date}-${slugify(title, "meeting")}.md`);
  const metadata = frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date,
    title,
    attendees,
    source_url: sourceUrl || null,
    pulled_at: pulledAt,
  });
  const body = transcript || "_No transcript text was present in the API response._";
  return { filePath, content: `${metadata}\n# ${title}\n\n${body.trimEnd()}\n` };
}

function buildUrl(baseUrl: string, since: string): string {
  const url = new URL(baseUrl);
  if (!url.searchParams.has("since")) {
    url.searchParams.set("since", since);
  }
  return url.toString();
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  await loadDotenv();

  const token = process.env["GRANOLA_API_TOKEN"] ?? "";
  const meetingsUrl = process.env["GRANOLA_MEETINGS_URL"] ?? "";
  const transcriptTemplate = process.env["GRANOLA_TRANSCRIPT_URL_TEMPLATE"];

  let payload: unknown;
  if (args.fixture) {
    payload = JSON.parse(await readFile(args.fixture, "utf8"));
  } else {
    if (!token || !meetingsUrl) {
      console.error(
        "Set GRANOLA_API_TOKEN and GRANOLA_MEETINGS_URL in .env, or pass --fixture. Do not hardcode undocumented Granola endpoints.",
      );
      return 2;
    }
    payload = await requestJson(buildUrl(meetingsUrl, args.since), token);
  }

  const pulledAt = utcNow().toISOString();
  let written = 0;
  let skipped = 0;
  for (const originalMeeting of meetingsFromPayload(payload)) {
    const meeting = token ? await fetchDetailIfNeeded(originalMeeting, token, transcriptTemplate) : originalMeeting;
    const { filePath, content } = renderMeeting(meeting, pulledAt);
    if (args.dryRun) {
      console.log(path.relative(wikiRoot, filePath));
    } else if (await writeOnce(filePath, content)) {
      written += 1;
      console.log(`wrote ${path.relative(wikiRoot, filePath)}`);
    } else {
      skipped += 1;
      console.log(`skipped existing ${path.relative(wikiRoot, filePath)}`);
    }
  }

  console.log(`Granola pull complete: ${written} written, ${skipped} skipped`);
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
