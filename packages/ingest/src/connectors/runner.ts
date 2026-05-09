import {
  type JsonObject as CoreJsonObject,
  ensureRuntimeDirs,
  getStrataPaths,
  SessionStore,
} from "@strata/core";
import { getConnectorDefinition } from "./registry.js";
import type {
  ConnectorConfig,
  ConnectorName,
  ConnectorOperation,
  ConnectorRuntime,
} from "./types.js";
import {
  type ConnectorPullResult,
  redactConnectorConfig,
  redactConnectorMessage,
} from "./types.js";

export interface RunConnectorOperationOptions {
  name: ConnectorName;
  operation: Exclude<ConnectorOperation, "validate">;
  config: ConnectorConfig;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
  title?: string;
}

export interface ConnectorSessionResult extends ConnectorPullResult {
  sessionId: string;
}

export async function runConnectorOperation(
  options: RunConnectorOperationOptions,
): Promise<ConnectorSessionResult> {
  const definition = getConnectorDefinition(options.name);
  if (definition === undefined) {
    throw new Error(`Unknown connector: ${options.name}`);
  }

  const handler = options.operation === "dry_run" ? definition.dryRun : definition.pull;
  if (handler === undefined) {
    throw new Error(`${definition.displayName} does not support ${options.operation}.`);
  }

  const root = getStrataPaths(options.repoRoot).repoRoot;
  await ensureRuntimeDirs(getStrataPaths(root));
  const runtime = connectorRuntime(options, root);
  const store = await SessionStore.open(root);
  const sessionTitle = options.title ?? defaultSessionTitle(definition.displayName, options);
  const configForTrace = redactConnectorConfig(options.config, definition.configSchema);
  const session = await store.createSession({
    kind: "ingest",
    title: sessionTitle,
  });

  try {
    await store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: sessionTitle,
    });
    await store.appendEvent(
      session.id,
      `connector.${definition.name}.${options.operation}.started`,
      {
        connector: definition.name,
        operation: options.operation,
        config: configForTrace,
      },
    );

    const result = await handler(options.config, runtime);
    await store.appendEvent(
      session.id,
      `connector.${definition.name}.${options.operation}.completed`,
      { ...result } as unknown as CoreJsonObject,
    );
    await store.endSession(session.id, "completed");
    return { ...result, sessionId: session.id };
  } catch (error: unknown) {
    await store.appendEvent(
      session.id,
      `connector.${definition.name}.${options.operation}.failed`,
      {
        connector: definition.name,
        operation: options.operation,
        config: configForTrace,
        message: redactConnectorMessage(error instanceof Error ? error.message : String(error)),
      },
    );
    await store.endSession(session.id, "failed");
    throw error;
  } finally {
    store.close();
  }
}

function connectorRuntime(
  options: RunConnectorOperationOptions,
  repoRoot: string,
): ConnectorRuntime {
  return {
    repoRoot,
    env: options.env ?? Bun.env,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
}

function defaultSessionTitle(
  displayName: string,
  options: Pick<RunConnectorOperationOptions, "operation" | "config">,
): string {
  const sourceId = firstConfigString(options.config, ["pageId", "threadTs", "channel", "since"]);
  const operation = options.operation === "dry_run" ? "Dry-run" : "Pull";
  return sourceId === ""
    ? `${operation} ${displayName}`
    : `${operation} ${displayName} ${sourceId}`;
}

function firstConfigString(config: ConnectorConfig, keys: string[]): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}
