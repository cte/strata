import { createHash } from "node:crypto";
import path from "node:path";
import { readTextFileOrUndefined, writeTextFile } from "./fileStore.js";

export type WikiActionOwner = "mine" | "theirs";
export type WikiActionStatusFilter = "all" | "open" | "done";
export type WikiActionOwnerFilter = "all" | WikiActionOwner;

export interface WikiActionSource {
  target: string;
  label: string;
  raw: string;
}

export type WikiActionContextMetadata = Record<string, string | number | boolean | null>;

export interface WikiActionItem {
  id: string;
  owner: WikiActionOwner;
  ownerLabel: string;
  path: string;
  line: number;
  completed: boolean;
  title: string;
  body: string;
  context: string;
  source?: WikiActionSource;
  sourceDate?: string;
  createdAt?: string;
  contextUpdatedAt?: string;
}

export interface WikiActionListInput {
  owner?: WikiActionOwnerFilter;
  status?: WikiActionStatusFilter;
  query?: string;
}

export interface WikiActionUpdateInput {
  id: string;
  completed?: boolean;
  context?: string;
  now?: Date;
}

export interface WikiActionAddInput {
  owner: WikiActionOwner;
  title: string;
  context?: string;
  source?: Pick<WikiActionSource, "target" | "label">;
  metadata?: WikiActionContextMetadata;
  now?: Date;
}

interface ParsedWikiActionItem extends WikiActionItem {
  lineIndex: number;
  contextLineIndex: number | null;
  occurrence: number;
  fingerprint: string;
  contextMetadata: WikiActionContextMetadata;
}

const ACTION_PATHS: Record<WikiActionOwner, string> = {
  mine: "wiki/actions/mine.md",
  theirs: "wiki/actions/theirs.md",
};

const DEFAULT_HEADINGS: Record<WikiActionOwner, string> = {
  mine: "# What I Owe Others",
  theirs: "# What Others Owe Me",
};

const TASK_LINE_PATTERN = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const CONTEXT_LINE_PATTERN = /^\s*<!--\s*strata:action-context\s+(.+?)\s*-->\s*$/;
const SOURCE_SUFFIX_PATTERN = /\s+\(source:\s*(\[\[([^\]|]+)(?:\|([^\]]+))?\]\])\)\s*$/;

export async function listWikiActions(
  repoRoot: string,
  input: WikiActionListInput = {},
): Promise<WikiActionItem[]> {
  const ownerFilter = input.owner ?? "all";
  const statusFilter = input.status ?? "open";
  const query = normalizeQuery(input.query ?? "");
  const owners: WikiActionOwner[] = ownerFilter === "all" ? ["mine", "theirs"] : [ownerFilter];

  const lists = await Promise.all(owners.map((owner) => readOwnerActions(repoRoot, owner)));
  return lists.flat().filter((item) => {
    if (statusFilter === "open" && item.completed) {
      return false;
    }
    if (statusFilter === "done" && !item.completed) {
      return false;
    }
    if (query.length === 0) {
      return true;
    }
    return actionSearchText(item).includes(query);
  });
}

