import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { THINKING_LEVELS, type ThinkingLevel } from "@cortex/agent";
import type { ProviderName } from "./state.js";

export interface Preferences {
  provider?: ProviderName;
  model?: string;
  reasoningEffort?: ThinkingLevel;
}

const FILE_NAME = "preferences.json";

export async function loadPreferences(runtimeDir: string): Promise<Preferences> {
  let raw: string;
  try {
    raw = await readFile(path.join(runtimeDir, FILE_NAME), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== "object") {
    return {};
  }
  const obj = parsed as Record<string, unknown>;
  const out: Preferences = {};
  if (obj.provider === "openai-codex" || obj.provider === "openai-compatible") {
    out.provider = obj.provider;
  }
  if (typeof obj.model === "string" && obj.model !== "") {
    out.model = obj.model;
  }
  if (
    typeof obj.reasoningEffort === "string" &&
    (THINKING_LEVELS as readonly string[]).includes(obj.reasoningEffort)
  ) {
    out.reasoningEffort = obj.reasoningEffort as ThinkingLevel;
  }
  return out;
}

export async function savePreferences(runtimeDir: string, prefs: Preferences): Promise<void> {
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(path.join(runtimeDir, FILE_NAME), `${JSON.stringify(prefs, null, 2)}\n`, "utf8");
}
