import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  asArray,
  asObject,
  asObjects,
  firstString,
  frontmatter,
  type JsonObject,
  slugify,
  utcNow,
  writeOnce,
} from "./common.js";
import {
  deleteConnectorSecret,
  getConnectorSecretPath,
  hasConnectorSecretSync,
  readConnectorSecret,
  writeConnectorSecret,
} from "./connectors/store.js";
import type {
  ConnectorDefinition,
  ConnectorPullResult,
  ConnectorRuntime,
  ConnectorStatus,
} from "./connectors/types.js";
import { redactConnectorMessage } from "./connectors/types.js";

const DEFAULT_GRANOLA_NOTES_URL = "https://public-api.granola.ai/v1/notes";

export interface GranolaConnectorConfig extends Record<string, string | undefined> {
  apiToken?: string;
  fixture?: string;
  meetingsUrl?: string;
  since?: string;
  transcriptUrlTemplate?: string;
}

export interface GranolaOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export type GranolaStatusState = "connected" | "not_configured" | "invalid";

export interface GranolaStatus {
  state: GranolaStatusState;
  configured: boolean;
  message: string;
  validatedAt?: string;
}

export interface GranolaConfigureInput {
  apiToken: string;
}

interface GranolaSecretData extends JsonObject {
  apiToken: string;
  validatedAt: string;
}

interface LegacyGranolaStoreData {
  version: 1;
  apiToken: string;
  validatedAt: string;
  updatedAt: string;
}

export const granolaConnector = {
  name: "granola",
  displayName: "Granola",
  description: "Snapshot meeting transcripts into wiki/raw/granola.",
  mode: "sync",
  capabilities: ["configure", "validate", "dry_run", "pull"],
  configSchema: {
    fields: {
      apiToken: {
        type: "string",
        label: "Granola API key",
        description: "Personal API key used to validate and pull Granola notes.",
        required: true,
        secret: true,
        env: "GRANOLA_API_TOKEN",
      },
      since: {
        type: "string",
        label: "Since",
        description: "ISO timestamp lower bound for API pulls.",
        placeholder: "2026-05-01T00:00:00.000Z",
      },
      meetingsUrl: {
        type: "string",
        label: "Meetings URL",
        description: "Override Granola notes/meetings API URL.",
        env: "GRANOLA_MEETINGS_URL",
      },
      transcriptUrlTemplate: {
        type: "string",
        label: "Transcript URL template",
        description: "Optional detail endpoint containing {id}.",
        env: "GRANOLA_TRANSCRIPT_URL_TEMPLATE",
      },
      fixture: {
        type: "string",
        label: "Fixture file",
        description: "Local JSON fixture for offline pulls.",
      },
    },
  },
  async getStatus(runtime) {
    return connectorStatusFromGranolaStatus(await getGranolaStatus(optionsFromRuntime(runtime)));
  },
  async validate(config, runtime) {
    const apiToken = await resolveGranolaApiToken(config.apiToken, optionsFromRuntime(runtime));
    if (apiToken === "") {
      return {
        name: "granola",
        state: "not_configured",
        configured: false,
        message: "Granola is not connected. Paste a personal API key to configure.",
      };
    }
    await validateGranolaCredentials(apiToken, optionsFromRuntime(runtime));
    return {
      name: "granola",
      state: "ready",
      configured: true,
      message: "Granola API key is valid.",
    };
  },
  async dryRun(config, runtime) {
    return runGranola(config, runtime, true);
  },
  async pull(config, runtime) {
    return runGranola(config, runtime, false);
  },
} satisfies ConnectorDefinition<GranolaConnectorConfig> &
  Required<Pick<ConnectorDefinition<GranolaConnectorConfig>, "dryRun" | "pull">>;

export function getGranolaStorePath(repoRoot?: string): string {
  return getConnectorSecretPath("granola", repoRoot);
}

