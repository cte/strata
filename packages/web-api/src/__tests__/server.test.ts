import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import os from "node:os";
import path from "node:path";
import {
  type AgentRunConfig,
  type AgentRunEvent,
  type AgentRunResult,
  type ModelAdapter,
} from "@strata/agent";
import { writeLearningProposal } from "@strata/core/proposal-store";
import { SessionStore } from "@strata/core/session-store";
import {
  DAILY_TODO_EXTRACTION,
  type DailyTodoExtractionResult,
  extractionCandidateStorageIdForResult,
  extractionRunIdForSession,
  persistDailyTodoExtractionResult,
  type TodoCandidateResult,
} from "@strata/ingest/extraction";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createWebApiHandler } from "../server.js";
import type { AppRouter } from "../trpc.js";

describe("web api", () => {
  test("lists connector setup state without exposing secrets", async () => {
    const handler = createWebApiHandler({
      repoRoot: "/tmp/strata",
      env: { NOTION_TOKEN: "secret_should_not_render" },
    });

    const response = await handler(new Request("http://127.0.0.1/api/connectors"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("notion");
    expect(text).toContain("Token configured");
    expect(text).not.toContain("secret_should_not_render");
  });

  test("dry-runs Notion through a trace-backed session", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: { NOTION_TOKEN: "secret" },
        fetchImpl: fakeNotionFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);

      try {
        const body = await client.connectors.notion.dryRun.mutate({ pageId: "page_123" });
        expect(body.connector).toBe("notion");
        expect(body.rawPath).toBe("wiki/raw/notion/2026-05-04-strategy-doc.md");
        expect(body.dryRun).toBe(true);
        expect(typeof body.sessionId).toBe("string");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("runs a connector workflow with optional wiki indexing through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: { NOTION_TOKEN: "secret" },
        fetchImpl: fakeNotionFetch(),
        now: new Date("2026-05-05T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);

      try {
        const result = await client.connectors.run.mutate({
          connector: "notion",
          operation: "pull",
          config: { pageId: "page_123" },
          index: true,
          refreshSearchIndex: true,
        });
        expect(result.connector).toBe("notion");
        expect(result.connectorResult.rawPath).toBe("wiki/raw/notion/2026-05-04-strategy-doc.md");
        expect(result.metrics).toMatchObject({
          itemCount: 1,
          writtenCount: 1,
          indexedCount: 1,
        });
        expect(result.rawToWiki?.indexed[0]?.primaryPath).toBe("wiki/projects/strategy-doc.md");
        expect(result.searchIndex?.indexed).toBeGreaterThan(0);
        await access(path.join(repoRoot, "wiki/projects/strategy-doc.md"));
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("manages non-secret connector config profiles through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {},
        now: new Date("2026-05-27T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);

      try {
        const saved = await client.connectors.config.save.mutate({
          connector: "slack",
          id: "team-sync",
          label: "Team sync",
          config: {
            channels: "engineering,product",
            includePrivateChannels: true,
            maxThreads: 100,
            mode: "sync",
          },
          makeDefault: true,
        });
        expect(saved.defaultProfile).toMatchObject({
          id: "team-sync",
          isDefault: true,
          config: {
            channels: "engineering,product",
            includePrivateChannels: true,
            maxThreads: 100,
            mode: "sync",
          },
        });
        expect(JSON.stringify(saved)).not.toContain("secret");

        await expect(
          client.connectors.config.save.mutate({
            connector: "slack",
            config: {
              userToken: "xoxp-secret_should_not_store",
            },
          }),
        ).rejects.toThrow("userToken");

        const deleted = await client.connectors.config.delete.mutate({
          connector: "slack",
          id: "team-sync",
        });
        expect(deleted.profiles).toEqual([]);
        expect(deleted.defaultProfile).toBeNull();
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists normalized ingest activity through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const store = await SessionStore.open(repoRoot);
      let sessionId = "";
      try {
        const session = await store.createSession({
          kind: "ingest",
          title: "Index 1 slack raw file",
        });
        sessionId = session.id;
        await store.appendEvent(session.id, "raw_to_wiki.index.started", {
          rawPaths: ["wiki/raw/slack/2026-05-27-thread.md"],
          dryRun: false,
          source: "slack",
        });
        await store.appendEvent(session.id, "raw_to_wiki.index.item", {
          source: "slack",
          rawPath: "wiki/raw/slack/2026-05-27-thread.md",
          primaryKind: "source",
          primaryPath: "wiki/sources/slack/c123/2026-05-27-thread.md",
          title: "Thread",
          date: "2026-05-27",
          peoplePaths: [],
          projectPaths: ["wiki/projects/support.md"],
          decisionPaths: [],
          threadPaths: [],
          actionCount: 0,
          writtenPaths: ["wiki/sources/slack/c123/2026-05-27-thread.md"],
          dryRun: false,
        });
        await store.appendEvent(session.id, "raw_to_wiki.index.completed", {
          scanned: 1,
          indexedCount: 1,
          skipped: [],
          dryRun: false,
          source: "slack",
        });
        await store.endSession(session.id, "completed");
      } finally {
        store.close();
      }

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const list = await client.activity.list.query({ limit: 5, source: "slack" });
        expect(list.runs[0]).toMatchObject({
          sessionId,
          source: "slack",
          operation: "raw.index",
          counts: { rawIndexed: 1 },
        });

        const detail = await client.activity.get.query({ sessionId, itemLimit: 5 });
        expect(detail?.items[0]).toMatchObject({
          status: "indexed",
          primaryPath: "wiki/sources/slack/c123/2026-05-27-thread.md",
        });
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists and updates wiki actions through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      await mkdir(path.join(repoRoot, "wiki/actions"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/actions/mine.md"),
        [
          "---",
          "type: actions",
          "owner: me",
          "last_updated: 2026-05-08",
          "---",
          "",
          "# What I Owe Others",
          "",
          "- [ ] Follow up on the launch plan (source: [[meetings/launch|Launch]])",
          "",
        ].join("\n"),
        "utf8",
      );

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const list = await client.wiki.actions.list.query({ owner: "mine", status: "open" });
        expect(list.actions).toHaveLength(1);
        expect(list.actions[0]?.title).toBe("Follow up on the launch plan");

        const id = list.actions[0]?.id;
        if (id === undefined) {
          throw new Error("Expected action id.");
        }
        const updated = await client.wiki.actions.update.mutate({
          id,
          completed: true,
          context: "Handled in the web action manager.",
        });
        expect(updated.action.completed).toBe(true);
        expect(updated.action.context).toBe("Handled in the web action manager.");

        const added = await client.wiki.actions.add.mutate({
          owner: "theirs",
          title: "Review the action manager",
        });
        expect(added.action.path).toBe("wiki/actions/theirs.md");

        const mine = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
        expect(mine).toContain("- [x] Follow up on the launch plan");
        expect(mine).toContain("strata:action-context");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reviews daily TODO extraction candidates through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const candidateIds = await writeDailyTodoReviewFixture(repoRoot);
      const handler = createWebApiHandler({
        repoRoot,
        env: {},
        now: new Date("2026-05-29T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);
      try {
        const runs = await client.extraction.dailyTodos.runs.list.query({
          day: "2026-05-29",
        });
        expect(runs.runs[0]).toMatchObject({
          name: DAILY_TODO_EXTRACTION.name,
          day: "2026-05-29",
          candidateCount: 2,
        });

        const pending = await client.extraction.dailyTodos.candidates.list.query({
          day: "2026-05-29",
          publication: "pending",
          status: "all",
        });
        expect(pending.candidates.map((candidate) => candidate.id)).toEqual(candidateIds);
        expect(pending.candidates[0]).toMatchObject({
          sourceLabel: "Launch thread",
          owner: "unknown",
        });

        const accepted = await client.extraction.dailyTodos.candidates.accept.mutate({
          id: candidateIds[0] ?? "",
          owner: "mine",
          actionText: "Send launch notes.",
          context: "Accepted from extraction review.",
        });
        expect(accepted.publication).toMatchObject({
          status: "published",
        });
        expect(accepted.publication?.publishedTarget).toContain("wiki/actions/mine.md:");
        expect(accepted.candidate).toMatchObject({
          status: "confirmed",
        });
        expect(accepted.candidate.publishedTarget).toContain("wiki/actions/mine.md:");

        const rejected = await client.extraction.dailyTodos.candidates.reject.mutate({
          id: candidateIds[1] ?? "",
          reason: "Already handled.",
        });
        expect(rejected.candidate).toMatchObject({
          status: "rejected",
          owner: "unknown",
        });

        const remaining = await client.extraction.dailyTodos.candidates.list.query({
          day: "2026-05-29",
          publication: "pending",
          status: "all",
        });
        expect(remaining.candidates).toEqual([]);

        const actions = await client.wiki.actions.list.query({ owner: "mine", status: "open" });
        expect(actions.actions[0]).toMatchObject({
          title: "Send launch notes.",
          source: {
            target: "raw/slack/2026-05-29-launch",
            label: "Launch thread",
          },
          context: "Accepted from extraction review.",
        });

        const mine = await readFile(path.join(repoRoot, "wiki/actions/mine.md"), "utf8");
        expect(mine).toContain('"extractionCandidateId"');
        expect(mine).toContain('"reviewed":true');
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reviews and applies proposals through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const proposal = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_web",
        title: "Create web proposal page",
        reason: "Exercise web proposal review.",
        evidence: ["wiki/raw/granola/2026-05-27-web-proposal.md"],
        proposedChange: [
          "Proposed meeting page: `wiki/meetings/2026-05-27-web-proposal.md`",
          "",
          "```markdown",
          "---",
          "type: meeting",
          "date: 2026-05-27",
          "title: Web Proposal",
          "---",
          "",
          "# Web Proposal",
          "",
          "## Summary",
          "",
          "- Test web proposal apply.",
          "```",
        ].join("\n"),
        risk: "low",
      });
      const manual = await writeLearningProposal(repoRoot, {
        kind: "skill",
        sessionId: "sess_web",
        title: "Review manually",
        reason: "Needs human judgment.",
        evidence: ["trace sess_web"],
        proposedChange: "Manual review required.",
        risk: "medium",
      });
      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await writeFile(
        path.join(repoRoot, "wiki/projects/web-proposals.md"),
        ["# Web Proposals", "", "## Status", "", "- Pending review.", ""].join("\n"),
        "utf8",
      );
      const patch = await writeLearningProposal(repoRoot, {
        kind: "wiki",
        sessionId: "sess_web",
        title: "Patch web proposal status",
        reason: "Exercise web proposal patch apply.",
        evidence: ["wiki/projects/web-proposals.md"],
        proposedChange: [
          "Patch wiki page: `wiki/projects/web-proposals.md`",
          "",
          "Expected old text:",
          "",
          "```markdown",
          "- Pending review.",
          "```",
          "",
          "Replacement text:",
          "",
          "```markdown",
          "- Reviewed from the web API.",
          "```",
        ].join("\n"),
        risk: "low",
      });

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const list = await client.proposals.list.query({ status: "pending", limit: 10 });
        expect(list.proposals.map((item) => item.id)).toContain(proposal.id);

        const detail = await client.proposals.get.query({ id: proposal.id });
        expect(detail?.apply).toMatchObject({
          supported: true,
          targetPath: "wiki/meetings/2026-05-27-web-proposal.md",
        });

        const applied = await client.proposals.accept.mutate({ id: proposal.id });
        expect(applied.proposal.status).toBe("applied");
        expect(applied.writtenPaths).toEqual(["wiki/meetings/2026-05-27-web-proposal.md"]);
        expect(
          await readFile(path.join(repoRoot, "wiki/meetings/2026-05-27-web-proposal.md"), "utf8"),
        ).toContain("# Web Proposal");

        const patchDetail = await client.proposals.get.query({ id: patch.id });
        expect(patchDetail?.apply).toMatchObject({
          supported: true,
          mode: "wiki.patchPage",
          targetPath: "wiki/projects/web-proposals.md",
        });

        const patchApplied = await client.proposals.accept.mutate({ id: patch.id });
        expect(patchApplied).toMatchObject({
          mode: "wiki.patchPage",
          writtenPaths: ["wiki/projects/web-proposals.md"],
        });
        expect(
          await readFile(path.join(repoRoot, "wiki/projects/web-proposals.md"), "utf8"),
        ).toContain("- Reviewed from the web API.");

        const deferred = await client.proposals.defer.mutate({
          id: manual.id,
          reason: "wait for more evidence",
        });
        expect(deferred.proposal).toMatchObject({
          id: manual.id,
          status: "deferred",
          statusReason: "wait for more evidence",
        });
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("summarizes and controls connector schedules through tRPC", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {},
        now: new Date("2026-05-27T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);
      try {
        const before = await client.connectors.schedules.status.query({ connector: "granola" });
        expect(before.schedule).toBeNull();
        expect(before.defaultProfile).toBeNull();
        expect(before.presets.map((preset) => preset.id)).toContain("granola-near-real-time");

        await client.connectors.config.save.mutate({
          connector: "granola",
          id: "default",
          label: "Granola schedule defaults",
          config: {
            pageSize: "20",
            maxPages: "4",
          },
          makeDefault: true,
        });

        const withDefault = await client.connectors.schedules.status.query({
          connector: "granola",
        });
        expect(withDefault.defaultProfile).toMatchObject({
          id: "default",
          label: "Granola schedule defaults",
        });
        expect(withDefault.presets[0]?.usesDefaultProfile).toBe(true);

        const created = await client.connectors.schedules.applyPreset.mutate({
          connector: "granola",
          presetId: "granola-near-real-time",
        });
        expect(created.schedule).toMatchObject({
          name: "Granola near-real-time sync",
          jobName: "connector.pull",
          enabled: true,
          trigger: { type: "interval", seconds: 120 },
          input: {
            connector: "granola",
            configProfileId: "default",
            index: true,
            refreshSearchIndex: true,
          },
        });
        expect(created.scheduleProfile).toMatchObject({
          id: "default",
          label: "Granola schedule defaults",
        });
        expect(created.scheduleProfileMissing).toBeNull();

        const disabled = await client.connectors.schedules.setEnabled.mutate({
          connector: "granola",
          enabled: false,
        });
        expect(disabled.schedule?.enabled).toBe(false);

        const listed = await client.schedules.list.query();
        expect(listed.schedules).toHaveLength(1);
        expect(listed.schedules[0]?.input.connector).toBe("granola");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports browser-safe chat model status", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {
          OPENAI_API_KEY: "secret_should_not_render",
          OPENAI_MODEL: "gpt-test",
        },
      });
      const { client, close } = createTestClient(handler);

      try {
        const status = await client.chat.models.status.query();
        expect(status).toEqual({
          provider: "openai-compatible",
          model: "gpt-test",
          codexLoggedIn: false,
          anthropicLoggedIn: false,
          apiKeyConfigured: true,
          anthropicApiKeyConfigured: false,
        });

        expect(JSON.stringify(status)).not.toContain("secret_should_not_render");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("manages MCP settings without exposing API keys", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {},
        now: new Date("2026-05-26T10:00:00.000Z"),
      });
      const { client, close } = createTestClient(handler);
      try {
        const before = await client.mcps.status.query();
        expect(before.servers[0]).toEqual(
          expect.objectContaining({
            slug: "exa",
            enabled: false,
          }),
        );

        const after = await client.mcps.update.mutate({
          slug: "exa",
          enabled: true,
          serverUrl: "https://mcp.exa.ai/mcp",
          selectedTools: ["web_search_exa"],
          apiKey: "secret_should_not_render",
        });
        expect(after.servers[0]).toEqual(
          expect.objectContaining({
            slug: "exa",
            enabled: true,
            apiKeyConfigured: true,
            selectedTools: ["web_search_exa"],
            headerNames: ["x-api-key"],
          }),
        );

        expect(JSON.stringify(after)).not.toContain("secret_should_not_render");

        const custom = await client.mcps.update.mutate({
          slug: "custom-search",
          displayName: "Custom Search",
          serverUrl: "https://example.com/mcp",
          selectedTools: ["search"],
        });
        expect(custom.servers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ slug: "custom-search", displayName: "Custom Search" }),
          ]),
        );

        const removed = await client.mcps.delete.mutate({ slug: "custom-search" });
        expect(removed.servers.some((server) => server.slug === "custom-search")).toBe(false);

        const stored = await readFile(
          path.join(repoRoot, ".strata", "secrets", "mcp-servers.json"),
          "utf8",
        );
        expect(stored).toContain("secret_should_not_render");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("starts and disconnects browser model auth without exposing tokens", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const tokenRequests: Request[] = [];
      const handler = createWebApiHandler({
        repoRoot,
        env: {},
        fetchImpl: fakeAnthropicTokenFetch(tokenRequests),
      });
      const { client, close } = createTestClient(handler);
      try {
        const before = await client.auth.models.status.query();
        expect(before.providers).toEqual([
          expect.objectContaining({
            provider: "openai-codex",
            authenticated: false,
            state: "not_connected",
          }),
          expect.objectContaining({
            provider: "anthropic-claude",
            authenticated: false,
            state: "not_connected",
          }),
        ]);

        const start = await client.auth.models.start.mutate({
          provider: "anthropic-claude",
          origin: "https://vivid-bear.exe.xyz",
        });
        expect(start.provider).toBe("anthropic-claude");
        const authorizationUrl = new URL(start.authorizationUrl);
        expect(authorizationUrl.origin).toBe("https://claude.ai");

        expect(start.callbackUrl).toBe("https://platform.claude.com/oauth/code/callback");
        expect(authorizationUrl.searchParams.get("client_id")).toBe(
          "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        );
        expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
          "https://platform.claude.com/oauth/code/callback",
        );
        expect(authorizationUrl.searchParams.get("scope")).toBe(
          "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
        );

        expect(JSON.stringify(start)).not.toContain("verifier");

        const pending = await client.auth.models.status.query();
        expect(
          pending.providers.find((provider) => provider.provider === "anthropic-claude"),
        ).toMatchObject({ state: "auth_pending", authenticated: false });

        const state = authorizationUrl.searchParams.get("state");
        expect(state).toBeTruthy();
        const connectedFromPaste = await client.auth.models.complete.mutate({
          provider: "anthropic-claude",
          authorizationResponse: `https://platform.claude.com/oauth/code/callback?code=code_123&state=${state}`,
        });
        expect(
          connectedFromPaste.providers.find((provider) => provider.provider === "anthropic-claude"),
        ).toMatchObject({ state: "connected", authenticated: true });
        expect(tokenRequests).toHaveLength(1);
        expect(await tokenRequests[0]?.text()).toContain(
          "redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback",
        );

        await writeFile(
          path.join(repoRoot, ".strata", "auth.json"),
          JSON.stringify({
            version: 1,
            credentials: {
              "anthropic-claude": {
                type: "anthropic_oauth",
                accessToken: "secret_access",
                refreshToken: "secret_refresh",
                expiresAt: 4_102_444_800_000,
                scopes: ["user:inference"],
                createdAt: "2026-05-25T00:00:00.000Z",
                updatedAt: "2026-05-25T00:00:00.000Z",
              },
            },
          }),
        );
        const connected = await client.auth.models.status.query();
        expect(
          connected.providers.find((provider) => provider.provider === "anthropic-claude"),
        ).toMatchObject({ state: "connected", authenticated: true, expiresAt: 4_102_444_800_000 });
        expect(JSON.stringify(connected)).not.toContain("secret_access");
        expect(JSON.stringify(connected)).not.toContain("secret_refresh");

        const disconnected = await client.auth.models.disconnect.mutate({
          provider: "anthropic-claude",
        });
        expect(
          disconnected.providers.find((provider) => provider.provider === "anthropic-claude"),
        ).toMatchObject({ state: "not_connected", authenticated: false });
        const authStore = JSON.parse(
          await readFile(path.join(repoRoot, ".strata", "auth.json"), "utf8"),
        ) as { credentials: Record<string, unknown> };
        expect(authStore.credentials["anthropic-claude"]).toBeUndefined();
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists repo files for chat composer autocomplete", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      await mkdir(path.join(repoRoot, "packages/core/src"), { recursive: true });
      await mkdir(path.join(repoRoot, "docs"), { recursive: true });
      await writeFile(path.join(repoRoot, "packages/core/src/repoFiles.ts"), "export {};\n");
      await writeFile(path.join(repoRoot, "docs/web-chat-plan.md"), "# Web chat\n");

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const files = await client.chat.files.list.query({ query: "src", limit: 10 });
        expect(files.entries).toContainEqual({
          path: "packages/core/src/repoFiles.ts",
          isDirectory: false,
        });
        expect(files.entries).toContainEqual({
          path: "packages/core/src",
          isDirectory: true,
        });

        const limited = await client.chat.files.list.query({ query: "", limit: 1 });
        expect(limited.entries).toHaveLength(1);
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists and expands chat skill slash commands", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      await mkdir(path.join(repoRoot, ".agents/skills/diagnose"), { recursive: true });
      await writeFile(
        path.join(repoRoot, ".agents/skills/diagnose/SKILL.md"),
        [
          "---",
          "name: diagnose",
          "description: Debug carefully",
          "---",
          "",
          "# Diagnose",
          "Reproduce first.",
          "",
        ].join("\n"),
      );

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const skills = await client.chat.skills.list.query({ query: "diag", limit: 10 });
        expect(skills.skills).toContainEqual(
          expect.objectContaining({
            name: "diagnose",
            description: "Debug carefully",
            path: path.join(".agents", "skills", "diagnose", "SKILL.md"),
          }),
        );

        const invocation = await client.chat.skills.invoke.query({
          name: "diagnose",
          args: "fix the bug",
        });
        expect(invocation.name).toBe("diagnose");
        expect(invocation.prompt).toContain('<skill name="diagnose"');
        expect(invocation.prompt).toContain("# Diagnose");
        expect(invocation.prompt).toContain("fix the bug");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists and reads wiki pages for the web wiki browser", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      await mkdir(path.join(repoRoot, "wiki/projects"), { recursive: true });
      await mkdir(path.join(repoRoot, "wiki/raw/slack"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki/index.md"), "# Index\n");
      await writeFile(
        path.join(repoRoot, "wiki/projects/alpha.md"),
        "---\ntype: project\n---\n\n# Alpha\n",
      );
      await writeFile(path.join(repoRoot, "wiki/raw/slack/thread.md"), "# Raw\n");

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const tree = await client.wiki.tree.query({ includeRaw: false });
        expect(tree.tree).toContainEqual({ path: "index.md", name: "index.md", type: "file" });
        expect(tree.tree.some((entry) => entry.path === "raw")).toBe(false);
        expect(tree.tree).toContainEqual({
          path: "projects",
          name: "projects",
          type: "directory",
          children: [{ path: "projects/alpha.md", name: "alpha.md", type: "file" }],
        });

        const page = await client.wiki.page.query({ path: "projects/alpha.md", includeRaw: false });
        expect(page.path).toBe("projects/alpha.md");
        expect(page.content).toContain("# Alpha");

        await expect(
          client.wiki.page.query({ path: "raw/slack/thread.md", includeRaw: false }),
        ).rejects.toThrow("Reading raw wiki pages requires includeRaw");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists OpenAI-compatible models for chat composer model controls", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    const originalFetch = globalThis.fetch;
    const seenRequests: Request[] = [];
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        const request =
          args[0] instanceof Request ? args[0] : new Request(String(args[0]), args[1]);
        if (new URL(request.url).hostname !== "models.example") {
          return originalFetch(...args);
        }
        seenRequests.push(request);
        return Response.json({
          data: [
            { id: "text-embedding-3-large", owned_by: "openai" },
            { id: "gpt-4o-mini", owned_by: "openai" },
            { id: "gpt-5.5", owned_by: "openai" },
            { id: "gpt-4o-mini", owned_by: "duplicate" },
          ],
        });
      },
      { preconnect: fetch.preconnect },
    );
    try {
      const handler = createWebApiHandler({
        repoRoot,
        env: {
          OPENAI_API_KEY: "secret_should_not_render",
          OPENAI_BASE_URL: "https://models.example/v1",
        },
      });
      const { client, close } = createTestClient(handler);
      try {
        const body = await client.chat.models.list.query({ provider: "openai-compatible" });
        expect(body.models).toEqual([
          { id: "gpt-4o-mini", description: "openai" },
          { id: "gpt-5.5", description: "openai" },
        ]);
        expect(seenRequests).toHaveLength(1);
        expect(seenRequests[0]?.url).toBe("https://models.example/v1/models");
        expect(seenRequests[0]?.headers.get("authorization")).toBe(
          "Bearer secret_should_not_render",
        );
        expect(JSON.stringify(body)).not.toContain("secret_should_not_render");
      } finally {
        close();
      }
    } finally {
      globalThis.fetch = originalFetch;
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("lists, loads, and searches chat/query sessions through tRPC metadata procedures", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-web-api-"));
    try {
      const store = await SessionStore.open(repoRoot);
      let querySessionId = "";
      let chatSessionId = "";
      let ingestSessionId = "";
      try {
        const querySession = await store.createSession({
          kind: "query",
          title: "Launch plan",
          model: "fake:model",
        });
        querySessionId = querySession.id;
        await store.appendMessage({
          sessionId: querySession.id,
          role: "user",
          content: "Find the launch decision",
        });
        await store.appendMessage({
          sessionId: querySession.id,
          role: "assistant",
          content: "The launch decision is ready.",
          toolCalls: [{ id: "call-1", name: "wiki.search", argumentsText: "{}" }],
        });
        await store.endSession(querySession.id, "completed");

        const chatSession = await store.createSession({
          kind: "chat",
          title: "Browser chat",
          model: "fake:model",
        });
        chatSessionId = chatSession.id;
        await store.appendMessage({
          sessionId: chatSession.id,
          role: "user",
          content: "Hello from the browser",
          attachments: [{ kind: "image", mimeType: "image/png", dataBase64: "abc" }],
        });
        await store.endSession(chatSession.id, "interrupted");

        const ingestSession = await store.createSession({ kind: "ingest", title: "Notion pull" });
        ingestSessionId = ingestSession.id;
        await store.appendMessage({
          sessionId: ingestSession.id,
          role: "user",
          content: "Ingest only",
        });
        await store.endSession(ingestSession.id, "completed");
      } finally {
        store.close();
      }

      const handler = createWebApiHandler({ repoRoot, env: {} });
      const { client, close } = createTestClient(handler);
      try {
        const listed = await client.chat.sessions.list.query({ limit: 10 });
        const listedIds = listed.sessions.map((session) => session.id);
        expect(listedIds).toContain(querySessionId);
        expect(listedIds).toContain(chatSessionId);
        expect(listedIds).not.toContain(ingestSessionId);

        const loaded = await client.chat.sessions.get.query({ sessionId: querySessionId });
        expect(loaded?.session).toMatchObject({
          id: querySessionId,
          kind: "query",
          title: "Launch plan",
          status: "completed",
          model: "fake:model",
        });
        expect(loaded?.messages).toHaveLength(2);
        expect(loaded?.messages[1]).toMatchObject({
          role: "assistant",
          content: "The launch decision is ready.",
          toolCalls: [{ id: "call-1", name: "wiki.search", argumentsText: "{}" }],
        });

        await expect(
          client.chat.sessions.get.query({ sessionId: ingestSessionId }),
        ).resolves.toBeNull();

        const search = await client.chat.sessions.search.query({ query: "launch decision" });
        expect(search.sessions.map((session) => session.id)).toContain(querySessionId);
        expect(search.sessions.map((session) => session.id)).not.toContain(ingestSessionId);

        const forked = await client.chat.sessions.fork.mutate({ sessionId: querySessionId });
        expect(forked.session.id).not.toBe(querySessionId);
        expect(forked.session).toMatchObject({
          kind: "query",
          title: "Fork of Launch plan",
          status: "running",
          model: "fake:model",
        });
        expect(forked.messages).toHaveLength(2);
        expect(forked.messages[0]).toMatchObject({
          role: "user",
          content: "Find the launch decision",
        });
        expect(forked.messages[1]).toMatchObject({
          role: "assistant",
          content: "The launch decision is ready.",
        });

        const forkedLoad = await client.chat.sessions.get.query({ sessionId: forked.session.id });
        expect(forkedLoad?.messages).toHaveLength(2);
        await expect(
          client.chat.sessions.fork.mutate({ sessionId: ingestSessionId }),
        ).rejects.toThrow("Session not found");

        const deleted = await client.chat.sessions.delete.mutate({ sessionId: chatSessionId });
        expect(deleted).toMatchObject({
          id: chatSessionId,
          title: "Browser chat",
        });
        await expect(
          client.chat.sessions.get.query({ sessionId: chatSessionId }),
        ).resolves.toBeNull();
        await expect(
          access(path.join(repoRoot, ".strata", "traces", `${chatSessionId}.jsonl`)),
        ).rejects.toThrow();
        await expect(
          client.chat.sessions.delete.mutate({ sessionId: ingestSessionId }),
        ).rejects.toThrow("Session not found");
      } finally {
        close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("streams chat run events as server-sent events and cleans up after completion", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        expect(config.question).toBe("hello");
        yield sessionStarted("session-1");
        yield { type: "assistant.delta", iteration: 1, contentDelta: "Hel" };
        yield { type: "assistant.delta", iteration: 1, contentDelta: "lo" };
        yield completed("session-1");
      },
    });

    const response = await handler(chatRunRequest({ message: "hello" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const text = await response.text();
    const events = parseSse(text);
    expect(events.map((event) => event.event)).toEqual([
      "run.started",
      "session.started",
      "assistant.delta",
      "assistant.delta",
      "agent.completed",
    ]);
    expect(events[0]?.data).toEqual({ type: "run.started", runId: "run-1" });
    expect(events[1]?.data).toMatchObject({ type: "session.started", sessionId: "session-1" });
    expect(events[4]?.data).toMatchObject({
      type: "agent.completed",
      result: { sessionId: "session-1", status: "completed" },
    });

    const cancelAfterCompletion = await handler(cancelRequest("run-1"));
    expect(cancelAfterCompletion.status).toBe(404);
  });

  test("replays durable chat run events and exposes final run status", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        yield { type: "assistant.delta", iteration: 1, contentDelta: "Stored" };
        yield completed("session-1");
      },
    });
    const { client, close } = createTestClient(handler);

    try {
      const response = await handler(chatRunRequest({ message: "store events" }));
      expect(response.status).toBe(200);
      const originalEvents = parseSse(await response.text());
      expect(originalEvents.map((event) => event.id)).toEqual([1, 2, 3, 4]);

      const replay = await handler(chatEventsRequest("run-1", 2));
      expect(replay.status).toBe(200);
      expect(parseSse(await replay.text())).toMatchObject([
        { id: 3, event: "assistant.delta", data: { contentDelta: "Stored" } },
        { id: 4, event: "agent.completed", data: { result: { status: "completed" } } },
      ]);

      await expect(client.chat.runs.get.query({ runId: "run-1" })).resolves.toEqual({
        run: expect.objectContaining({
          runId: "run-1",
          status: "completed",
          cancelled: false,
          sessionId: "session-1",
          lastEventId: 4,
          stoppedReason: "final_answer",
        }),
      });
    } finally {
      close();
    }
  });

  test("sends SSE heartbeat comments while waiting for agent events", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      chatStreamHeartbeatMs: 5,
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* () {
        yield sessionStarted("session-1");
        await sleep(30);
        yield completed("session-1");
      },
    });

    const response = await handler(chatRunRequest({ message: "wait" }));
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toContain(": keepalive\n\n");
    expect(parseSse(text).map((event) => event.event)).toEqual([
      "run.started",
      "session.started",
      "agent.completed",
    ]);
  });

  test("returns a conflict response when a continued chat session is already running", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: sequenceIds("run-1", "run-2"),
      runAgentLoopEvents: async function* (config) {
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
        yield interrupted("session-1");
      },
    });

    const first = await handler(
      chatRunRequest({ message: "first", continueSessionId: "session-1" }),
    );
    expect(first.status).toBe(200);

    const second = await handler(
      chatRunRequest({ message: "second", continueSessionId: "session-1" }),
    );
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({
      error: {
        code: "chat_run_conflict",
        runId: "run-1",
        sessionId: "session-1",
      },
    });

    const cancelled = await handler(cancelRequest("run-1"));
    expect(cancelled.status).toBe(200);
    await first.text();
  });

  test("cancels an active chat run through the cancel endpoint", async () => {
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
        yield interrupted("session-1");
      },
    });

    const response = await handler(chatRunRequest({ message: "cancel me" }));
    expect(response.status).toBe(200);

    const cancelled = await handler(cancelRequest("run-1"));
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toEqual({ cancelled: true, runId: "run-1" });

    const text = await response.text();
    const events = parseSse(text);
    expect(events.at(-1)?.data).toMatchObject({
      type: "agent.completed",
      result: { sessionId: "session-1", status: "interrupted", stoppedReason: "cancelled" },
    });

    const missing = await handler(cancelRequest("run-1"));
    expect(missing.status).toBe(404);
  });

  test("keeps the chat run alive when the stream reader disconnects", async () => {
    let seenSignal: AbortSignal | undefined;
    const handler = createWebApiHandler({
      ...chatTestOptions(),
      createRunId: () => "run-1",
      runAgentLoopEvents: async function* (config) {
        seenSignal = config.signal;
        yield sessionStarted("session-1");
        await onceAborted(config.signal);
      },
    });
    const { client, close } = createTestClient(handler);

    try {
      const response = await handler(chatRunRequest({ message: "disconnect" }));
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await reader?.read();
      await reader?.cancel();

      expect(seenSignal?.aborted).toBe(false);
      await expect(client.chat.runs.active.query()).resolves.toEqual({
        runs: [
          expect.objectContaining({
            runId: "run-1",
            cancelled: false,
            sessionId: "session-1",
          }),
        ],
      });
      const cancelled = await handler(cancelRequest("run-1"));
      expect(cancelled.status).toBe(200);
      expect(seenSignal?.aborted).toBe(true);
    } finally {
      close();
    }
  });

  test("validates chat run requests", async () => {
    const handler = createWebApiHandler(chatTestOptions());
    const response = await handler(chatRunRequest({ message: "hi", provider: "other" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "provider must be openai-codex, openai-compatible, or anthropic-claude.",
      },
    });
  });
});

function createTestClient(handler: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler,
  });
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://${server.hostname}:${server.port}/api/trpc`,
      }),
    ],
  });
  return {
    client,
    close: () => server.stop(true),
  };
}

