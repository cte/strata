import { getStrataPaths, type JsonObject, type JsonValue, SessionStore } from "@strata/core";
import type { JobRegistry } from "./registry.js";
import type { JobExecutionResult, JobRunContext, JobRunOutput } from "./types.js";

export interface RunJobOptions {
  jobName: string;
  input?: JsonObject;
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  now?: Date;
  registry: JobRegistry;
  schedule?: {
    id: string;
    name: string;
  };
  title?: string;
}

export async function runJob(options: RunJobOptions): Promise<JobExecutionResult> {
  const definition = options.registry.get(options.jobName);
  if (definition === undefined) {
    throw new Error(`Unknown job: ${options.jobName}`);
  }

  const repoRoot = getStrataPaths(options.repoRoot).repoRoot;
  const now = options.now ?? new Date();
  const input = options.input ?? {};
  const store = await SessionStore.open(repoRoot);
  const session = await store.createSession({
    kind: "job",
    title: options.title ?? `Job: ${definition.name}`,
  });

  try {
    await store.appendEvent(session.id, "job.started", {
      jobName: definition.name,
      mode: definition.mode,
      input: redactJobInput(input),
      schedule: options.schedule ?? null,
    });

    const context: JobRunContext = {
      repoRoot,
      env: options.env ?? Bun.env,
      now,
      sessionId: session.id,
      runJob: (input) =>
        runJob({
          jobName: input.jobName,
          repoRoot,
          now,
          registry: options.registry,
          ...(options.env === undefined ? {} : { env: options.env }),
          ...(input.input === undefined ? {} : { input: input.input }),
          ...(input.title === undefined ? {} : { title: input.title }),
        }),
    };
    const output = await definition.run(input, context);
    const result: JobExecutionResult = {
      sessionId: session.id,
      jobName: definition.name,
      status: "completed",
      summary: output.summary,
      output,
      errorMessage: null,
    };
    await store.appendEvent(session.id, "job.completed", {
      ...result,
      schedule: options.schedule ?? null,
    });
    await store.endSession(session.id, "completed");
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const output: JobRunOutput = {
      status: "needs_attention",
      summary: message,
      metrics: {},
    };
    const result: JobExecutionResult = {
      sessionId: session.id,
      jobName: definition.name,
      status: "failed",
      summary: message,
      output,
      errorMessage: message,
    };
    await store.appendEvent(session.id, "job.failed", {
      jobName: definition.name,
      message,
      schedule: options.schedule ?? null,
    });
    await store.endSession(session.id, "failed");
    return result;
  } finally {
    store.close();
  }
}

export function jsonObject(value: JsonValue | undefined): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function redactJobInput(input: JsonObject): JsonObject {
  return redactJsonObject(input);
}

function redactJsonObject(input: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactJsonValue(key, value);
  }
  return output;
}

function redactJsonValue(key: string, value: JsonValue): JsonValue {
  if (isSecretKey(key)) {
    return "[redacted]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(key, item));
  }
  if (typeof value === "object" && value !== null) {
    return redactJsonObject(value);
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "xox[redacted]");
  }
  return value;
}

function isSecretKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization|oauth/i.test(key);
}
