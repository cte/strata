import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnthropicCredentials, ChatGptCredentials } from "../authStore.js";
import { setAnthropicCredentials, setChatGptCredentials, setModelApiKey } from "../authStore.js";

import {
  createModelAdapter,
  defaultModel,
  inferDefaultProvider,
  listModels,
  parseModelProvider,
} from "../modelFactory.js";

describe("model factory", () => {
  test("parses STRATA_PROVIDER values", () => {
    expect(parseModelProvider(undefined)).toBeUndefined();
    expect(parseModelProvider("")).toBeUndefined();
    expect(parseModelProvider("openai-codex")).toBe("openai-codex");
    expect(parseModelProvider("openai-compatible")).toBe("openai-compatible");
    expect(parseModelProvider("anthropic-claude")).toBe("anthropic-claude");
    expect(() => parseModelProvider("other")).toThrow(
      "STRATA_PROVIDER must be openai-codex, openai-compatible, or anthropic-claude",
    );
  });

  test("infers provider from repo-local auth before API key env", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await expect(inferDefaultProvider({ repoRoot, env: {} })).resolves.toBe("openai-codex");
      await expect(
        inferDefaultProvider({ repoRoot, env: { OPENAI_API_KEY: "sk-test" } }),
      ).resolves.toBe("openai-compatible");

      await setChatGptCredentials(fakeCredentials(), repoRoot);
      await expect(
        inferDefaultProvider({ repoRoot, env: { OPENAI_API_KEY: "sk-test" } }),
      ).resolves.toBe("openai-codex");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("resolves default display models from env", () => {
    expect(defaultModel("openai-codex", { env: {} })).toBe("gpt-5.5");
    expect(defaultModel("anthropic-claude", { env: {} })).toBe("claude-sonnet-4-6");
    expect(defaultModel("openai-compatible", { env: {} })).toBe("gpt-4o-mini");

    expect(defaultModel("openai-compatible", { env: { OPENAI_MODEL: "gpt-test" } })).toBe(
      "gpt-test",
    );
    expect(defaultModel("openai-codex", { env: { STRATA_MODEL: "gpt-codex-test" } })).toBe(
      "gpt-codex-test",
    );
  });

  test("creates codex adapters from repo-local ChatGPT auth", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await setChatGptCredentials(fakeCredentials(), repoRoot);
      const adapter = await createModelAdapter({
        provider: "openai-codex",
        repoRoot,
        env: { STRATA_MODEL: "gpt-codex-test" },
      });
      expect(adapter.name).toBe("openai-codex:gpt-codex-test");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports missing codex auth", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await expect(
        createModelAdapter({ provider: "openai-codex", repoRoot, env: {} }),
      ).rejects.toThrow("Not logged in with ChatGPT");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("creates Anthropic Claude adapters from repo-local auth", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await setAnthropicCredentials(fakeAnthropicCredentials(), repoRoot);
      const adapter = await createModelAdapter({
        provider: "anthropic-claude",
        repoRoot,
        env: { STRATA_MODEL: "claude-test" },
      });
      expect(adapter.name).toBe("anthropic-claude:claude-test");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports missing Anthropic auth", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await expect(
        createModelAdapter({ provider: "anthropic-claude", repoRoot, env: {} }),
      ).rejects.toThrow("Anthropic is not connected");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("creates OpenAI-compatible adapters from env", async () => {
    const adapter = await createModelAdapter({
      provider: "openai-compatible",
      env: { STRATA_API_KEY: "sk-test", STRATA_MODEL: "gpt-compatible-test" },
    });
    expect(adapter.name).toBe("openai-compatible:gpt-compatible-test");
  });

  test("uses a stored Anthropic API key when no OAuth is present", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await setModelApiKey("anthropic", { apiKey: "sk-ant-stored" }, repoRoot);
      const adapter = await createModelAdapter({
        provider: "anthropic-claude",
        repoRoot,
        env: {},
        model: "claude-sonnet-4-6",
      });
      expect(adapter.name).toBe("anthropic-claude:claude-sonnet-4-6");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("uses a stored OpenAI API key (and base URL) without env vars", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    try {
      await setModelApiKey(
        "openai",
        { apiKey: "sk-stored", baseUrl: "https://example.test/v1" },
        repoRoot,
      );
      const adapter = await createModelAdapter({
        provider: "openai-compatible",
        repoRoot,
        env: { STRATA_MODEL: "gpt-stored-test" },
      });
      expect(adapter.name).toBe("openai-compatible:gpt-stored-test");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports missing OpenAI-compatible key and model", async () => {
    await expect(
      createModelAdapter({ provider: "openai-compatible", model: "gpt-test", env: {} }),
    ).rejects.toThrow("Missing model API key");
    await expect(
      createModelAdapter({ provider: "openai-compatible", env: { STRATA_API_KEY: "sk-test" } }),
    ).rejects.toThrow("Missing model name");
  });

  test("lists OpenAI-compatible chat models", async () => {
    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = requestFromFetchArgs(args);
        seen.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
        });
        return Response.json({
          data: [
            { id: "text-embedding-3-small", owned_by: "openai" },
            { id: "gpt-zeta", owned_by: "owner-z" },
            { id: "gpt-alpha", owned_by: "owner-a" },
            { id: "gpt-alpha", owned_by: "duplicate" },
            { id: "dall-e-3", owned_by: "openai" },
          ],
        });
      },
      { preconnect: originalFetch.preconnect },
    ) satisfies typeof fetch;
    try {
      await expect(
        listModels("openai-compatible", {
          env: {
            STRATA_API_KEY: "sk-test",
            STRATA_BASE_URL: "https://openai.example/v1/",
          },
        }),
      ).resolves.toEqual([
        { id: "gpt-alpha", description: "owner-a" },
        { id: "gpt-zeta", description: "owner-z" },
      ]);
      expect(seen).toEqual([
        {
          url: "https://openai.example/v1/models",
          authorization: "Bearer sk-test",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("lists Anthropic Claude models", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));
    const originalFetch = globalThis.fetch;
    const seen: Array<{
      url: string;
      authorization: string | null;
      version: string | null;
      beta: string | null;
      directBrowserAccess: string | null;
      app: string | null;
    }> = [];
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = requestFromFetchArgs(args);
        seen.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
          version: request.headers.get("anthropic-version"),
          beta: request.headers.get("anthropic-beta"),
          directBrowserAccess: request.headers.get("anthropic-dangerous-direct-browser-access"),
          app: request.headers.get("x-app"),
        });
        return Response.json({
          data: [
            { id: "claude-zeta", display_name: "Zeta" },
            { id: "claude-alpha", display_name: "Alpha" },
          ],
        });
      },
      { preconnect: originalFetch.preconnect },
    ) satisfies typeof fetch;
    try {
      await setAnthropicCredentials(fakeAnthropicCredentials(), repoRoot);
      await expect(
        listModels("anthropic-claude", {
          repoRoot,
          env: { STRATA_ANTHROPIC_BASE_URL: "https://anthropic.example/v1/" },
        }),
      ).resolves.toEqual([
        { id: "claude-alpha", description: "Alpha" },
        { id: "claude-zeta", description: "Zeta" },
      ]);
      expect(seen).toEqual([
        {
          url: "https://anthropic.example/v1/models",
          authorization: "Bearer access",
          version: "2023-06-01",
          beta: "claude-code-20250219,oauth-2025-04-20",
          directBrowserAccess: "true",
          app: "cli",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists non-deprecated Codex models", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-model-factory-"));

    const originalFetch = globalThis.fetch;
    const seen: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request = requestFromFetchArgs(args);
        seen.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
        });
        return Response.json({
          models: [
            { slug: "gpt-zeta", display_name: "Zeta", deprecation_date: null },
            { slug: "gpt-old", display_name: "Old", deprecation_date: "2026-01-01" },
            { slug: "gpt-alpha", display_name: "Alpha", deprecation_date: null },
            { slug: 123, display_name: "Invalid", deprecation_date: null },
          ],
        });
      },
      { preconnect: originalFetch.preconnect },
    ) satisfies typeof fetch;
    try {
      await setChatGptCredentials(fakeCredentials(), repoRoot);
      await expect(
        listModels("openai-codex", {
          repoRoot,
          env: { STRATA_CODEX_BASE_URL: "https://codex.example/backend/" },
        }),
      ).resolves.toEqual([
        { id: "gpt-alpha", description: "Alpha" },
        { id: "gpt-zeta", description: "Zeta" },
      ]);
      expect(seen).toEqual([
        {
          url: "https://codex.example/backend/codex/models?client_version=1.0.0",
          authorization: "Bearer access",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function fakeCredentials(): ChatGptCredentials {
  return {
    type: "chatgpt_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
    accountId: "acct",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
}

function fakeAnthropicCredentials(): AnthropicCredentials {
  return {
    type: "anthropic_oauth",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60 * 60 * 1000,
    scopes: ["user:inference", "user:profile"],
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
  };
}

function requestFromFetchArgs(args: Parameters<typeof fetch>): Request {
  if (args[0] instanceof Request) {
    return args[0];
  }
  return new Request(args[0].toString(), args[1]);
}
