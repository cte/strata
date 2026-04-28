#!/usr/bin/env bun
import path from "node:path";
import {
  asArray,
  asObject,
  asObjects,
  asString,
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

const rawDir = path.join(wikiRoot, "raw", "notion");

type Args = {
  pageId: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log("usage: pullNotion --page-id PAGE_ID [--dry-run]");
      process.exit(0);
    }
    if (arg === "--page-id") {
      args.pageId = requireString(argv[++index], "--page-id requires a value");
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.pageId) {
    throw new Error("--page-id is required");
  }
  return { pageId: args.pageId, dryRun: args.dryRun ?? false };
}

async function notionRequest(apiPath: string, token: string, version: string): Promise<JsonObject> {
  const response = await fetch(`https://api.notion.com/v1${apiPath}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Notion-Version": version,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching Notion ${apiPath}`);
  }
  const payload = asObject(await response.json());
  if (!payload) {
    throw new Error(`Unexpected Notion response for ${apiPath}`);
  }
  return payload;
}

function richTextText(value: unknown): string {
  return asArray(value)
    .map((item) => firstString(asObject(item) ?? {}, ["plain_text"]))
    .join("");
}

function pageTitle(page: JsonObject): string {
  const properties = asObject(page["properties"]) ?? {};
  for (const property of Object.values(properties)) {
    const object = asObject(property);
    if (object?.["type"] === "title") {
      const title = richTextText(object["title"]);
      if (title) {
        return title;
      }
    }
  }
  return "Untitled Notion page";
}

async function fetchBlocks(blockId: string, token: string, version: string): Promise<JsonObject[]> {
  const blocks: JsonObject[] = [];
  let startCursor: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (startCursor) {
      params.set("start_cursor", startCursor);
    }
    const payload = await notionRequest(`/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`, token, version);
    blocks.push(...asObjects(payload["results"]));
    startCursor = asString(payload["next_cursor"]) || undefined;
    if (!payload["has_more"]) {
      break;
    }
  } while (startCursor);
  return blocks;
}

function blockToMarkdown(block: JsonObject): string[] {
  const blockType = asString(block["type"]);
  const data = asObject(block[blockType]) ?? {};
  const text = richTextText(data["rich_text"]);

  switch (blockType) {
    case "heading_1":
      return [`# ${text}`, ""];
    case "heading_2":
      return [`## ${text}`, ""];
    case "heading_3":
      return [`### ${text}`, ""];
    case "bulleted_list_item":
      return [`- ${text}`];
    case "numbered_list_item":
      return [`1. ${text}`];
    case "to_do": {
      const mark = data["checked"] ? "x" : " ";
      return [`- [${mark}] ${text}`];
    }
    case "quote":
    case "callout":
      return [`> ${text}`, ""];
    case "code": {
      const language = asString(data["language"]);
      return [`\`\`\`${language}`, text, "```", ""];
    }
    case "child_page":
      return [`- Child page: ${firstString(data, ["title"], "Child page")}`];
    case "paragraph":
      return text ? [text, ""] : [""];
    default:
      return [`<!-- Unsupported Notion block: ${blockType || "unknown"} -->`, ""];
  }
}

async function renderBlocks(blocks: JsonObject[], token: string, version: string, depth = 0): Promise<string[]> {
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(...blockToMarkdown(block));
    if (block["has_children"] && depth < 3) {
      const blockId = asString(block["id"]);
      if (blockId) {
        lines.push(...(await renderBlocks(await fetchBlocks(blockId, token, version), token, version, depth + 1)));
      }
    }
  }
  return lines;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  await loadDotenv();
  const token = process.env["NOTION_TOKEN"] ?? "";
  const version = process.env["NOTION_VERSION"] ?? "2022-06-28";
  if (!token) {
    console.error("Set NOTION_TOKEN in .env.");
    return 2;
  }

  const page = await notionRequest(`/pages/${encodeURIComponent(args.pageId)}`, token, version);
  const blocks = await fetchBlocks(args.pageId, token, version);
  const title = pageTitle(page);
  const editedTime = asString(page["last_edited_time"]);
  const date = editedTime ? editedTime.slice(0, 10) : utcNow().toISOString().slice(0, 10);
  const filePath = path.join(rawDir, `${date}-${slugify(title, "notion-page")}.md`);
  const pageUrl = asString(page["url"]);
  const content =
    frontmatter({
      type: "raw_notion_page",
      source: "notion",
      date,
      title,
      page_id: args.pageId,
      source_url: pageUrl || null,
      pulled_at: utcNow().toISOString(),
    }) + `\n# ${title}\n\n${(await renderBlocks(blocks, token, version)).join("\n").trimEnd()}\n`;

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