export async function updateWikiAction(
  repoRoot: string,
  input: WikiActionUpdateInput,
): Promise<WikiActionItem> {
  const parsedId = parseActionId(input.id);
  const owner = parsedId.owner;
  const absolutePath = path.join(repoRoot, ACTION_PATHS[owner]);
  const existing = await readTextFileOrUndefined(absolutePath);
  if (existing === undefined) {
    throw new Error(`Action ledger not found: ${ACTION_PATHS[owner]}`);
  }

  const parsed = parseWikiActionContent(owner, ACTION_PATHS[owner], existing);
  const item = parsed.find((candidate) => candidate.id === input.id);
  if (item === undefined) {
    throw new Error(`Action item not found: ${input.id}`);
  }

  const lines = splitLines(existing);
  let changed = false;

  if (input.completed !== undefined && input.completed !== item.completed) {
    const taskLine = lines[item.lineIndex];
    if (taskLine === undefined) {
      throw new Error(`Action line not found: ${input.id}`);
    }
    lines[item.lineIndex] = taskLine.replace(TASK_LINE_PATTERN, (_match, indent: string) => {
      return `${indent}- [${input.completed ? "x" : " "}] ${item.body}`;
    });
    changed = true;
  }

  if (input.context !== undefined) {
    const nextContext = input.context.trim();
    if (nextContext.length === 0) {
      if (item.contextLineIndex !== null) {
        if (item.createdAt === undefined && !hasPersistentContextMetadata(item.contextMetadata)) {
          lines.splice(item.contextLineIndex, 1);
        } else {
          lines[item.contextLineIndex] = contextMetadataLine("", input.now ?? new Date(), {
            ...contextMetadataOptions(item.contextMetadata, item.createdAt),
          });
        }
        changed = true;
      }
    } else if (nextContext !== item.context) {
      const contextLine = contextMetadataLine(nextContext, input.now ?? new Date(), {
        ...contextMetadataOptions(item.contextMetadata, item.createdAt),
      });
      if (item.contextLineIndex === null) {
        lines.splice(item.lineIndex + 1, 0, contextLine);
      } else {
        lines[item.contextLineIndex] = contextLine;
      }
      changed = true;
    }
  }

  if (!changed) {
    return stripParserFields(item);
  }

  const updated = updateFrontmatterLastUpdated(joinLines(lines), input.now ?? new Date());
  await writeTextFile(absolutePath, updated);
  const nextItem = parseWikiActionContent(owner, ACTION_PATHS[owner], updated).find(
    (candidate) => candidate.id === input.id,
  );
  if (nextItem === undefined) {
    throw new Error(`Updated action item could not be reread: ${input.id}`);
  }
  return stripParserFields(nextItem);
}

export async function addWikiAction(
  repoRoot: string,
  input: WikiActionAddInput,
): Promise<WikiActionItem> {
  const title = normalizeActionTitle(input.title);
  const body = input.source === undefined ? title : `${title}${sourceSuffix(input.source)}`;
  const ledgerPath = ACTION_PATHS[input.owner];
  const absolutePath = path.join(repoRoot, ledgerPath);
  const now = input.now ?? new Date();
  const existing =
    (await readTextFileOrUndefined(absolutePath)) ?? defaultActionContent(input.owner, now);

  const lines = splitLines(existing);
  while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") {
    lines.pop();
  }
  lines.push(`- [ ] ${body}`);
  const context = input.context?.trim() ?? "";
  const metadataOptions: { createdAt: string; metadata?: WikiActionContextMetadata } = {
    createdAt: now.toISOString(),
  };
  if (input.metadata !== undefined) {
    metadataOptions.metadata = input.metadata;
  }
  lines.push(contextMetadataLine(context, now, metadataOptions));
  lines.push("");

  const updated = updateFrontmatterLastUpdated(joinLines(lines), now);
  await writeTextFile(absolutePath, updated);
  const parsed = parseWikiActionContent(input.owner, ledgerPath, updated);
  const added = parsed.at(-1);
  if (added === undefined) {
    throw new Error(`Added action item could not be reread: ${ledgerPath}`);
  }
  return stripParserFields(added);
}

