import {
  getStrataPaths,
  type RefreshWikiSearchIndexResult,
  refreshWikiSearchIndex,
  type WikiSearchIndexSource,
} from "@strata/core";
import type { RawToWikiIndexResult, RawToWikiSourceFilter } from "../rawToWiki.js";
import { runRawToWikiIndex } from "../rawToWiki.js";
import { readConnectorConfigProfile } from "./configStore.js";
import { type ConnectorSessionResult, runConnectorOperation } from "./runner.js";
import type { ConnectorConfig, ConnectorName, ConnectorOperation } from "./types.js";

export type ConnectorWorkflowOperation = Exclude<ConnectorOperation, "validate">;

export interface RunConnectorWorkflowOptions {
  connector: ConnectorName;
  operation?: ConnectorWorkflowOperation;
  config?: ConnectorConfig;
  configProfileId?: string;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  title?: string;
  lookbackMinutes?: number;
  index?: boolean;
  refreshSearchIndex?: boolean;
}

export interface ConnectorWorkflowMetrics {
  connectorSessionId: string;
  rawToWikiSessionId: string | null;
  itemCount: number;
  writtenCount: number;
  skippedCount: number;
  indexedCount: number;
  indexSkippedCount: number;
  searchIndexed: number;
}

export interface ConnectorWorkflowResult {
  connector: ConnectorName;
  operation: ConnectorWorkflowOperation;
  configProfile: ConnectorWorkflowConfigProfile | null;
  connectorResult: ConnectorSessionResult;
  rawPaths: string[];
  rawToWiki: RawToWikiIndexResult | null;
  searchIndex: RefreshWikiSearchIndexResult | null;
  metrics: ConnectorWorkflowMetrics;
}

export interface ConnectorWorkflowConfigProfile {
  id: string;
  label: string;
  updatedAt: string;
}

export async function runConnectorWorkflow(
  options: RunConnectorWorkflowOptions,
): Promise<ConnectorWorkflowResult> {
  const repoRoot = getStrataPaths(options.repoRoot).repoRoot;
  const operation = options.operation ?? "pull";
  const resolvedConfig = await resolveConnectorWorkflowConfig(options, repoRoot);
  const config = connectorConfigWithLookback(
    resolvedConfig.config,
    options.lookbackMinutes,
    options.now,
  );

  const connectorResult = await runConnectorOperation({
    name: options.connector,
    operation,
    config,
    repoRoot,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.title === undefined ? {} : { title: options.title }),
  });
  const rawPaths = connectorRawPaths(connectorResult);

  let rawToWiki: RawToWikiIndexResult | null = null;
  if (operation === "pull" && options.index === true && rawPaths.length > 0) {
    rawToWiki = await runRawToWikiIndex({
      repoRoot,
      rawPaths,
      source: options.connector as RawToWikiSourceFilter,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  let searchIndex: RefreshWikiSearchIndexResult | null = null;
  if (operation === "pull" && options.refreshSearchIndex === true) {
    searchIndex = await refreshWikiSearchIndex({
      repoRoot,
      source: options.connector as WikiSearchIndexSource,
      includeRaw: true,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  return {
    connector: options.connector,
    operation,
    configProfile: resolvedConfig.profile,
    connectorResult,
    rawPaths,
    rawToWiki,
    searchIndex,
    metrics: {
      connectorSessionId: connectorResult.sessionId,
      rawToWikiSessionId: rawToWiki?.sessionId ?? null,
      itemCount: connectorResult.items?.length ?? 1,
      writtenCount:
        connectorResult.items?.filter((item) => item.written).length ??
        (connectorResult.written ? 1 : 0),
      skippedCount:
        connectorResult.items?.filter((item) => item.skipped).length ??
        (connectorResult.skipped ? 1 : 0),
      indexedCount: rawToWiki?.indexed.length ?? 0,
      indexSkippedCount: rawToWiki?.skipped.length ?? 0,
      searchIndexed: searchIndex?.indexed ?? 0,
    },
  };
}

async function resolveConnectorWorkflowConfig(
  options: RunConnectorWorkflowOptions,
  repoRoot: string,
): Promise<{ config: ConnectorConfig; profile: ConnectorWorkflowConfigProfile | null }> {
  const inlineConfig = options.config ?? {};
  const profileId = options.configProfileId?.trim();
  if (!profileId) {
    return { config: inlineConfig, profile: null };
  }
  const profile = await readConnectorConfigProfile(options.connector, profileId, repoRoot);
  if (profile === null) {
    throw new Error(`No ${options.connector} connector config profile: ${profileId}`);
  }
  return {
    config: {
      ...profile.config,
      ...inlineConfig,
    },
    profile: {
      id: profile.id,
      label: profile.label,
      updatedAt: profile.updatedAt,
    },
  };
}

export function connectorConfigWithLookback(
  input: ConnectorConfig,
  lookbackMinutes: number | undefined,
  now?: Date,
): ConnectorConfig {
  const config = cleanConnectorConfig(input);
  if (config.since !== undefined || lookbackMinutes === undefined) {
    return config;
  }
  if (!Number.isFinite(lookbackMinutes) || lookbackMinutes < 1) {
    throw new Error("lookbackMinutes must be a positive number");
  }
  config.since = new Date(
    (now ?? new Date()).getTime() - Math.floor(lookbackMinutes) * 60_000,
  ).toISOString();
  return config;
}

export function cleanConnectorConfig(input: ConnectorConfig): ConnectorConfig {
  const config: ConnectorConfig = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") {
        continue;
      }
      config[key] = trimmed;
      continue;
    }
    config[key] = value;
  }
  return config;
}

function connectorRawPaths(result: ConnectorSessionResult): string[] {
  const items = result.items ?? [result];
  return [
    ...new Set(items.map((item) => item.rawPath).filter((rawPath) => rawPath.endsWith(".md"))),
  ];
}
