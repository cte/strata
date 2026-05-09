import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrataPaths } from "@strata/core";
import type { JsonObject } from "../common.js";
import type { ConnectorName } from "./types.js";

export interface ConnectorSecretRecord {
  version: 1;
  connector: ConnectorName;
  data: JsonObject;
  updatedAt: string;
  validatedAt?: string;
}

export function getConnectorSecretPath(connector: ConnectorName, repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "secrets", `${connector}.json`);
}

export function hasConnectorSecretSync(connector: ConnectorName, repoRoot?: string): boolean {
  const file = getConnectorSecretPath(connector, repoRoot);
  if (!existsSync(file)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isConnectorSecretRecord(parsed, connector);
  } catch {
    return false;
  }
}

export async function readConnectorSecret(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<ConnectorSecretRecord | null> {
  const file = getConnectorSecretPath(connector, repoRoot);
  if (!existsSync(file)) {
    return null;
  }
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isConnectorSecretRecord(parsed, connector)) {
    throw new Error(`Invalid ${connector} secret store: ${file}`);
  }
  return parsed;
}

export async function writeConnectorSecret(input: {
  connector: ConnectorName;
  data: JsonObject;
  repoRoot?: string;
  now?: Date;
  validatedAt?: string;
}): Promise<ConnectorSecretRecord> {
  const updatedAt = (input.now ?? new Date()).toISOString();
  const record: ConnectorSecretRecord = {
    version: 1,
    connector: input.connector,
    data: input.data,
    updatedAt,
  };
  if (input.validatedAt !== undefined) {
    record.validatedAt = input.validatedAt;
  }

  const file = getConnectorSecretPath(input.connector, input.repoRoot);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await chmod(file, 0o600);
  return record;
}

export async function deleteConnectorSecret(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<void> {
  await rm(getConnectorSecretPath(connector, repoRoot), { force: true });
}

export function isConnectorSecretRecord(
  value: unknown,
  connector?: ConnectorName,
): value is ConnectorSecretRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<ConnectorSecretRecord>;
  return (
    candidate.version === 1 &&
    (connector === undefined || candidate.connector === connector) &&
    typeof candidate.connector === "string" &&
    typeof candidate.updatedAt === "string" &&
    (candidate.validatedAt === undefined || typeof candidate.validatedAt === "string") &&
    typeof candidate.data === "object" &&
    candidate.data !== null &&
    !Array.isArray(candidate.data)
  );
}
