import {
  type ConnectorConfigProfileRecord,
  readConnectorConfigProfile,
  readDefaultConnectorConfigProfile,
} from "@strata/ingest/connectors";
import {
  type CreateJobScheduleInput,
  createDefaultJobRegistry,
  type JobScheduleRecord,
  type JobScheduleRunResult,
  runScheduleNow,
  ScheduleStore,
  type UpdateJobScheduleInput,
} from "@strata/jobs";
import { listIngestActivityForWeb } from "./activityServices.js";
import { repoRoot, runtimeEnv, type WebApiOptions } from "./runtime.js";
import type {
  ConnectorScheduleEnabledRpcInput,
  ConnectorSchedulePreset,
  ConnectorSchedulePresetRpcInput,
  ConnectorScheduleStatus,
  ScheduleCreateRpcInput,
  ScheduleDeleteRpcInput,
  ScheduledConnectorName,
  ScheduledConnectorRpcInput,
  ScheduleRunNowRpcInput,
  ScheduleUpdateRpcInput,
} from "./trpc.js";

export function listJobs() {
  return { jobs: createDefaultJobRegistry().list() };
}

export async function listSchedules(
  options: WebApiOptions,
): Promise<{ schedules: JobScheduleRecord[] }> {
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    return { schedules: store.list() };
  } finally {
    store.close();
  }
}

export async function createSchedule(
  input: ScheduleCreateRpcInput,
  options: WebApiOptions,
): Promise<JobScheduleRecord> {
  const registry = createDefaultJobRegistry();
  if (registry.get(input.jobName) === undefined) {
    throw new Error(`Unknown job: ${input.jobName}`);
  }
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    const createInput: CreateJobScheduleInput = {
      name: input.name,
      jobName: input.jobName,
      trigger: input.trigger,
      enabled: input.enabled,
      input: input.input,
    };
    return store.create(createInput);
  } finally {
    store.close();
  }
}

export async function updateSchedule(
  input: ScheduleUpdateRpcInput,
  options: WebApiOptions,
): Promise<JobScheduleRecord> {
  if (input.jobName !== undefined && createDefaultJobRegistry().get(input.jobName) === undefined) {
    throw new Error(`Unknown job: ${input.jobName}`);
  }
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    const updateInput: UpdateJobScheduleInput = {
      id: input.id,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.jobName === undefined ? {} : { jobName: input.jobName }),
      ...(input.input === undefined ? {} : { input: input.input }),
      ...(input.trigger === undefined ? {} : { trigger: input.trigger }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    };
    return store.update(updateInput);
  } finally {
    store.close();
  }
}

export async function deleteSchedule(
  input: ScheduleDeleteRpcInput,
  options: WebApiOptions,
): Promise<{ deleted: boolean }> {
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    return { deleted: store.delete(input.id) };
  } finally {
    store.close();
  }
}

export async function runScheduleNowFromWeb(
  input: ScheduleRunNowRpcInput,
  options: WebApiOptions,
): Promise<JobScheduleRunResult> {
  return runScheduleNow({
    scheduleId: input.id,
    repoRoot: repoRoot(options),
    env: runtimeEnv(options),
    registry: createDefaultJobRegistry(),
  });
}

export async function connectorScheduleStatus(
  input: ScheduledConnectorRpcInput,
  options: WebApiOptions,
): Promise<ConnectorScheduleStatus> {
  const [schedules, activity, defaultProfile] = await Promise.all([
    listConnectorSchedules(input.connector, options),
    listIngestActivityForWeb(
      { source: input.connector, limit: 20, writesOrIndexesOnly: false },
      options,
    ),
    readDefaultConnectorConfigProfile(input.connector, repoRoot(options)),
  ]);
  const schedule = primaryConnectorSchedule(schedules);
  const scheduleProfileId = scheduleConfigProfileId(schedule);
  const scheduleProfile =
    scheduleProfileId === null
      ? null
      : await readConnectorConfigProfile(input.connector, scheduleProfileId, repoRoot(options));
  return {
    connector: input.connector,
    schedule,
    scheduleCount: schedules.length,
    presets: connectorSchedulePresets(input.connector, defaultProfile),
    defaultProfile,
    scheduleProfile,
    scheduleProfileMissing:
      scheduleProfileId !== null && scheduleProfile === null ? scheduleProfileId : null,
    lastActivity:
      activity.runs.find(
        (run) => run.source === input.connector || run.connector === input.connector,
      ) ?? null,
  };
}

