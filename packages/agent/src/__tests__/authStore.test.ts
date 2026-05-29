import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ChatGptCredentials,
  clearChatGptCredentials,
  clearModelApiKey,
  getAuthStorePath,
  getChatGptCredentials,
  getModelApiKey,
  setChatGptCredentials,
  setModelApiKey,
} from "../authStore.js";

describe("auth store", () => {
  test("stores ChatGPT credentials in a 0600 repo-local auth file", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-auth-"));
    try {
      const credentials: ChatGptCredentials = {
        type: "chatgpt_oauth",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 60_000,
        accountId: "acct",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      };

      await setChatGptCredentials(credentials, repoRoot);
      await expect(getChatGptCredentials(repoRoot)).resolves.toEqual(credentials);

      const authPath = getAuthStorePath(repoRoot);
      const mode = (await stat(authPath)).mode & 0o777;
      expect(mode).toBe(0o600);

      await clearChatGptCredentials(repoRoot);
      await expect(getChatGptCredentials(repoRoot)).resolves.toBeUndefined();
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("stores provider API keys securely (0600) without disturbing OAuth", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-auth-"));
    try {
      await setModelApiKey(
        "openai",
        { apiKey: "sk-openai-123", baseUrl: "https://x/v1" },
        repoRoot,
      );
      await setModelApiKey("anthropic", { apiKey: "sk-ant-456" }, repoRoot);

      const openai = await getModelApiKey("openai", repoRoot);
      expect(openai?.apiKey).toBe("sk-openai-123");
      expect(openai?.baseUrl).toBe("https://x/v1");
      const anthropic = await getModelApiKey("anthropic", repoRoot);
      expect(anthropic?.apiKey).toBe("sk-ant-456");
      expect(anthropic?.baseUrl).toBeUndefined();

      const mode = (await stat(getAuthStorePath(repoRoot))).mode & 0o777;
      expect(mode).toBe(0o600);

      await clearModelApiKey("openai", repoRoot);
      await expect(getModelApiKey("openai", repoRoot)).resolves.toBeUndefined();
      // Clearing one target leaves the other intact.
      await expect(getModelApiKey("anthropic", repoRoot).then((k) => k?.apiKey)).resolves.toBe(
        "sk-ant-456",
      );
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