export function parseWikiActionContent(
  owner: WikiActionOwner,
  relativePath: string,
  content: string,
): ParsedWikiActionItem[] {
  const lines = splitLines(content);
  const occurrenceByFingerprint = new Map<string, number>();
  const items: ParsedWikiActionItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = TASK_LINE_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    const status = match[2] ?? " ";
    const body = (match[3] ?? "").trim();
    if (body.length === 0) {
      continue;
    }
    const fingerprint = actionFingerprint(owner, body);
    const occurrence = (occurrenceByFingerprint.get(fingerprint) ?? 0) + 1;
    occurrenceByFingerprint.set(fingerprint, occurrence);

    const nextLine = lines[index + 1] ?? "";
    const context = parseContextLine(nextLine);
    const source = parseSource(body);
    const sourceDate = source === undefined ? undefined : dateFromSource(source);
    const sourceProps =
      source === undefined
        ? {}
        : {
            source,
          };
    const sourceDateProps =
      sourceDate === undefined
        ? {}
        : {
            sourceDate,
          };
    const createdAtProps =
      context.createdAt === undefined
        ? {}
        : {
            createdAt: context.createdAt,
          };
    const contextUpdatedAtProps =
      context.updatedAt === undefined
        ? {}
        : {
            contextUpdatedAt: context.updatedAt,
          };

    items.push({
      id: actionId(owner, fingerprint, occurrence),
      owner,
      ownerLabel: owner === "mine" ? "Mine" : "Others",
      path: relativePath,
      line: index + 1,
      lineIndex: index,
      contextLineIndex: context.found ? index + 1 : null,
      occurrence,
      fingerprint,
      contextMetadata: context.metadata,
      completed: status.toLowerCase() === "x",
      title: actionTitle(body),
      body,
      context: context.value,
      ...sourceProps,
      ...sourceDateProps,
      ...createdAtProps,
      ...contextUpdatedAtProps,
    });
  }

  return items;
}

function parseActionId(id: string): { owner: WikiActionOwner } {
  const match = /^wiki_action_(mine|theirs)_[a-f0-9]{16}_\d+$/.exec(id);
  if (match === null) {
    throw new Error(`Invalid action id: ${id}`);
  }
  const owner = match[1];
  if (owner !== "mine" && owner !== "theirs") {
    throw new Error(`Invalid action owner in id: ${id}`);
  }
  return { owner };
}

async function readOwnerActions(
  repoRoot: string,
  owner: WikiActionOwner,
): Promise<WikiActionItem[]> {
  const relativePath = ACTION_PATHS[owner];
  const content = await readTextFileOrUndefined(path.join(repoRoot, relativePath));
  if (content === undefined) {
    return [];
  }
  return parseWikiActionContent(owner, relativePath, content).map(stripParserFields);
}

function actionId(owner: WikiActionOwner, fingerprint: string, occurrence: number): string {
  return `wiki_action_${owner}_${fingerprint}_${occurrence}`;
}

function actionFingerprint(owner: WikiActionOwner, body: string): string {
  return createHash("sha256")
    .update(`${owner}\n${normalizeTaskBody(body)}`)
    .digest("hex")
    .slice(0, 16);
}

function normalizeTaskBody(body: string): string {
  return body.trim().replace(/\s+/g, " ");
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeActionTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    throw new Error("Action title is required.");
  }
  return normalized;
}

function sourceSuffix(source: Pick<WikiActionSource, "target" | "label">): string {
  const target = normalizeWikiLinkPart(source.target, "Action source target is required.");
  const label = normalizeWikiLinkPart(source.label, "Action source label is required.");
  return ` (source: [[${target}|${label}]])`;
}

function normalizeWikiLinkPart(value: string, message: string): string {
  const normalized = value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\]\r\n]/g, " ");
  if (normalized.length === 0) {
    throw new Error(message);
  }
  return normalized;
}

