import type { JsonObject } from "@strata/core";
import { createDefaultJobRegistry, type JobRegistry } from "./registry.js";
import { runJob } from "./runner.js";
import { ScheduleStore } from "./scheduleStore.js";
import type { JobScheduleRecord, JobScheduleRunResult, RunDueSchedulesResult } from "./types.js";

export interface RunDueSchedulesOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  limit?: number;
  registry?: JobRegistry;
}

export interface RunScheduleNowOptions {
  scheduleId: string;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  registry?: JobRegistry;
}

export interface SchedulerLoopOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  registry?: JobRegistry;
  pollMs?: number;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

export async function runDueSchedulesOnce(
  options: RunDueSchedulesOptions = {},
): Promise<RunDueSchedulesResult> {
  const now = options.now ?? new Date();
  const registry = options.registry ?? createDefaultJobRegistry();
  const store = await ScheduleStore.open(
    options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot },
  );
  try {
    const claimed = store.claimDue(
      options.limit === undefined ? { now } : { now, limit: options.limit },
    );
    const results: JobScheduleRunResult[] = [];
    for (const schedule of claimed) {
      results.push(await runClaimedSchedule(schedule, store, registry, options.env, now));
    }
    return {
      checkedAt: now.toISOString(),
      claimed: claimed.length,
      results,
    };
  } finally {
    store.close();
  }
}

export async function runScheduleNow(
  options: RunScheduleNowOptions,
): Promise<JobScheduleRunResult> {
  const now = options.now ?? new Date();
  const registry = options.registry ?? createDefaultJobRegistry();
  const store = await ScheduleStore.open(
    options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot },
  );
  try {
    const schedule = store.get(options.scheduleId);
    if (schedule === null) {
      throw new Error(`Schedule not found: ${options.scheduleId}`);
    }
    return await runClaimedSchedule(schedule, store, registry, options.env, now);
  } finally {
    store.close();
  }
}

export async function runSchedulerLoop(options: SchedulerLoopOptions = {}): Promise<void> {
  const pollMs = Math.max(1000, options.pollMs ?? 15_000);
  const registry = options.registry ?? createDefaultJobRegistry();
  options.onStatus?.(`scheduler loop started; polling every ${pollMs}ms`);
  while (!options.signal?.aborted) {
    const result = await runDueSchedulesOnce({
      ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
      ...(options.env === undefined ? {} : { env: options.env }),
      registry,
    });
    if (result.claimed > 0) {
      options.onStatus?.(
        `scheduler ran ${result.claimed} schedule${result.claimed === 1 ? "" : "s"}`,
      );
    }
    await sleep(pollMs, options.signal);
  }
}

async function runClaimedSchedule(
  schedule: JobScheduleRecord,
  store: ScheduleStore,
  registry: JobRegistry,
  env: Record<string, string | undefined> | undefined,
  now: Date,
): Promise<JobScheduleRunResult> {
  const result = await runJob({
    jobName: schedule.jobName,
    input: schedule.input as JsonObject,
    repoRoot: store.repoRoot,
    ...(env === undefined ? {} : { env }),
    now,
    registry,
    schedule: {
      id: schedule.id,
      name: schedule.name,
    },
    title: `Scheduled job: ${schedule.name}`,
  });
  store.markRun(schedule.id, result, now);
  return {
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    jobName: schedule.jobName,
    sessionId: result.sessionId,
    status: result.status,
    summary: result.summary,
    errorMessage: result.errorMessage,
  };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