export function hasGranolaCredentialsSync(options: GranolaOptions = {}): boolean {
  if (hasConnectorSecretSync("granola", options.repoRoot)) {
    return true;
  }
  const file = getGranolaStorePath(options.repoRoot);
  if (!existsSync(file)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isLegacyGranolaStoreData(parsed) && parsed.apiToken.length > 0;
  } catch {
    return false;
  }
}

export async function getGranolaStatus(options: GranolaOptions = {}): Promise<GranolaStatus> {
  const data = await loadGranolaSecret(options.repoRoot);
  if (!data) {
    const env = options.env ?? Bun.env;
    if (env.GRANOLA_API_TOKEN) {
      return {
        state: "connected",
        configured: true,
        message: "Granola API token is loaded from the GRANOLA_API_TOKEN environment variable.",
      };
    }
    return {
      state: "not_configured",
      configured: false,
      message: "Granola is not connected. Paste a personal API key to configure.",
    };
  }

  return {
    state: "connected",
    configured: true,
    message: "Granola is connected. Strata can pull meeting transcripts on demand.",
    validatedAt: data.validatedAt,
  };
}

export async function configureGranola(
  input: GranolaConfigureInput,
  options: GranolaOptions = {},
): Promise<GranolaStatus> {
  const apiToken = input.apiToken.trim();
  if (apiToken === "") {
    throw new Error("Granola API token is required.");
  }

  await validateGranolaCredentials(apiToken, options);

  const validatedAt = (options.now ?? new Date()).toISOString();
  await writeConnectorSecret({
    connector: "granola",
    validatedAt,
    data: {
      apiToken,
      validatedAt,
    },
    ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

  return {
    state: "connected",
    configured: true,
    message: "Granola is connected. Strata can pull meeting transcripts on demand.",
    validatedAt,
  };
}

export async function disconnectGranola(options: GranolaOptions = {}): Promise<GranolaStatus> {
  await deleteConnectorSecret("granola", options.repoRoot);
  return getGranolaStatus(options);
}

export async function resolveGranolaApiToken(
  override: string | undefined,
  options: GranolaOptions = {},
): Promise<string> {
  const explicit = override?.trim() ?? "";
  if (explicit !== "") {
    return explicit;
  }
  const secret = await loadGranolaSecret(options.repoRoot);
  if (secret?.apiToken) {
    return secret.apiToken;
  }
  return options.env?.GRANOLA_API_TOKEN?.trim() ?? Bun.env.GRANOLA_API_TOKEN?.trim() ?? "";
}

export async function validateGranolaCredentials(
  apiToken: string,
  options: GranolaOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = granolaNotesUrl(options);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not reach Granola API: ${redactConnectorMessage(message)}`);
  }

  if (response.ok) {
    return;
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Granola rejected the API key (401/403). Double-check the personal key and that your plan supports API access.",
    );
  }
  if (response.status === 404) {
    throw new Error(`Granola API returned 404 at ${url}. The endpoint may have changed.`);
  }
  throw new Error(`Granola validation failed with HTTP ${response.status}.`);
}

async function runGranola(
  config: GranolaConnectorConfig,
  runtime: ConnectorRuntime,
  dryRun: boolean,
): Promise<ConnectorPullResult> {
  const options = optionsFromRuntime(runtime);
  const since = config.since?.trim() || defaultSince(runtime.now ?? utcNow());
  const payload = await loadGranolaPayload(config, options, since);
  const pulledAt = (runtime.now ?? utcNow()).toISOString();
  const rawDir = path.join(runtime.repoRoot, "wiki", "raw", "granola");
  const items = [];
  let writtenCount = 0;
  let skippedCount = 0;

  for (const originalMeeting of meetingsFromPayload(payload)) {
    const meeting = await fetchDetailIfNeeded(originalMeeting, config, options);
    const rendered = renderMeeting(meeting, rawDir, runtime.repoRoot, pulledAt);
    const written = dryRun ? false : await writeOnce(rendered.filePath, rendered.content);
    const skipped = dryRun ? false : !written;
    if (written) {
      writtenCount += 1;
    }
    if (skipped) {
      skippedCount += 1;
    }
    items.push({
      sourceId: rendered.sourceId,
      title: rendered.title,
      rawPath: rendered.relativePath,
      sourceUrl: rendered.sourceUrl,
      written,
      skipped,
      metadata: {
        date: rendered.date,
      },
    });
  }

  const firstItem = items[0];
  return {
    connector: "granola",
    sourceId: `granola:${since}`,
    title: `Granola meetings since ${since}`,
    rawPath: firstItem?.rawPath ?? "wiki/raw/granola",
    sourceUrl: null,
    written: writtenCount > 0,
    skipped: items.length > 0 && skippedCount === items.length,
    dryRun,
    metadata: {
      since,
      itemCount: items.length,
      writtenCount,
      skippedCount,
    },
    items,
  };
}

async function loadGranolaPayload(
  config: GranolaConnectorConfig,
  options: GranolaOptions,
  since: string,
): Promise<unknown> {
  if (config.fixture?.trim()) {
    return JSON.parse(await readFile(config.fixture.trim(), "utf8"));
  }
  const apiToken = await resolveGranolaApiToken(config.apiToken, options);
  if (apiToken === "") {
    throw new Error("Set GRANOLA_API_TOKEN, configure Granola, or pass a fixture file.");
  }
  return requestJson(buildUrl(granolaMeetingsUrl(config, options), since), apiToken, options);
}

async function requestJson(url: string, token: string, options: GranolaOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching Granola API.`);
  }
  return response.json();
}

