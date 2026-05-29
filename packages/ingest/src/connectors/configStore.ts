import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrataPaths } from "@strata/core";
import type { JsonObject, JsonValue } from "../common.js";
import { getConnectorDefinition } from "./registry.js";
import type {
  ConnectorConfig,
  ConnectorConfigSchema,
  ConnectorConfigValue,
  ConnectorName,
} from "./types.js";

export interface ConnectorConfigProfileRecord {
  id: string;
  connector: ConnectorName;
  label: string;
  config: ConnectorConfig;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
}

interface ConnectorConfigStoreFile {
  version: 1;
  connector: ConnectorName;
  defaultProfileId: string | null;
  profiles: ConnectorConfigProfileRecord[];
}

export interface WriteConnectorConfigProfileInput {
  connector: ConnectorName;
  id?: string;
  label?: string;
  config: ConnectorConfig;
  repoRoot?: string;
  now?: Date;
  makeDefault?: boolean;
}

const DEFAULT_PROFILE_ID = "default";
const SECRET_KEY_RE = /token|secret|password|api[_-]?key|authorization|oauth/i;

export function getConnectorConfigPath(connector: ConnectorName, repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "connectors", connector, "config.json");
}

export async function listConnectorConfigProfiles(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<ConnectorConfigProfileRecord[]> {
  const store = await readStore(connector, repoRoot);
  return store.profiles;
}

export async function readConnectorConfigProfile(
  connector: ConnectorName,
  id: string,
  repoRoot?: string,
): Promise<ConnectorConfigProfileRecord | null> {
  const store = await readStore(connector, repoRoot);
  return store.profiles.find((profile) => profile.id === id) ?? null;
}

export async function readDefaultConnectorConfigProfile(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<ConnectorConfigProfileRecord | null> {
  const store = await readStore(connector, repoRoot);
  if (store.defaultProfileId === null) {
    return null;
  }
  return store.profiles.find((profile) => profile.id === store.defaultProfileId) ?? null;
}

export async function writeConnectorConfigProfile(
  input: WriteConnectorConfigProfileInput,
): Promise<ConnectorConfigProfileRecord> {
  const id = normalizeProfileId(input.id ?? DEFAULT_PROFILE_ID);
  const now = (input.now ?? new Date()).toISOString();
  const store = await readStore(input.connector, input.repoRoot);
  const existing = store.profiles.find((profile) => profile.id === id);
  const config = sanitizeConnectorConfig(input.connector, input.config);
  const record: ConnectorConfigProfileRecord = {
    id,
    connector: input.connector,
    label: input.label?.trim() || existing?.label || defaultProfileLabel(input.connector),
    config,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    isDefault: input.makeDefault === true || store.defaultProfileId === id,
  };

  const profiles = store.profiles.filter((profile) => profile.id !== id);
  profiles.push(record);
  const defaultProfileId =
    input.makeDefault === true || store.defaultProfileId === null ? id : store.defaultProfileId;
  await writeStore(
    {
      version: 1,
      connector: input.connector,
      defaultProfileId,
      profiles: profiles
        .map((profile) => ({
          ...profile,
          isDefault: profile.id === defaultProfileId,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
    input.repoRoot,
  );
  return { ...record, isDefault: record.id === defaultProfileId };
}

export async function setDefaultConnectorConfigProfile(input: {
  connector: ConnectorName;
  id: string;
  repoRoot?: string;
}): Promise<ConnectorConfigProfileRecord> {
  const id = normalizeProfileId(input.id);
  const store = await readStore(input.connector, input.repoRoot);
  const profile = store.profiles.find((item) => item.id === id);
  if (profile === undefined) {
    throw new Error(`No ${input.connector} connector config profile: ${id}`);
  }
  await writeStore(
    {
      ...store,
      defaultProfileId: id,
      profiles: store.profiles.map((item) => ({
        ...item,
        isDefault: item.id === id,
      })),
    },
    input.repoRoot,
  );
  return { ...profile, isDefault: true };
}

export async function deleteConnectorConfigProfile(input: {
  connector: ConnectorName;
  id: string;
  repoRoot?: string;
}): Promise<{ deleted: boolean }> {
  const id = normalizeProfileId(input.id);
  const store = await readStore(input.connector, input.repoRoot);
  const profiles = store.profiles.filter((profile) => profile.id !== id);
  if (profiles.length === store.profiles.length) {
    return { deleted: false };
  }
  const defaultProfileId = store.defaultProfileId === id ? null : store.defaultProfileId;
  await writeStore(
    {
      ...store,
      defaultProfileId,
      profiles: profiles.map((profile) => ({
        ...profile,
        isDefault: profile.id === defaultProfileId,
      })),
    },
    input.repoRoot,
  );
  return { deleted: true };
}

export async function deleteConnectorConfigProfiles(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<void> {
  await rm(getConnectorConfigPath(connector, repoRoot), { force: true });
}

export function sanitizeConnectorConfig(
  connector: ConnectorName,
  config: ConnectorConfig,
): ConnectorConfig {
  const schema = getConnectorDefinition(connector)?.configSchema;
  const sanitized: ConnectorConfig = {};
  for (const [key, value] of Object.entries(config)) {
    const next = sanitizeConfigValue({
      key,
      path: [key],
      value,
      ...(schema === undefined ? {} : { schema }),
    });
    if (next !== undefined) {
      sanitized[key] = next;
    }
  }
  return sanitized;
}

function sanitizeConfigValue(input: {
  key: string;
  path: string[];
  schema?: ConnectorConfigSchema;
  value: ConnectorConfigValue;
}): JsonValue | undefined {
  const field = input.path.length === 1 ? input.schema?.fields[input.key] : undefined;
  assertNonSecretField(input.path, field?.secret === true);
  const value = input.value;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Connector config field "${input.path.join(".")}" must be finite.`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.flatMap((item, index) => {
      const next = sanitizeConfigValue({
        key: input.key,
        path: [...input.path, String(index)],
        value: item as ConnectorConfigValue,
        ...(input.schema === undefined ? {} : { schema: input.schema }),
      });
      return next === undefined ? [] : [next];
    });
    return items.length === 0 ? undefined : items;
  }
  const object: JsonObject = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const next = sanitizeConfigValue({
      key: childKey,
      path: [...input.path, childKey],
      value: childValue as ConnectorConfigValue,
      ...(input.schema === undefined ? {} : { schema: input.schema }),
    });
    if (next !== undefined) {
      object[childKey] = next;
    }
  }
  return Object.keys(object).length === 0 ? undefined : object;
}

function assertNonSecretField(pathParts: string[], schemaSecret: boolean): void {
  const field = pathParts[pathParts.length - 1] ?? "";
  if (schemaSecret || SECRET_KEY_RE.test(field)) {
    throw new Error(
      `Connector config field "${pathParts.join(".")}" is secret and must be stored in the connector secret store, not config profiles.`,
    );
  }
}

async function readStore(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<ConnectorConfigStoreFile> {
  const file = getConnectorConfigPath(connector, repoRoot);
  if (!existsSync(file)) {
    return emptyStore(connector);
  }
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isStoreFile(parsed, connector)) {
    throw new Error(`Invalid ${connector} connector config store: ${file}`);
  }
  return {
    ...parsed,
    profiles: parsed.profiles.map((profile) => ({
      ...profile,
      isDefault: profile.id === parsed.defaultProfileId,
    })),
  };
}

async function writeStore(store: ConnectorConfigStoreFile, repoRoot?: string): Promise<void> {
  const file = getConnectorConfigPath(store.connector, repoRoot);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await chmod(file, 0o600);
}

function emptyStore(connector: ConnectorName): ConnectorConfigStoreFile {
  return {
    version: 1,
    connector,
    defaultProfileId: null,
    profiles: [],
  };
}

function normalizeProfileId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (id === "") {
    throw new Error("Connector config profile id is required.");
  }
  return id;
}

function defaultProfileLabel(connector: ConnectorName): string {
  return `${connector} defaults`;
}

function isStoreFile(value: unknown, connector: ConnectorName): value is ConnectorConfigStoreFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ConnectorConfigStoreFile>;
  return (
    candidate.version === 1 &&
    candidate.connector === connector &&
    (candidate.defaultProfileId === null || typeof candidate.defaultProfileId === "string") &&
    Array.isArray(candidate.profiles) &&
    candidate.profiles.every((profile) => isProfileRecord(profile, connector))
  );
}

function isProfileRecord(
  value: unknown,
  connector: ConnectorName,
): value is ConnectorConfigProfileRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ConnectorConfigProfileRecord>;
  return (
    candidate.connector === connector &&
    typeof candidate.id === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.isDefault === "boolean" &&
    typeof candidate.config === "object" &&
    candidate.config !== null &&
    !Array.isArray(candidate.config)
  );
}
