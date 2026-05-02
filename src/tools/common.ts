import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type YamlValue = null | boolean | number | string | string[];

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const wikiRoot = path.join(repoRoot, "wiki");

export function utcNow(): Date {
  return new Date();
}

export function todayIso(): string {
  return utcNow().toISOString().slice(0, 10);
}

export function slugify(value: string, fallback = "untitled"): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadDotenv(envPath = path.join(repoRoot, ".env")): Promise<void> {
  if (!(await exists(envPath))) {
    return;
  }

  const text = await readFile(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [keyPart, ...valueParts] = line.split("=");
    const key = keyPart?.trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    const rawValue = valueParts.join("=").trim();
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function yamlScalar(value: Exclude<YamlValue, string[]>): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (value === "") {
    return '""';
  }
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function frontmatter(mapping: Record<string, YamlValue>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(mapping)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          lines.push(`  - ${yamlScalar(item)}`);
        }
      }
    } else {
      lines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

export function splitFrontmatter(text: string): { metadata: Record<string, string>; body: string } {
  if (!text.startsWith("---\n")) {
    return { metadata: {}, body: text };
  }
  const end = text.indexOf("\n---", 4);
  if (end === -1) {
    return { metadata: {}, body: text };
  }
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\n/, "");
  const metadata: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes(":") || line.startsWith(" ")) {
      continue;
    }
    const [keyPart, ...valueParts] = line.split(":");
    const key = keyPart?.trim();
    if (key) {
      metadata[key] = valueParts.join(":").trim().replace(/^"|"$/g, "");
    }
  }
  return { metadata, body };
}

export async function writeOnce(filePath: string, content: string): Promise<boolean> {
  if (await exists(filePath)) {
    return false;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return true;
}

export function parseIsoDate(value: string | undefined): Date | null {
  if (!value || value === "null" || value === "None") {
    return null;
  }
  const normalized = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateDiffDays(later: Date, earlier: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((later.getTime() - earlier.getTime()) / msPerDay);
}

export async function appendLog(op: string, title: string): Promise<void> {
  const logPath = path.join(wikiRoot, "log.md");
  const timestamp = utcNow().toISOString().slice(0, 16).replace("T", " ");
  const entry = `\n\n## [${timestamp}] ${op} | ${title}\n`;
  const existing = (await exists(logPath))
    ? await readFile(logPath, "utf8")
    : "# Cortex — Activity Log\n";
  await writeFile(logPath, `${existing.trimEnd()}${entry}`, "utf8");
}

export function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asObjects(value: unknown): JsonObject[] {
  return asArray(value).flatMap((item) => {
    const object = asObject(item);
    return object ? [object] : [];
  });
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function firstString(item: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const value = item[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return fallback;
}

export function requireString(value: string | undefined, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}