function meetingsFromPayload(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return asObjects(payload);
  }
  const object = asObject(payload);
  if (!object) {
    return [];
  }
  for (const key of ["meetings", "notes", "data", "results", "items"]) {
    const value = object[key];
    if (Array.isArray(value)) {
      return asObjects(value);
    }
  }
  return [];
}

async function fetchDetailIfNeeded(
  item: JsonObject,
  config: GranolaConnectorConfig,
  options: GranolaOptions,
): Promise<JsonObject> {
  if (meetingTranscript(item)) {
    return item;
  }
  const template =
    config.transcriptUrlTemplate?.trim() || options.env?.GRANOLA_TRANSCRIPT_URL_TEMPLATE?.trim();
  if (!template) {
    return item;
  }
  const meetingId = firstString(item, ["id", "meeting_id", "uuid"]);
  if (!meetingId) {
    return item;
  }
  const apiToken = await resolveGranolaApiToken(config.apiToken, options);
  if (apiToken === "") {
    return item;
  }
  const detail = asObject(
    await requestJson(template.replace("{id}", encodeURIComponent(meetingId)), apiToken, options),
  );
  return detail ? { ...item, ...detail } : item;
}

function renderMeeting(
  item: JsonObject,
  rawDir: string,
  repoRoot: string,
  pulledAt: string,
): {
  filePath: string;
  relativePath: string;
  content: string;
  date: string;
  sourceId: string;
  title: string;
  sourceUrl: string | null;
} {
  const date = meetingDate(item);
  const title = firstString(item, ["title", "name", "summary"], "Untitled meeting");
  const attendees = normalizeAttendees(item.attendees ?? item.participants);
  const sourceUrl = firstString(item, ["source_url", "url", "app_url", "web_url"]) || null;
  const transcript = meetingTranscript(item);
  const sourceId = firstString(item, ["id", "meeting_id", "uuid"], `${date}:${title}`);
  const filePath = path.join(rawDir, `${date}-${slugify(title, "meeting")}.md`);
  const metadata = frontmatter({
    type: "raw_granola_transcript",
    source: "granola",
    date,
    title,
    attendees,
    source_url: sourceUrl,
    pulled_at: pulledAt,
  });
  const body = transcript || "_No transcript text was present in the API response._";
  return {
    filePath,
    relativePath: path.relative(repoRoot, filePath),
    content: `${metadata}\n# ${title}\n\n${body.trimEnd()}\n`,
    date,
    sourceId,
    title,
    sourceUrl,
  };
}

