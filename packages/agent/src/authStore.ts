import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrataPaths } from "@strata/core";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
export const ANTHROPIC_CLAUDE_PROVIDER_ID = "anthropic-claude";

export interface ChatGptCredentials {
  type: "chatgpt_oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnthropicCredentials {
  type: "anthropic_oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthStoreData {
  version: 1;
  credentials: {
    [OPENAI_CODEX_PROVIDER_ID]?: ChatGptCredentials;
    [ANTHROPIC_CLAUDE_PROVIDER_ID]?: AnthropicCredentials;
  };
}

export function getAuthStorePath(repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "auth.json");
}

export async function getChatGptCredentials(
  repoRoot?: string,
): Promise<ChatGptCredentials | undefined> {
  const data = await loadAuthStore(repoRoot);
  return data.credentials[OPENAI_CODEX_PROVIDER_ID];
}

export async function setChatGptCredentials(
  credentials: ChatGptCredentials,
  repoRoot?: string,
): Promise<void> {
  const data = await loadAuthStore(repoRoot);
  data.credentials[OPENAI_CODEX_PROVIDER_ID] = credentials;
  await saveAuthStore(data, repoRoot);
}

export async function clearChatGptCredentials(repoRoot?: string): Promise<void> {
  const data = await loadAuthStore(repoRoot);
  delete data.credentials[OPENAI_CODEX_PROVIDER_ID];
  await saveAuthStore(data, repoRoot);
}

export async function getAnthropicCredentials(
  repoRoot?: string,
): Promise<AnthropicCredentials | undefined> {
  const data = await loadAuthStore(repoRoot);
  return data.credentials[ANTHROPIC_CLAUDE_PROVIDER_ID];
}

export async function setAnthropicCredentials(
  credentials: AnthropicCredentials,
  repoRoot?: string,
): Promise<void> {
  const data = await loadAuthStore(repoRoot);
  data.credentials[ANTHROPIC_CLAUDE_PROVIDER_ID] = credentials;
  await saveAuthStore(data, repoRoot);
}

export async function clearAnthropicCredentials(repoRoot?: string): Promise<void> {
  const data = await loadAuthStore(repoRoot);
  delete data.credentials[ANTHROPIC_CLAUDE_PROVIDER_ID];
  await saveAuthStore(data, repoRoot);
}

export async function loadAuthStore(repoRoot?: string): Promise<AuthStoreData> {
  const authPath = getAuthStorePath(repoRoot);
  if (!existsSync(authPath)) {
    return emptyAuthStore();
  }

  const raw = await readFile(authPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!isAuthStoreData(parsed)) {
    throw new Error(`Invalid auth store format: ${authPath}`);
  }
  return parsed;
}

export async function saveAuthStore(data: AuthStoreData, repoRoot?: string): Promise<void> {
  const authPath = getAuthStorePath(repoRoot);
  await mkdir(path.dirname(authPath), { recursive: true, mode: 0o700 });
  await writeFile(authPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await chmod(authPath, 0o600);
}

function emptyAuthStore(): AuthStoreData {
  return {
    version: 1,
    credentials: {},
  };
}

function isAuthStoreData(value: unknown): value is AuthStoreData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AuthStoreData>;
  return (
    candidate.version === 1 &&
    typeof candidate.credentials === "object" &&
    candidate.credentials !== null
  );
}
