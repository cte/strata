import type { JsonObject, JsonValue } from "@strata/core";
import type { ToolDefinition } from "@strata/tools";
import { validateRoutineOutput } from "./schemas.js";
import type { RoutineStore } from "./store.js";
import type { RoutineDefinition, RoutineRunRecord } from "./types.js";

export interface RoutineOutputToolOptions {
  routine: RoutineDefinition;
  run: RoutineRunRecord;
  store: RoutineStore;
  now?: Date;
}

export interface RoutineOutputSubmitResult extends JsonObject {
  artifactId: string;
  routineRunId: string;
  routineId: string;
  validationStatus: "valid";
}

export function createRoutineOutputSubmitTool(
  options: RoutineOutputToolOptions,
): ToolDefinition<JsonObject, RoutineOutputSubmitResult> {
  const { routine, run, store } = options;
  const outputSchema = routine.outputSchema ?? { type: "object" };

  return {
    name: "routine.output.submit",
    description: "Submit the schema-valid structured output object for the current routine run.",
    // This is a controlled run-artifact write, not a capability to modify the wiki
    // or external systems. Keeping it read-mode makes structured output available
    // even to read-only routines.
    mode: "read",
    inputSchema: outputSchema,
    executionMode: "sequential",
    handler(args, context) {
      const validation = validateRoutineOutput(args, outputSchema);
      if (!validation.ok) {
        const error = new Error(
          `Routine output failed validation: ${validation.errors.join("; ")}`,
        );
        Object.assign(error, { code: "routine_output_validation_failed" });
        throw error;
      }

      const artifact = store.createRoutineArtifact({
        routineRunId: run.id,
        routineId: routine.id,
        schemaName: `${routine.id}.output`,
        schemaVersion: String(routine.version),
        payload: args,
        validationStatus: "valid",
        taskStatus: "succeeded",
        dedupeKey: dedupeKeyFromPayload(args),
        sourceRefs: sourceRefsFromPayload(args),
        sessionId: context.sessionId ?? run.jobSessionId ?? run.id,
        ...(options.now === undefined ? {} : { now: options.now }),
      });

      return {
        artifactId: artifact.id,
        routineRunId: run.id,
        routineId: routine.id,
        validationStatus: "valid",
      };
    },
  };
}

function dedupeKeyFromPayload(payload: JsonObject): string | null {
  const value = payload.dedupeKey;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sourceRefsFromPayload(payload: JsonObject): JsonObject[] {
  const value: JsonValue | undefined = payload.sourceRefs;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isJsonObject);
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
