import {
  getChatGptCredentials,
  getValidChatGptCredentials,
  type ModelAdapter,
  OpenAICodexModelAdapter,
  OpenAICompatibleChatModelAdapter,
} from "@strata/agent";
import type { AuthStatusSummary, ProviderName } from "./state.js";

export interface ModelChoice {
  provider: ProviderName;
  model: string;
}

export async function inferDefaultProvider(): Promise<ProviderName> {
  if ((await getChatGptCredentials()) !== undefined) {
    return "openai-codex";
  }
  if (Bun.env.STRATA_API_KEY !== undefined || Bun.env.OPENAI_API_KEY !== undefined) {
    return "openai-compatible";
  }
  return "openai-codex";
}

export function defaultModel(provider: ProviderName): string {
  if (provider === "openai-codex") {
    return Bun.env.STRATA_MODEL ?? "gpt-5.5";
  }
  return Bun.env.STRATA_MODEL ?? Bun.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export async function loadAuthStatus(): Promise<AuthStatusSummary> {
  const credentials = await getChatGptCredentials();
  const summary: AuthStatusSummary = {
    codexLoggedIn: credentials !== undefined,
    apiKeyConfigured: Bun.env.STRATA_API_KEY !== undefined || Bun.env.OPENAI_API_KEY !== undefined,
  };
  if (credentials?.expiresAt !== undefined) {
    summary.codexExpiresAt = credentials.expiresAt;
  }
  return summary;
}

export interface ModelInfo {
  id: string;
  description: string;
}

export async function listModels(
  provider: ProviderName,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  if (provider === "openai-codex") {
    return listCodexModels(signal);
  }
  return listCompatibleModels(signal);
}

async function listCodexModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const credentials = await getValidChatGptCredentials();
  const baseUrl = (Bun.env.STRATA_CODEX_BASE_URL ?? "https://chatgpt.com/backend-api").replace(
    /\/+$/,
    "",
  );
  const init: RequestInit = {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(`${baseUrl}/codex/models?client_version=1.0.0`, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body === "" ? "" : `: ${body.slice(0, 200)}`;
    throw new Error(`codex ${response.status} ${response.statusText}${detail}`);
  }
  const payload = (await response.json()) as {
    models?: { slug?: unknown; display_name?: unknown; deprecation_date?: unknown }[];
  };
  const out: ModelInfo[] = [];
  for (const entry of payload.models ?? []) {
    if (typeof entry.slug !== "string") {
      continue;
    }
    if (entry.deprecation_date !== null && entry.deprecation_date !== undefined) {
      continue;
    }
    out.push({
      id: entry.slug,
      description: typeof entry.display_name === "string" ? entry.display_name : "",
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

async function listCompatibleModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const apiKey = Bun.env.STRATA_API_KEY ?? Bun.env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error("Set STRATA_API_KEY or OPENAI_API_KEY to list OpenAI models.");
  }
  const baseUrl = (
    Bun.env.STRATA_BASE_URL ??
    Bun.env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const init: RequestInit = {
    headers: { Authorization: `Bearer ${apiKey}` },
  };
  if (signal !== undefined) {
    init.signal = signal;
  }
  const response = await fetch(`${baseUrl}/models`, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body === "" ? "" : `: ${body.slice(0, 200)}`;
    throw new Error(`OpenAI ${response.status} ${response.statusText}${detail}`);
  }
  const payload = (await response.json()) as { data?: { id?: unknown; owned_by?: unknown }[] };
  const seen = new Set<string>();
  const models: ModelInfo[] = [];
  for (const entry of payload.data ?? []) {
    if (typeof entry.id !== "string" || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    if (!isChatModel(entry.id)) {
      continue;
    }
    models.push({
      id: entry.id,
      description: typeof entry.owned_by === "string" ? entry.owned_by : "",
    });
  }
  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

const CHAT_PREFIXES = ["gpt-", "chatgpt-", "o1", "o3", "o4"];
const NON_CHAT_FRAGMENTS = [
  "embedding",
  "embed",
  "audio",
  "realtime",
  "tts",
  "whisper",
  "dall",
  "transcribe",
  "moderation",
  "search",
  "image",
  "instruct",
];

function isChatModel(id: string): boolean {
  if (!CHAT_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return false;
  }
  return !NON_CHAT_FRAGMENTS.some((frag) => id.includes(frag));
}

export async function createModelAdapter(choice: ModelChoice): Promise<ModelAdapter> {
  if (choice.provider === "openai-codex") {
    const credentials = await getValidChatGptCredentials();
    const opts: { credentials: typeof credentials; model: string; baseUrl?: string } = {
      credentials,
      model: choice.model,
    };
    if (Bun.env.STRATA_CODEX_BASE_URL !== undefined) {
      opts.baseUrl = Bun.env.STRATA_CODEX_BASE_URL;
    }
    return new OpenAICodexModelAdapter(opts);
  }
  const apiKey = Bun.env.STRATA_API_KEY ?? Bun.env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error("Missing model API key. Set STRATA_API_KEY or OPENAI_API_KEY.");
  }
  const baseUrl = Bun.env.STRATA_BASE_URL ?? Bun.env.OPENAI_BASE_URL;
  const opts: { apiKey: string; model: string; baseUrl?: string } = {
    apiKey,
    model: choice.model,
  };
  if (baseUrl !== undefined) {
    opts.baseUrl = baseUrl;
  }
  return new OpenAICompatibleChatModelAdapter(opts);
}
