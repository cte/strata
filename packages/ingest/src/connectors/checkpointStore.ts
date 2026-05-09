import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStrataPaths } from "@strata/core";
import type { JsonObject } from "../common.js";
import type { ConnectorName } from "./types.js";

export interface ConnectorCheckpointRecord {
  version: 1;
  connector: ConnectorName;
  data: JsonObject;
  updatedAt: string;
}

export function getConnectorCheckpointPath(connector: ConnectorName, repoRoot?: string): string {
  return path.join(getStrataPaths(repoRoot).runtimeDir, "connectors", connector, "checkpoint.json");
}

export async function readConnectorCheckpoint(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<ConnectorCheckpointRecord | null> {
  const file = getConnectorCheckpointPath(connector, repoRoot);
  if (!existsSync(file)) {
    return null;
  }

  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!isConnectorCheckpointRecord(parsed, connector)) {
    throw new Error(`Invalid ${connector} checkpoint store: ${file}`);
  }
  return parsed;
}

export async function writeConnectorCheckpoint(input: {
  connector: ConnectorName;
  data: JsonObject;
  repoRoot?: string;
  now?: Date;
}): Promise<ConnectorCheckpointRecord> {
  const record: ConnectorCheckpointRecord = {
    version: 1,
    connector: input.connector,
    data: input.data,
    updatedAt: (input.now ?? new Date()).toISOString(),
  };

  const file = getConnectorCheckpointPath(input.connector, input.repoRoot);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await chmod(file, 0o600);
  return record;
}

export async function deleteConnectorCheckpoint(
  connector: ConnectorName,
  repoRoot?: string,
): Promise<void> {
  await rm(getConnectorCheckpointPath(connector, repoRoot), { force: true });
}

function isConnectorCheckpointRecord(
  value: unknown,
  connector?: ConnectorName,
): value is ConnectorCheckpointRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ConnectorCheckpointRecord>;
  return (
    candidate.version === 1 &&
    (connector === undefined || candidate.connector === connector) &&
    typeof candidate.connector === "string" &&
    typeof candidate.updatedAt === "string" &&
    typeof candidate.data === "object" &&
    candidate.data !== null &&
    !Array.isArray(candidate.data)
  );
}