export async function applyConnectorSchedulePreset(
  input: ConnectorSchedulePresetRpcInput,
  options: WebApiOptions,
): Promise<ConnectorScheduleStatus> {
  const defaultProfile = await readDefaultConnectorConfigProfile(
    input.connector,
    repoRoot(options),
  );
  const preset = requireConnectorSchedulePreset(input.connector, input.presetId, defaultProfile);
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    const existing = primaryConnectorSchedule(
      connectorSchedulesFromList(store.list(), input.connector),
    );
    if (existing === null) {
      store.create({
        name: preset.scheduleName,
        jobName: "connector.pull",
        input: preset.input,
        trigger: preset.trigger,
        enabled: input.enabled ?? true,
      });
    } else {
      store.update({
        id: existing.id,
        name: preset.scheduleName,
        jobName: "connector.pull",
        input: preset.input,
        trigger: preset.trigger,
        enabled: input.enabled ?? true,
      });
    }
  } finally {
    store.close();
  }
  return connectorScheduleStatus({ connector: input.connector }, options);
}

export async function setConnectorScheduleEnabled(
  input: ConnectorScheduleEnabledRpcInput,
  options: WebApiOptions,
): Promise<ConnectorScheduleStatus> {
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    const schedule = primaryConnectorSchedule(
      connectorSchedulesFromList(store.list(), input.connector),
    );
    if (schedule === null) {
      throw new Error(`No ${input.connector} connector schedule is configured.`);
    }
    store.update({ id: schedule.id, enabled: input.enabled });
  } finally {
    store.close();
  }
  return connectorScheduleStatus({ connector: input.connector }, options);
}

export async function runConnectorScheduleNow(
  input: ScheduledConnectorRpcInput,
  options: WebApiOptions,
): Promise<ConnectorScheduleStatus> {
  const schedules = await listConnectorSchedules(input.connector, options);
  const schedule = primaryConnectorSchedule(schedules);
  if (schedule === null) {
    throw new Error(`No ${input.connector} connector schedule is configured.`);
  }
  await runScheduleNowFromWeb({ id: schedule.id }, options);
  return connectorScheduleStatus(input, options);
}

async function listConnectorSchedules(
  connector: ScheduledConnectorName,
  options: WebApiOptions,
): Promise<JobScheduleRecord[]> {
  const store = await ScheduleStore.open({ repoRoot: repoRoot(options) });
  try {
    return connectorSchedulesFromList(store.list(), connector);
  } finally {
    store.close();
  }
}

function connectorSchedulesFromList(
  schedules: JobScheduleRecord[],
  connector: ScheduledConnectorName,
): JobScheduleRecord[] {
  return schedules
    .filter(
      (schedule) => schedule.jobName === "connector.pull" && schedule.input.connector === connector,
    )
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      const leftRun = left.nextRunAt ?? left.updatedAt;
      const rightRun = right.nextRunAt ?? right.updatedAt;
      return rightRun.localeCompare(leftRun);
    });
}

function primaryConnectorSchedule(schedules: JobScheduleRecord[]): JobScheduleRecord | null {
  return schedules[0] ?? null;
}

function connectorSchedulePresets(
  connector: ScheduledConnectorName,
  defaultProfile: ConnectorConfigProfileRecord | null,
): ConnectorSchedulePreset[] {
  return CONNECTOR_SCHEDULE_PRESETS.filter((preset) => preset.connector === connector).map(
    (preset) => presetWithDefaultProfile(preset, defaultProfile),
  );
}

