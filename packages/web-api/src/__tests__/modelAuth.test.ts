import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AnthropicCredentials,
  type ChatGptCredentials,
  getAnthropicCredentials,
  getChatGptCredentials,
  getModelApiKey,
  setAnthropicCredentials,
  setChatGptCredentials,
  setModelApiKey as setStoredModelApiKey,
} from "@strata/agent";
import { disconnectModelAuth, getModelAuthStatus, setModelApiKey } from "../modelAuth.js";

async function tempRepo(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "strata-model-auth-"));
}

function chatGptCredentials(): ChatGptCredentials {
  return {
    type: "chatgpt_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
    accountId: "acct",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

function anthropicCredentials(): AnthropicCredentials {
  return {
    type: "anthropic_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
    scopes: ["user:inference"],
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

describe("model auth mutual exclusivity", () => {
  test("setting an OpenAI API key clears any OpenAI OAuth credentials", async () => {
    const repoRoot = await tempRepo();
    try {
      await setChatGptCredentials(chatGptCredentials(), repoRoot);

      const status = await setModelApiKey(
        { target: "openai", apiKey: "sk-openai-1234" },
        { repoRoot },
      );

      expect(await getChatGptCredentials(repoRoot)).toBeUndefined();
      const openaiKey = status.apiKeys.find((k) => k.target === "openai");
      expect(openaiKey?.configured).toBe(true);
      expect(openaiKey?.hint).toBe("…1234");
      const codex = status.providers.find((p) => p.provider === "openai-codex");
      expect(codex?.authenticated).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("setting an Anthropic API key clears any Anthropic OAuth credentials", async () => {
    const repoRoot = await tempRepo();
    try {
      await setAnthropicCredentials(anthropicCredentials(), repoRoot);

      const status = await setModelApiKey(
        { target: "anthropic", apiKey: "sk-ant-5678" },
        { repoRoot },
      );

      expect(await getAnthropicCredentials(repoRoot)).toBeUndefined();
      const anthropicKey = status.apiKeys.find((k) => k.target === "anthropic");
      expect(anthropicKey?.configured).toBe(true);
      const claude = status.providers.find((p) => p.provider === "anthropic-claude");
      expect(claude?.authenticated).toBe(false);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("a stored key for one provider survives the other provider's OAuth connect/disconnect", async () => {
    const repoRoot = await tempRepo();
    try {
      // Anthropic uses an API key; OpenAI uses OAuth — independent providers.
      await setStoredModelApiKey("anthropic", { apiKey: "sk-ant-keep-9999" }, repoRoot);
      await setChatGptCredentials(chatGptCredentials(), repoRoot);

      // Disconnecting OpenAI OAuth must not touch the Anthropic key.
      const status = await disconnectModelAuth("openai-codex", { repoRoot });

      expect(await getChatGptCredentials(repoRoot)).toBeUndefined();
      expect((await getModelApiKey("anthropic", repoRoot))?.apiKey).toBe("sk-ant-keep-9999");
      expect(status.apiKeys.find((k) => k.target === "anthropic")?.configured).toBe(true);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
