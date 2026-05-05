import path from "node:path";
import {
  asArray,
  asObject,
  asObjects,
  asString,
  firstString,
  frontmatter,
  requireString,
  slugify,
  utcNow,
  writeOnce,
  type JsonObject,
} from "./common.js";

const DEFAULT_NOTION_VERSION = "2026-03-11";
const MAX_NOTION_RETRIES = 3;

export interface PullNotionPageConfig {
  pageId: string;
  repoRoot: string;
  token: string;
  version?: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface PullNotionPageResult {
  pageId: string;
  title: string;
  date: string;
  sourceUrl: string | null;
  path: string;
  written: boolean;
  skipped: boolean;
  dryRun: boolean;
}

interface NotionRequestContext {
  token: string;
  version: string;
  fetchImpl: typeof fetch;
}

export async function pullNotionPage(config: PullNotionPageConfig): Promise<PullNotionPageResult> {
  const pageId = normalizeNotionPageId(config.pageId);
  const version = config.version ?? DEFAULT_NOTION_VERSION;
  const dryRun = config.dryRun ?? false;
  const context: NotionRequestContext = {
    token: requireString(config.token, "Notion token is required"),
    version,
    fetchImpl: config.fetchImpl ?? fetch,
  };

  const page = await notionRequest(`/pages/${encodeURIComponent(pageId)}`, context);
  const blocks = await fetchBlocks(pageId, context);
  const title = pageTitle(page);
  const editedTime = asString(page.last_edited_time);
  const now = config.now ?? utcNow();
  const date = editedTime ? editedTime.slice(0, 10) : now.toISOString().slice(0, 10);
  const rawDir = path.join(config.repoRoot, "wiki", "raw", "notion");
  const filePath = path.join(rawDir, `${date}-${slugify(title, "notion-page")}.md`);
  const relativePath = path.relative(config.repoRoot, filePath);
  const sourceUrl = asString(page.url) || null;
  const content =
    frontmatter({
      type: "raw_notion_page",
      source: "notion",
      date,
      title,
      page_id: pageId,
      source_url: sourceUrl,
      pulled_at: now.toISOString(),
    }) + `\n# ${title}\n\n${(await renderBlocks(blocks, context)).join("\n").trimEnd()}\n`;

  if (dryRun) {
    return {
      pageId,
      title,
      date,
      sourceUrl,
      path: relativePath,
      written: false,
      skipped: false,
      dryRun,
    };
  }

  const written = await writeOnce(filePath, content);
  return {
    pageId,
    title,
    date,
    sourceUrl,
    path: relativePath,
    written,
    skipped: !written,
    dryRun,
  };
}

export function normalizeNotionPageId(value: string): string {
  const trimmed = requireString(value.trim(), "pageId is required");
  const match = trimmed.match(/[0-9a-fA-F]{32}/g)?.at(-1);
  if (match) {
    return hyphenateNotionId(match);
  }
  const hyphenated =
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/.exec(trimmed);
  return hyphenated ? hyphenated[0].toLowerCase() : trimmed;
}

function hyphenateNotionId(value: string): string {
  const normalized = value.toLowerCase();
  return [
    normalized.slice(0, 8),
    normalized.slice(8, 12),
    normalized.slice(12, 16),
    normalized.slice(16, 20),
    normalized.slice(20),
  ].join("-");
}

async function notionRequest(
  apiPath: string,
  context: NotionRequestContext,
  attempt = 0,
): Promise<JsonObject> {
  const response = await context.fetchImpl(`https://api.notion.com/v1${apiPath}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${context.token}`,
      "Content-Type": "application/json",
      "Notion-Version": context.version,
    },
  });
  if (response.status === 429 && attempt < MAX_NOTION_RETRIES) {
    await sleep(retryAfterMs(response.headers.get("retry-after")));
    return notionRequest(apiPath, context, attempt + 1);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body === "" ? "" : `: ${body.slice(0, 300)}`;
    throw new Error(`HTTP ${response.status} fetching Notion ${apiPath}${detail}`);
  }
  const payload = asObject(await response.json());
  if (!payload) {
    throw new Error(`Unexpected Notion response for ${apiPath}`);
  }
  return payload;
}

function retryAfterMs(value: string | null): number {
  const seconds = Number.parseFloat(value ?? "1");
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : 1000);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function richTextText(value: unknown): string {
  return asArray(value)
    .map((item) => firstString(asObject(item) ?? {}, ["plain_text"]))
    .join("");
}

