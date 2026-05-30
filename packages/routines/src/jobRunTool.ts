import type { JsonObject, JsonValue } from "@strata/core";
import type { ToolDefinition } from "@strata/tools";

/**
 * Lets a Routine's agent trigger a registered Job by name, without needing the
 * `dangerous` shell. The job runs as a child Job Session through the injected
 * runner (the same callback `preRunSteps` uses), so every trigger is auditable.
 * `routine.run` is excluded — a Routine triggering itself would recurse.
 */

const EXCLUDED_JOB = "routine.run";

export interface JobRunInput {
  jobName: string;
  input: JsonObject;
  title?: string;
}

export interface JobRunResult {
  sessionId: string;
  jobName: string;
  status: "completed" | "failed";
  summary: string;
  errorMessage: string | null;
  output: JsonValue | null;
}

export type JobRunner = (input: JobRunInput) => Promise<JobRunResult>;

export interface JobRunToolOptions {
  runJob: JobRunner;
}

export interface JobRunToolResult extends JsonObject {
  jobName: string;
  sessionId: string;
  status: "completed" | "failed";
  summary: string;
  errorMessage: string | null;
}

export function createJobRunTool(
  options: JobRunToolOptions,
): ToolDefinition<JsonObject, JobRunToolResult> {
  return {
    name: "job.run",
    description:
      "Run a registered Strata job by name (e.g. connector.pull, raw.index, wiki.search-index.refresh, wiki.hygiene). The job runs as a trace-backed child session and the result is returned. routine.run is not allowed.",
    mode: "write",
    executionMode: "sequential",
    inputSchema: {
      type: "object",
      required: ["jobName"],
      additionalProperties: false,
      properties: {
        jobName: {
          type: "string",
          description: "Registered job name to run. routine.run is rejected.",
        },
        input: {
          type: "object",
          description: "JSON input passed to the job (defaults to {}).",
        },
      },
    },
    async handler(args, _context) {
      const jobName = typeof args.jobName === "string" ? args.jobName.trim() : "";
      if (jobName === "") {
        throw toolError("job_run_invalid", "job.run requires a non-empty jobName.");
      }
      if (jobName === EXCLUDED_JOB) {
        throw toolError(
          "job_run_forbidden",
          "job.run cannot run routine.run (a routine cannot trigger itself).",
        );
      }
      const input = isJsonObject(args.input) ? args.input : {};
      const result = await options.runJob({ jobName, input, title: `job.run: ${jobName}` });
      return {
        jobName: result.jobName,
        sessionId: result.sessionId,
        status: result.status,
        summary: result.summary,
        errorMessage: result.errorMessage,
      };
    },
  };
}

function toolError(code: string, message: string): Error {
  const error = new Error(message);
  Object.assign(error, { code });
  return error;
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
