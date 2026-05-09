import { asString, type JsonObject } from "./common.js";
import type {
  ConnectorDefinition,
  ConnectorPullResult,
  ConnectorRuntime,
  ConnectorStatus,
} from "./connectors/types.js";
import { normalizeNotionPageId, pullNotionPage } from "./notion.js";

export interface NotionConnectorConfig extends Record<string, string | undefined> {
  pageId?: string;
  token?: string;
  version?: string;
}

export const notionConnector = {
  name: "notion",
  displayName: "Notion",
  description: "Snapshot a shared Notion page into wiki/raw/notion.",
  mode: "page",
  capabilities: ["validate", "dry_run", "pull"],
  configSchema: {
    fields: {
      pageId: {
        type: "string",
        label: "Page ID or URL",
        description: "A Notion page ID or pasted Notion URL shared with the integration.",
        required: true,
        placeholder: "https://www.notion.so/workspace/Page-...",
      },
      token: {
        type: "string",
        label: "Integration token",
        description: "Optional override. Prefer NOTION_TOKEN in .env for local use.",
        secret: true,
        env: "NOTION_TOKEN",
      },
      version: {
        type: "string",
        label: "Notion API version",
        description: "Optional override for the Notion-Version header.",
        env: "NOTION_VERSION",
      },
    },
  },
  getStatus(runtime) {
    const token = runtime.env.NOTION_TOKEN?.trim() ?? "";
    if (token === "") {
      return {
        name: "notion",
        state: "not_configured",
        configured: false,
        message: "Set NOTION_TOKEN in .env or connect Notion MCP to enable Notion.",
      };
    }
    return {
      name: "notion",
      state: "ready",
      configured: true,
      message: "Token configured. Provide a page ID or URL to validate access.",
    };
  },
  async validate(config, runtime) {
    const pageId = config.pageId?.trim() ?? "";
    const token = notionToken(config, runtime);
    if (token === "") {
      return {
        name: "notion",
        state: "not_configured",
        configured: false,
        message: "Set NOTION_TOKEN in .env or provide a token override.",
      };
    }
    if (pageId === "") {
      return {
        name: "notion",
        state: "invalid",
        configured: true,
        message: "Provide a Notion page ID or URL to validate page access.",
      };
    }

    const preview = await runNotion(config, runtime, true);
    return {
      name: "notion",
      state: "ready",
      configured: true,
      message: `Ready to snapshot "${preview.title}".`,
      details: {
        pageId: preview.sourceId,
        title: preview.title,
        rawPath: preview.rawPath,
        sourceUrl: preview.sourceUrl,
      },
    };
  },
  async dryRun(config, runtime) {
    return runNotion(config, runtime, true);
  },
  async pull(config, runtime) {
    return runNotion(config, runtime, false);
  },
} satisfies ConnectorDefinition<NotionConnectorConfig> &
  Required<Pick<ConnectorDefinition<NotionConnectorConfig>, "dryRun" | "pull">>;

function notionToken(config: NotionConnectorConfig, runtime: ConnectorRuntime): string {
  return config.token?.trim() || runtime.env.NOTION_TOKEN?.trim() || "";
}

async function runNotion(
  config: NotionConnectorConfig,
  runtime: ConnectorRuntime,
  dryRun: boolean,
): Promise<ConnectorPullResult> {
  const pageId = normalizeNotionPageId(config.pageId ?? "");
  const token = notionToken(config, runtime);
  const version = config.version?.trim() || runtime.env.NOTION_VERSION?.trim();
  const result = await pullNotionPage({
    pageId,
    repoRoot: runtime.repoRoot,
    token,
    dryRun,
    ...(version === undefined || version === "" ? {} : { version }),
    ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
  });

  return {
    connector: "notion",
    sourceId: result.pageId,
    title: result.title,
    rawPath: result.path,
    sourceUrl: result.sourceUrl,
    written: result.written,
    skipped: result.skipped,
    dryRun,
    metadata: compactMetadata({
      date: result.date,
      pageId: result.pageId,
    }),
  };
}

function compactMetadata(value: Record<string, unknown>): JsonObject {
  const metadata: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const stringValue = asString(item);
    if (stringValue !== "") {
      metadata[key] = stringValue;
    }
  }
  return metadata;
}
