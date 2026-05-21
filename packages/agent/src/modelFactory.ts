import { getChatGptCredentials } from "./authStore.js";
import { getValidChatGptCredentials } from "./chatgptOAuth.js";
import { OpenAICodexModelAdapter } from "./openaiCodex.js";
import { OpenAICompatibleChatModelAdapter } from "./openaiCompatible.js";
import type { ModelAdapter } from "./types.js";

export type ModelProviderName = "openai-codex" | "openai-compatible";

export interface CreateModelAdapterOptions {
  provider?: ModelProviderName;
  model?: string;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
}

export interface ModelEnvironmentOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
}

export interface ModelInfo {
  id: string;
  description: string;
}

export interface ListModelsOptions extends ModelEnvironmentOptions {
  signal?: AbortSignal;
}

export function parseModelProvider(value: string | undefined): ModelProviderName | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (value === "openai-codex" || value === "openai-compatible") {
    return value;
  }
  throw new Error("STRATA_PROVIDER must be openai-codex or openai-compatible");
}

export async function inferDefaultProvider(
  options: ModelEnvironmentOptions = {},
): Promise<ModelProviderName> {
  const env = options.env ?? Bun.env;
  if ((await getChatGptCredentials(options.repoRoot)) !== undefined) {
    return "openai-codex";
  }
  if (env.STRATA_API_KEY !== undefined || env.OPENAI_API_KEY !== undefined) {
    return "openai-compatible";
  }
  return "openai-codex";
}

export function defaultModel(
  provider: ModelProviderName,
  options: Pick<ModelEnvironmentOptions, "env"> = {},
): string {
  const env = options.env ?? Bun.env;
  if (provider === "openai-codex") {
    return env.STRATA_MODEL ?? "gpt-5.5";
  }
  return env.STRATA_MODEL ?? env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export async function listModels(
  provider: ModelProviderName,
  signalOrOptions?: AbortSignal | ListModelsOptions,
): Promise<ModelInfo[]> {
  const options = normalizeListModelsOptions(signalOrOptions);
  if (provider === "openai-codex") {
    return listCodexModels(options);
  }
  return listCompatibleModels(options);
}

export async function createModelAdapter(
  options: CreateModelAdapterOptions = {},
): Promise<ModelAdapter> {
  const env = options.env ?? Bun.env;
  const provider =
    options.provider ??
    parseModelProvider(env.STRATA_PROVIDER) ??
    (await inferDefaultProvider(options));

  if (provider === "openai-codex") {
    const credentials = await getValidChatGptCredentials(options.repoRoot);
    const codexOptions = {
      credentials,
      model: options.model ?? env.STRATA_MODEL ?? "gpt-5.5",
    };
    if (env.STRATA_CODEX_BASE_URL !== undefined) {
      return new OpenAICodexModelAdapter({
        ...codexOptions,
        baseUrl: env.STRATA_CODEX_BASE_URL,
      });
    }
    return new OpenAICodexModelAdapter(codexOptions);
  }

  const apiKey = env.STRATA_API_KEY ?? env.OPENAI_API_KEY;
  const model = options.model ?? env.STRATA_MODEL ?? env.OPENAI_MODEL;
  const baseUrl = env.STRATA_BASE_URL ?? env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("Missing model API key. Set STRATA_API_KEY or OPENAI_API_KEY.");
  }
  if (!model) {
    throw new Error("Missing model name. Set STRATA_MODEL or OPENAI_MODEL.");
  }

  const adapterOptions = {
    apiKey,
    model,
  };
  if (baseUrl !== undefined) {
    return new OpenAICompatibleChatModelAdapter({
      ...adapterOptions,
      baseUrl,
    });
  }
  return new OpenAICompatibleChatModelAdapter(adapterOptions);
}

function normalizeListModelsOptions(
  signalOrOptions: AbortSignal | ListModelsOptions | undefined,
): ListModelsOptions {
  if (signalOrOptions === undefined) {
    return {};
  }
  if (signalOrOptions instanceof AbortSignal) {
    return { signal: signalOrOptions };
  }
  return signalOrOptions;
}

async function listCodexModels(options: ListModelsOptions): Promise<ModelInfo[]> {
  const env = options.env ?? Bun.env;
  const credentials = await getValidChatGptCredentials(options.repoRoot);
  const baseUrl = (env.STRATA_CODEX_BASE_URL ?? "https://chatgpt.com/backend-api").replace(
    /\/+$/,
    "",
  );
  const init: RequestInit = {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  };
  if (options.signal !== undefined) {
    init.signal = options.signal;
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

async function listCompatibleModels(options: ListModelsOptions): Promise<ModelInfo[]> {
  const env = options.env ?? Bun.env;
  const apiKey = env.STRATA_API_KEY ?? env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error("Set STRATA_API_KEY or OPENAI_API_KEY to list OpenAI models.");
  }
  const baseUrl = (
    env.STRATA_BASE_URL ??
    env.OPENAI_BASE_URL ??
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const init: RequestInit = {
    headers: { Authorization: `Bearer ${apiKey}` },
  };
  if (options.signal !== undefined) {
    init.signal = options.signal;
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