function requireConnectorSchedulePreset(
  connector: ScheduledConnectorName,
  presetId: string,
  defaultProfile: ConnectorConfigProfileRecord | null,
): ConnectorSchedulePreset {
  const preset = connectorSchedulePresets(connector, defaultProfile).find(
    (candidate) => candidate.id === presetId,
  );
  if (preset === undefined) {
    throw new Error(`Unknown ${connector} schedule preset: ${presetId}`);
  }
  return preset;
}

function presetWithDefaultProfile(
  preset: ConnectorSchedulePresetTemplate,
  defaultProfile: ConnectorConfigProfileRecord | null,
): ConnectorSchedulePreset {
  return {
    ...preset,
    input:
      defaultProfile === null
        ? preset.input
        : {
            ...preset.input,
            configProfileId: defaultProfile.id,
          },
    usesDefaultProfile: defaultProfile !== null,
  };
}

function scheduleConfigProfileId(schedule: JobScheduleRecord | null): string | null {
  const value = schedule?.input.configProfileId;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

type ConnectorSchedulePresetTemplate = Omit<ConnectorSchedulePreset, "usesDefaultProfile">;

const CONNECTOR_SCHEDULE_PRESETS: ConnectorSchedulePresetTemplate[] = [
  {
    id: "granola-near-real-time",
    connector: "granola",
    label: "Near real-time",
    description:
      "Polls recent notes every two minutes, indexes written raw snapshots, and refreshes retrieval.",
    scheduleName: "Granola near-real-time sync",
    trigger: { type: "interval", seconds: 120 },
    input: {
      connector: "granola",
      lookbackMinutes: 240,
      config: { since: "", maxPages: 3 },
      index: true,
      refreshSearchIndex: true,
      title: "Scheduled Granola pull",
    },
  },
  {
    id: "granola-hourly-backstop",
    connector: "granola",
    label: "Hourly backstop",
    description: "Runs a wider hourly pass for missed edits or meetings that appeared late.",
    scheduleName: "Granola hourly backstop",
    trigger: { type: "interval", seconds: 3600 },
    input: {
      connector: "granola",
      lookbackMinutes: 1440,
      config: { since: "", maxPages: 10 },
      index: true,
      refreshSearchIndex: true,
      title: "Scheduled Granola backstop",
    },
  },
  {
    id: "slack-staged-sync",
    connector: "slack",
    label: "Staged channel sync",
    description:
      "Polls visible channels every ten minutes with conservative caps, then indexes material raw snapshots.",
    scheduleName: "Slack staged sync",
    trigger: { type: "interval", seconds: 600 },
    input: {
      connector: "slack",
      lookbackMinutes: 240,
      config: {
        mode: "sync",
        since: "",
        allHistory: false,
        includePrivateChannels: false,
        includeDms: false,
        maxChannels: 50,
        maxMessagesPerChannel: 250,
        maxThreads: 250,
      },
      index: true,
      refreshSearchIndex: true,
      title: "Scheduled Slack sync",
    },
  },
  {
    id: "slack-hourly-low-impact",
    connector: "slack",
    label: "Hourly low-impact",
    description: "Runs a smaller hourly checkpointed sync for low-noise background capture.",
    scheduleName: "Slack hourly low-impact sync",
    trigger: { type: "interval", seconds: 3600 },
    input: {
      connector: "slack",
      lookbackMinutes: 720,
      config: {
        mode: "sync",
        since: "",
        allHistory: false,
        includePrivateChannels: false,
        includeDms: false,
        maxChannels: 25,
        maxMessagesPerChannel: 150,
        maxThreads: 100,
      },
      index: true,
      refreshSearchIndex: true,
      title: "Scheduled Slack low-impact sync",
    },
  },
];