function richTextMarkdown(value: unknown): string {
  return asArray(value).map(richTextItemMarkdown).join("");
}

function richTextItemMarkdown(item: unknown): string {
  const object = asObject(item);
  if (!object) {
    return "";
  }

  const plainText = asString(object.plain_text);
  if (plainText === "") {
    return "";
  }

  const annotations = asObject(object.annotations) ?? {};
  let rendered = escapeInlineMarkdown(plainText);
  if (annotations.code) {
    rendered = `\`${rendered.replace(/`/g, "\\`")}\``;
  } else {
    if (annotations.bold) {
      rendered = `**${rendered}**`;
    }
    if (annotations.italic) {
      rendered = `_${rendered}_`;
    }
    if (annotations.strikethrough) {
      rendered = `~~${rendered}~~`;
    }
  }

  const href = asString(object.href);
  if (href !== "") {
    return `[${rendered.replace(/\]/g, "\\]")}](${href.replace(/\)/g, "%29")})`;
  }
  return rendered;
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function pageTitle(page: JsonObject): string {
  const properties = asObject(page.properties) ?? {};
  for (const property of Object.values(properties)) {
    const object = asObject(property);
    if (object?.type === "title") {
      const title = richTextText(object.title);
      if (title) {
        return title;
      }
    }
  }
  return "Untitled Notion page";
}

async function fetchBlocks(blockId: string, context: NotionRequestContext): Promise<JsonObject[]> {
  const blocks: JsonObject[] = [];
  let startCursor: string | undefined;
  do {
    const params = new URLSearchParams({ page_size: "100" });
    if (startCursor !== undefined) {
      params.set("start_cursor", startCursor);
    }
    const payload = await notionRequest(
      `/blocks/${encodeURIComponent(blockId)}/children?${params.toString()}`,
      context,
    );
    blocks.push(...asObjects(payload.results));
    startCursor = asString(payload.next_cursor) || undefined;
    if (!payload.has_more) {
      break;
    }
  } while (startCursor !== undefined);
  return blocks;
}

function blockToMarkdown(block: JsonObject, depth: number): string[] {
  const blockType = asString(block.type);
  const data = asObject(block[blockType]) ?? {};
  const text = richTextMarkdown(data.rich_text);
  const plainText = richTextText(data.rich_text);
  const indent = "  ".repeat(depth);

  switch (blockType) {
    case "heading_1":
      return [`# ${text}`, ""];
    case "heading_2":
      return [`## ${text}`, ""];
    case "heading_3":
      return [`### ${text}`, ""];
    case "bulleted_list_item":
      return [`${indent}- ${text}`];
    case "numbered_list_item":
      return [`${indent}1. ${text}`];
    case "to_do": {
      const mark = data.checked ? "x" : " ";
      return [`${indent}- [${mark}] ${text}`];
    }
    case "quote":
    case "callout":
      return [`> ${text}`, ""];
    case "code": {
      const language = asString(data.language);
      return [`\`\`\`${language}`, plainText, "```", ""];
    }
    case "child_page":
      return [`${indent}- Child page: ${firstString(data, ["title"], "Child page")}`];
    case "divider":
      return ["---", ""];
    case "bookmark":
    case "embed":
    case "link_preview": {
      const url = asString(data.url);
      return url ? [`${indent}- ${url}`] : [`<!-- Unsupported Notion block: ${blockType} -->`, ""];
    }
    case "image":
    case "video":
    case "file":
    case "pdf":
    case "audio": {
      const url = mediaUrl(data);
      const caption = richTextMarkdown(data.caption) || blockType;
      return url
        ? [`${indent}- [${caption}](${url})`]
        : [`<!-- Unsupported Notion block: ${blockType} -->`, ""];
    }
    case "paragraph":
      return text ? [`${indent}${text}`, ""] : [""];
    default:
      return [`<!-- Unsupported Notion block: ${blockType || "unknown"} -->`, ""];
  }
}

function mediaUrl(data: JsonObject): string {
  const external = asObject(data.external);
  if (external) {
    return asString(external.url);
  }
  const file = asObject(data.file);
  return file ? asString(file.url) : "";
}

async function renderBlocks(
  blocks: JsonObject[],
  context: NotionRequestContext,
  depth = 0,
): Promise<string[]> {
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(...blockToMarkdown(block, depth));
    if (block.has_children && depth < 3) {
      const blockId = asString(block.id);
      if (blockId) {
        lines.push(
          ...(await renderBlocks(await fetchBlocks(blockId, context), context, depth + 1)),
        );
      }
    }
  }
  return lines;
}
