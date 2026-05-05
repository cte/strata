import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type ChatGptCredentials,
  clearChatGptCredentials,
  getAuthStorePath,
  getChatGptCredentials,
  setChatGptCredentials,
} from "./authStore.js";

describe("auth store", () => {
  test("stores ChatGPT credentials in a 0600 repo-local auth file", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-auth-"));
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
});
