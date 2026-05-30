import type { JsonObject } from "@strata/core";
import { createDefaultJobRegistry, type JobRegistry } from "./registry.js";
import { RoutineTriggerStore } from "./routineTriggerStore.js";
import { runJob } from "./runner.js";
import type {
  RoutineTriggerRecord,
  RoutineTriggerRunResult,
  RunDueTriggersResult,
} from "./types.js";

export interface RunDueTriggersOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  limit?: number;
  registry?: JobRegistry;
}

export interface RunTriggerNowOptions {
  triggerId: string;
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

export async function runDueTriggersOnce(
  options: RunDueTriggersOptions = {},
): Promise<RunDueTriggersResult> {
  const now = options.now ?? new Date();
  const registry = options.registry ?? createDefaultJobRegistry();
  const store = await RoutineTriggerStore.open(
    options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot },
  );
  try {
    const claimed = store.claimDue(
      options.limit === undefined ? { now } : { now, limit: options.limit },
    );
    const results: RoutineTriggerRunResult[] = [];
    for (const trigger of claimed) {
      results.push(await runClaimedTrigger(trigger, store, registry, options.env, now));
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

export async function runTriggerNow(
  options: RunTriggerNowOptions,
): Promise<RoutineTriggerRunResult> {
  const now = options.now ?? new Date();
  const registry = options.registry ?? createDefaultJobRegistry();
  const store = await RoutineTriggerStore.open(
    options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot },
  );
  try {
    const trigger = store.get(options.triggerId);
    if (trigger === null) {
      throw new Error(`Routine trigger not found: ${options.triggerId}`);
    }
    return await runClaimedTrigger(trigger, store, registry, options.env, now);
  } finally {
    store.close();
  }
}

export async function runSchedulerLoop(options: SchedulerLoopOptions = {}): Promise<void> {
  const pollMs = Math.max(1000, options.pollMs ?? 15_000);
  const registry = options.registry ?? createDefaultJobRegistry();
  options.onStatus?.(`scheduler loop started; polling every ${pollMs}ms`);
  while (!options.signal?.aborted) {
    const result = await runDueTriggersOnce({
      ...(options.repoRoot === undefined ? {} : { repoRoot: options.repoRoot }),
      ...(options.env === undefined ? {} : { env: options.env }),
      registry,
    });
    if (result.claimed > 0) {
      options.onStatus?.(
        `scheduler ran ${result.claimed} trigger${result.claimed === 1 ? "" : "s"}`,
      );
    }
    await sleep(pollMs, options.signal);
  }
}

async function runClaimedTrigger(
  trigger: RoutineTriggerRecord,
  store: RoutineTriggerStore,
  registry: JobRegistry,
  env: Record<string, string | undefined> | undefined,
  now: Date,
): Promise<RoutineTriggerRunResult> {
  const triggerLabel = trigger.name ?? trigger.routineId;
  const result = await runJob({
    jobName: "routine.run",
    input: { routineId: trigger.routineId, input: trigger.input } as JsonObject,
    repoRoot: store.repoRoot,
    ...(env === undefined ? {} : { env }),
    now,
    registry,
    schedule: {
      id: trigger.id,
      name: triggerLabel,
    },
    title: `Routine trigger: ${triggerLabel}`,
  });
  store.markRun(trigger.id, result, now);
  return {
    triggerId: trigger.id,
    triggerName: trigger.name,
    routineId: trigger.routineId,
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
