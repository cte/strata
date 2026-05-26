import {
  createModelAdapter as createSharedModelAdapter,
  defaultModel,
  getAnthropicCredentials,
  getChatGptCredentials,
  inferDefaultProvider,
  listModels,
  type ModelAdapter,
} from "@strata/agent";

import type { AuthStatusSummary, ProviderName } from "./state.js";

export { defaultModel, inferDefaultProvider, listModels };

export interface ModelChoice {
  provider: ProviderName;
  model: string;
}

export async function loadAuthStatus(): Promise<AuthStatusSummary> {
  const credentials = await getChatGptCredentials();
  const anthropicCredentials = await getAnthropicCredentials();
  const summary: AuthStatusSummary = {
    codexLoggedIn: credentials !== undefined,
    anthropicLoggedIn: anthropicCredentials !== undefined,
    apiKeyConfigured: Bun.env.STRATA_API_KEY !== undefined || Bun.env.OPENAI_API_KEY !== undefined,
  };
  if (credentials?.expiresAt !== undefined) {
    summary.codexExpiresAt = credentials.expiresAt;
  }
  if (anthropicCredentials?.expiresAt !== undefined) {
    summary.anthropicExpiresAt = anthropicCredentials.expiresAt;
  }
  return summary;
}

export async function createModelAdapter(choice: ModelChoice): Promise<ModelAdapter> {
  return createSharedModelAdapter(choice);
}