function actionSearchText(item: WikiActionItem): string {
  return [
    item.title,
    item.body,
    item.context,
    item.ownerLabel,
    item.source?.label ?? "",
    item.source?.target ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function actionTitle(body: string): string {
  return body.replace(SOURCE_SUFFIX_PATTERN, "").trim();
}

function parseSource(body: string): WikiActionSource | undefined {
  const match = SOURCE_SUFFIX_PATTERN.exec(body);
  if (match === null) {
    return undefined;
  }
  const raw = match[1];
  const target = match[2];
  if (raw === undefined || target === undefined) {
    return undefined;
  }
  return {
    raw,
    target,
    label: match[3] ?? target,
  };
}

function dateFromSource(source: WikiActionSource): string | undefined {
  return firstDateLike(source.target) ?? firstDateLike(source.raw);
}

function firstDateLike(value: string): string | undefined {
  const match = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(value);
  return match?.[1];
}

function parseContextLine(line: string): {
  found: boolean;
  value: string;
  updatedAt?: string;
  createdAt?: string;
  metadata: WikiActionContextMetadata;
} {
  const match = CONTEXT_LINE_PATTERN.exec(line);
  if (match === null) {
    return { found: false, value: "", metadata: {} };
  }
  const encoded = match[1] ?? "";
  try {
    const parsed = JSON.parse(encoded) as unknown;
    const object =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const metadata = parseContextMetadata(object);
    const context = typeof object.context === "string" ? object.context : "";
    const updatedAt = typeof object.updatedAt === "string" ? object.updatedAt : undefined;
    const createdAt = typeof object.createdAt === "string" ? object.createdAt : undefined;
    return {
      found: true,
      value: context,
      metadata,
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(createdAt === undefined ? {} : { createdAt }),
    };
  } catch {
    return { found: true, value: "", metadata: {} };
  }
}

function contextMetadataLine(
  context: string,
  now: Date,
  options: { createdAt?: string; metadata?: WikiActionContextMetadata } = {},
): string {
  const metadata: WikiActionContextMetadata = { ...(options.metadata ?? {}) };
  delete metadata.context;
  delete metadata.updatedAt;
  delete metadata.createdAt;
  if (context.length > 0) {
    metadata.context = context;
    metadata.updatedAt = now.toISOString();
  }
  if (options.createdAt !== undefined) {
    metadata.createdAt = options.createdAt;
  }
  return `  <!-- strata:action-context ${JSON.stringify(metadata)} -->`;
}

function contextMetadataOptions(
  metadata: WikiActionContextMetadata,
  createdAt: string | undefined,
): { createdAt?: string; metadata?: WikiActionContextMetadata } {
  const options: { createdAt?: string; metadata?: WikiActionContextMetadata } = {};
  if (hasPersistentContextMetadata(metadata)) {
    options.metadata = metadata;
  }
  if (createdAt !== undefined) {
    options.createdAt = createdAt;
  }
  return options;
}

function hasPersistentContextMetadata(metadata: WikiActionContextMetadata): boolean {
  return Object.keys(metadata).some(
    (key) => key !== "context" && key !== "updatedAt" && key !== "createdAt",
  );
}

function parseContextMetadata(value: unknown): WikiActionContextMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const metadata: WikiActionContextMetadata = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean" ||
      item === null
    ) {
      metadata[key] = item;
    }
  }
  return metadata;
}

function defaultActionContent(owner: WikiActionOwner, now: Date): string {
  return [
    "---",
    "type: actions",
    `owner: ${owner === "mine" ? "me" : "others"}`,
    `last_updated: ${dateOnly(now)}`,
    "---",
    "",
    DEFAULT_HEADINGS[owner],
    "",
  ].join("\n");
}

function updateFrontmatterLastUpdated(content: string, now: Date): string {
  const date = dateOnly(now);
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---", 4);
  if (end === -1) {
    return content;
  }
  const before = content.slice(0, end);
  const after = content.slice(end);
  if (/^last_updated:\s*.*$/m.test(before)) {
    return before.replace(/^last_updated:\s*.*$/m, `last_updated: ${date}`) + after;
  }
  return `${before}\nlast_updated: ${date}${after}`;
}

function stripParserFields(item: ParsedWikiActionItem): WikiActionItem {
  const {
    lineIndex: _lineIndex,
    contextLineIndex: _contextLineIndex,
    occurrence: _occurrence,
    fingerprint: _fingerprint,
    contextMetadata: _contextMetadata,
    ...publicItem
  } = item;
  return publicItem;
}

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  if (normalized.endsWith("\n")) {
    return normalized.slice(0, -1).split("\n");
  }
  return normalized.split("\n");
}

function joinLines(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