function normalizeAttendees(value: unknown): string[] {
  return asArray(value).flatMap((item) => {
    if (typeof item === "string") {
      return [item];
    }
    const object = asObject(item);
    if (!object) {
      return [];
    }
    const name = firstString(object, ["name", "display_name", "email"]);
    return name ? [name] : [];
  });
}

function meetingDate(item: JsonObject): string {
  const raw = firstString(item, ["date", "start_time", "startTime", "created_at", "createdAt"]);
  return raw ? raw.slice(0, 10) : utcNow().toISOString().slice(0, 10);
}

function meetingTranscript(item: JsonObject): string {
  for (const key of ["transcript", "notes", "text", "content", "markdown"]) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function buildUrl(baseUrl: string, since: string): string {
  const url = new URL(baseUrl);
  if (!url.searchParams.has("since")) {
    url.searchParams.set("since", since);
  }
  return url.toString();
}

function granolaMeetingsUrl(config: GranolaConnectorConfig, options: GranolaOptions): string {
  return (
    config.meetingsUrl?.trim() ||
    options.env?.GRANOLA_MEETINGS_URL?.trim() ||
    DEFAULT_GRANOLA_NOTES_URL
  );
}

function defaultSince(now: Date): string {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

function optionsFromRuntime(runtime: ConnectorRuntime): GranolaOptions {
  return {
    repoRoot: runtime.repoRoot,
    env: runtime.env,
    ...(runtime.fetchImpl === undefined ? {} : { fetchImpl: runtime.fetchImpl }),
    ...(runtime.now === undefined ? {} : { now: runtime.now }),
  };
}

function connectorStatusFromGranolaStatus(status: GranolaStatus): ConnectorStatus {
  return {
    name: "granola",
    state: status.state === "connected" ? "ready" : status.state,
    configured: status.configured,
    message: status.message,
    ...(status.validatedAt === undefined ? {} : { details: { validatedAt: status.validatedAt } }),
  };
}

function granolaNotesUrl(options: GranolaOptions): string {
  return options.env?.GRANOLA_NOTES_URL ?? DEFAULT_GRANOLA_NOTES_URL;
}

async function loadGranolaSecret(repoRoot?: string): Promise<GranolaSecretData | null> {
  const record = await readConnectorSecret("granola", repoRoot).catch(async (error: unknown) => {
    const legacy = loadLegacyGranolaSecret(repoRoot);
    if (legacy !== null) {
      return null;
    }
    throw error;
  });
  if (record !== null) {
    const data = record.data;
    if (isGranolaSecretData(data)) {
      return data;
    }
    throw new Error(`Invalid Granola secret store: ${getGranolaStorePath(repoRoot)}`);
  }
  return loadLegacyGranolaSecret(repoRoot);
}

function loadLegacyGranolaSecret(repoRoot?: string): GranolaSecretData | null {
  const file = getGranolaStorePath(repoRoot);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isLegacyGranolaStoreData(parsed)) {
      return null;
    }
    return {
      apiToken: parsed.apiToken,
      validatedAt: parsed.validatedAt,
    };
  } catch {
    return null;
  }
}

function isGranolaSecretData(value: JsonObject): value is GranolaSecretData {
  return typeof value.apiToken === "string" && typeof value.validatedAt === "string";
}

function isLegacyGranolaStoreData(value: unknown): value is LegacyGranolaStoreData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<LegacyGranolaStoreData>;
  return (
    candidate.version === 1 &&
    typeof candidate.apiToken === "string" &&
    typeof candidate.validatedAt === "string" &&
    typeof candidate.updatedAt === "string"
  );
}
