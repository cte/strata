import type { JsonObject, JsonValue } from "../common.js";

export type ConnectorName = "notion" | "granola" | "slack";
export type ConnectorMode = "page" | "api" | "sync" | "thread";
export type ConnectorStatusState = "ready" | "not_configured" | "invalid" | "not_implemented";
export type ConnectorOperation = "validate" | "dry_run" | "pull";
export type ConnectorCapability =
  | "validate"
  | "dry_run"
  | "pull"
  | "configure"
  | "discover"
  | "poll"
  | "checkpoint"
  | "oauth"
  | "mcp_auth"
  | "mcp_tools";

export type ConnectorConfigValue = JsonValue | undefined;
export type ConnectorConfig = Record<string, ConnectorConfigValue>;

export interface ConnectorFieldSchema {
  type: "string" | "boolean" | "number";
  label: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  env?: string;
}

export interface ConnectorConfigSchema {
  fields: Record<string, ConnectorFieldSchema>;
}

export interface ConnectorRuntime {
  repoRoot: string;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export interface ConnectorStatus {
  name: ConnectorName;
  state: ConnectorStatusState;
  message: string;
  configured: boolean;
  details?: JsonObject;
}

export interface SourceDocumentSection {
  title?: string;
  text: string;
  link?: string;
  metadata?: JsonObject;
}

export interface SourceDocument {
  connector: ConnectorName;
  sourceId: string;
  title: string;
  sourceUrl: string | null;
  sections: SourceDocumentSection[];
  metadata: JsonObject;
  updatedAt?: string;
  parentSourceId?: string;
  raw?: JsonValue;
}

export interface ConnectorCheckpoint {
  connector: ConnectorName;
  updatedAt: string;
  cursor?: string;
  data: JsonObject;
}

export interface ConnectorFailure {
  connector: ConnectorName;
  sourceId?: string;
  message: string;
  retryable: boolean;
  metadata: JsonObject;
}

export interface ConnectorPullItem {
  sourceId: string;
  title: string;
  rawPath: string;
  sourceUrl: string | null;
  written: boolean;
  skipped: boolean;
  metadata: JsonObject;
}

export interface ConnectorPullResult {
  connector: ConnectorName;
  sourceId: string;
  title: string;
  rawPath: string;
  sourceUrl: string | null;
  written: boolean;
  skipped: boolean;
  dryRun: boolean;
  metadata: JsonObject;
  items?: ConnectorPullItem[];
  documents?: SourceDocument[];
  failures?: ConnectorFailure[];
  checkpoint?: ConnectorCheckpoint;
}

export interface ConnectorDefinition<TConfig extends ConnectorConfig = ConnectorConfig> {
  name: ConnectorName;
  displayName: string;
  description: string;
  mode: ConnectorMode;
  capabilities: readonly ConnectorCapability[];
  configSchema: ConnectorConfigSchema;
  getStatus?(runtime: ConnectorRuntime): Promise<ConnectorStatus> | ConnectorStatus;
  validate(config: TConfig, runtime: ConnectorRuntime): Promise<ConnectorStatus>;
  dryRun?(config: TConfig, runtime: ConnectorRuntime): Promise<ConnectorPullResult>;
  pull?(config: TConfig, runtime: ConnectorRuntime): Promise<ConnectorPullResult>;
}

export function connectorErrorStatus(
  name: ConnectorName,
  error: unknown,
  fallback = "Connector operation failed.",
): ConnectorStatus {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  return {
    name,
    state: "invalid",
    configured: false,
    message: redactConnectorMessage(raw),
  };
}

export function redactConnectorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/secret_[A-Za-z0-9._~+/=-]+/g, "secret_[redacted]")
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "xox[redacted]")
    .replace(/api[_-]?key[=:]\s*[^,\s]+/gi, "api_key=[redacted]");
}

export function redactConnectorConfig(
  config: ConnectorConfig,
  schema?: ConnectorConfigSchema,
): JsonObject {
  const redacted: JsonObject = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) {
      continue;
    }
    if (schema?.fields[key]?.secret || isSecretKey(key)) {
      redacted[key] = "[redacted]";
    } else {
      redacted[key] = redactJsonValue(key, value);
    }
  }
  return redacted;
}

function redactJsonValue(key: string, value: JsonValue): JsonValue {
  if (typeof value === "string") {
    return isSecretKey(key) ? "[redacted]" : redactConnectorMessage(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(key, item));
  }
  if (value && typeof value === "object") {
    const result: JsonObject = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = isSecretKey(childKey)
        ? "[redacted]"
        : redactJsonValue(childKey, childValue);
    }
    return result;
  }
  return value;
}

function isSecretKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization|oauth/i.test(key);
}
