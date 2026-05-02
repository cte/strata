import {
  getChatGptCredentials,
  getValidChatGptCredentials,
  OpenAICodexModelAdapter,
  OpenAICompatibleChatModelAdapter,
  type ModelAdapter,
} from "@cortex/agent";
import type { AuthStatusSummary, ProviderName } from "./state.js";

export interface ModelChoice {
  provider: ProviderName;
  model: string;
}

export async function inferDefaultProvider(): Promise<ProviderName> {
  if (await getChatGptCredentials() !== undefined) {
    return "openai-codex";
  }
  if (Bun.env.CORTEX_API_KEY !== undefined || Bun.env.OPENAI_API_KEY !== undefined) {
    return "openai-compatible";
  }
  return "openai-codex";
}

export function defaultModel(provider: ProviderName): string {
  if (provider === "openai-codex") {
    return Bun.env.CORTEX_MODEL ?? "gpt-5.5";
  }
  return Bun.env.CORTEX_MODEL ?? Bun.env.OPENAI_MODEL ?? "gpt-4o-mini";
}

export async function loadAuthStatus(): Promise<AuthStatusSummary> {
  const credentials = await getChatGptCredentials();
  const summary: AuthStatusSummary = {
    codexLoggedIn: credentials !== undefined,
    apiKeyConfigured: Bun.env.CORTEX_API_KEY !== undefined || Bun.env.OPENAI_API_KEY !== undefined,
  };
  if (credentials?.expiresAt !== undefined) {
    summary.codexExpiresAt = credentials.expiresAt;
  }
  return summary;
}

export async function createModelAdapter(choice: ModelChoice): Promise<ModelAdapter> {
  if (choice.provider === "openai-codex") {
    const credentials = await getValidChatGptCredentials();
    const opts: { credentials: typeof credentials; model: string; baseUrl?: string } = {
      credentials,
      model: choice.model,
    };
    if (Bun.env.CORTEX_CODEX_BASE_URL !== undefined) {
      opts.baseUrl = Bun.env.CORTEX_CODEX_BASE_URL;
    }
    return new OpenAICodexModelAdapter(opts);
  }
  const apiKey = Bun.env.CORTEX_API_KEY ?? Bun.env.OPENAI_API_KEY;
  if (apiKey === undefined) {
    throw new Error("Missing model API key. Set CORTEX_API_KEY or OPENAI_API_KEY.");
  }
  const baseUrl = Bun.env.CORTEX_BASE_URL ?? Bun.env.OPENAI_BASE_URL;
  const opts: { apiKey: string; model: string; baseUrl?: string } = {
    apiKey,
    model: choice.model,
  };
  if (baseUrl !== undefined) {
    opts.baseUrl = baseUrl;
  }
  return new OpenAICompatibleChatModelAdapter(opts);
}