function fakeAnthropicTokenFetch(requests: Request[]): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const request = args[0] instanceof Request ? args[0] : new Request(String(args[0]), args[1]);
      requests.push(request);
      return Response.json({
        access_token: "secret_access",
        refresh_token: "secret_refresh",
        expires_in: 3600,
        scope: "user:inference",
      });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}

function fakeNotionFetch(): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const url = new URL(String(args[0]));
      if (url.pathname === "/v1/pages/page_123") {
        return Response.json({
          id: "page_123",
          url: "https://notion.so/page_123",
          last_edited_time: "2026-05-04T12:00:00.000Z",
          properties: {
            Name: {
              type: "title",
              title: [{ plain_text: "Strategy Doc" }],
            },
          },
        });
      }
      if (url.pathname === "/v1/blocks/page_123/children") {
        return Response.json({
          results: [
            {
              id: "block_1",
              type: "paragraph",
              has_children: false,
              paragraph: { rich_text: [{ plain_text: "API preview." }] },
            },
          ],
          has_more: false,
          next_cursor: null,
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
    { preconnect: fetch.preconnect },
  ) satisfies typeof fetch;
}

async function writeDailyTodoReviewFixture(repoRoot: string): Promise<string[]> {
  const store = await SessionStore.open(repoRoot);
  try {
    const session = await store.createSession({
      kind: "ingest",
      title: "Dry-run daily.todo extraction for 2026-05-29",
    });
    const results: TodoCandidateResult[] = [
      todoCandidateResult({
        evidenceSpanId: "span_review_1",
        candidateHash: "candidate_hash_review_1",
        candidateText: "Can you send launch notes?",
        status: "needs_review",
        classification: "needs_review",
        confidence: 0.62,
        owner: "unknown",
        actionText: "Can you send launch notes?",
        rationale: "Direct ask needs owner review.",
        lineStart: 12,
      }),
      todoCandidateResult({
        evidenceSpanId: "span_review_2",
        candidateHash: "candidate_hash_review_2",
        candidateText: "Ada will update the billing copy.",
        status: "confirmed",
        classification: "action",
        confidence: 0.91,
        owner: "theirs",
        actionText: "Ada will update the billing copy.",
        rationale: "Explicit assigned commitment.",
        lineStart: 18,
      }),
    ];
    const result: DailyTodoExtractionResult = {
      sessionId: session.id,
      extractionRunId: extractionRunIdForSession(session.id),
      dryRun: true,
      extractionName: "daily.todo",
      extractorVersion: DAILY_TODO_EXTRACTION.extractorVersion,
      verifierVersion: "fake.todo-verifier-v1",
      day: "2026-05-29",
      sourcesScanned: 1,
      spanCount: 2,
      candidateCount: results.length,
      rejectedCount: 0,
      countsBySource: {
        slack: { documents: 1, spans: 2, candidates: 2, rejected: 0 },
        granola: { documents: 0, spans: 0, candidates: 0, rejected: 0 },
        notion: { documents: 0, spans: 0, candidates: 0, rejected: 0 },
        wiki: { documents: 0, spans: 0, candidates: 0, rejected: 0 },
      },
      results,
      candidates: results,
      rejected: [],
    };
    persistDailyTodoExtractionResult(store, result);
    await store.endSession(session.id, "completed");
    return results.map((item) => extractionCandidateStorageIdForResult(result, item));
  } finally {
    store.close();
  }
}

function todoCandidateResult(options: {
  evidenceSpanId: string;
  candidateHash: string;
  candidateText: string;
  status: TodoCandidateResult["status"];
  classification: "action" | "not_action" | "needs_review";
  confidence: number;
  owner: "mine" | "theirs" | "unknown";
  actionText: string;
  rationale: string;
  lineStart: number;
}): TodoCandidateResult {
  return {
    status: options.status,
    candidate: {
      id: options.evidenceSpanId.replace("span", "candidate"),
      extractionName: DAILY_TODO_EXTRACTION.name,
      candidateKind: "direct_request",
      evidenceSpanId: options.evidenceSpanId,
      candidateText: options.candidateText,
      candidateHash: options.candidateHash,
      deterministicReasons: ["direct_request"],
      metadata: {},
    },
    evidence: {
      id: options.evidenceSpanId,
      sourcePath: path.join("wiki", "raw", "slack", "2026-05-29-launch.md"),
      sourceKind: "raw",
      sourceType: "slack",
      date: "2026-05-29",
      lineStart: options.lineStart,
      lineEnd: options.lineStart,
      text: options.candidateText,
      metadata: {
        title: "Launch thread",
      },
    },
    verification: {
      classification: options.classification,
      confidence: options.confidence,
      owner: options.owner,
      actionText: options.actionText,
      rationale: options.rationale,
    },
    reasons: ["direct_request"],
  };
}

const fakeModel: ModelAdapter = {
  name: "fake:model",
  complete: async () => ({
    content: "unused",
    finishReason: "stop",
    toolCalls: [],
  }),
};

function chatTestOptions() {
  return {
    repoRoot: path.join(os.tmpdir(), `strata-chat-${randomUUID()}`),
    env: { STRATA_API_KEY: "sk-test", STRATA_MODEL: "gpt-test" },
    createModelAdapter: async () => fakeModel,
  };
}

function chatRunRequest(body: Record<string, unknown>): Request {
  return new Request("http://127.0.0.1/api/chat/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cancelRequest(runId: string): Request {
  return new Request(`http://127.0.0.1/api/chat/runs/${runId}/cancel`, {
    method: "POST",
  });
}

function chatEventsRequest(runId: string, afterEventId: number): Request {
  return new Request(`http://127.0.0.1/api/chat/runs/${runId}/events?after=${afterEventId}`);
}

function parseSse(text: string): { id: number | null; event: string; data: unknown }[] {
  return text
    .trim()
    .split("\n\n")
    .filter((frame) => frame.trim() !== "")
    .flatMap((frame) => {
      const idLine = frame.split("\n").find((line) => line.startsWith("id: "));
      const eventLine = frame.split("\n").find((line) => line.startsWith("event: "));
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (eventLine === undefined && dataLine === undefined) {
        return [];
      }
      if (eventLine === undefined || dataLine === undefined) {
        throw new Error(`Invalid SSE frame: ${frame}`);
      }
      return [
        {
          id: idLine === undefined ? null : Number.parseInt(idLine.slice("id: ".length), 10),
          event: eventLine.slice("event: ".length),
          data: JSON.parse(dataLine.slice("data: ".length)),
        },
      ];
    });
}

function sequenceIds(...ids: string[]): () => string {
  let index = 0;
  return () => ids[index++] ?? `run-${index}`;
}

function sessionStarted(sessionId: string): AgentRunEvent {
  return {
    type: "session.started",
    sessionId,
    title: "Test session",
    model: fakeModel.name,
  };
}

function completed(sessionId: string): AgentRunEvent {
  return {
    type: "agent.completed",
    result: result(sessionId, "completed"),
  };
}

function interrupted(sessionId: string): AgentRunEvent {
  return {
    type: "agent.completed",
    result: result(sessionId, "interrupted"),
  };
}

function result(sessionId: string, status: "completed" | "interrupted"): AgentRunResult {
  return {
    sessionId,
    status,
    stoppedReason: status === "completed" ? "final_answer" : "cancelled",
    finalAnswer: status === "completed" ? "done" : "",
    iterations: 1,
    toolCalls: 0,
  };
}

async function onceAborted(signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    throw new Error("expected signal");
  }
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
