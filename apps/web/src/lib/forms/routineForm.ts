import { z } from "zod";
import type { RoutineCreateInput, RoutineDetail, RoutineStatus } from "@/lib/api";
import { jsonArrayText, jsonObjectText, requiredText } from "@/lib/forms/zod";

/**
 * Form-shaped routine definition. Every field is a string (the JSON fields hold
 * raw JSON text) so it maps 1:1 onto controlled inputs; `buildRoutinePayload`
 * parses it into the server's `RoutineCreateInput`. The server store re-validates
 * with the same rules, so these zod schemas are UX feedback, not the source of
 * truth (see the "Web client data fetching" invariant in AGENTS.md).
 */
export interface RoutineFormValues {
  id: string;
  name: string;
  description: string;
  status: RoutineStatus;
  toolProfile: RoutineDetail["toolProfile"];
  outputMode: RoutineDetail["outputMode"];
  prompt: string;
  requiredSkills: string;
  inputSchema: string;
  defaultInput: string;
  outputSchema: string;
  preRunSteps: string;
  publicationPolicy: string;
}

export type RoutineFormMode = "create" | "edit";

export const TOOL_PROFILE_OPTIONS: RoutineDetail["toolProfile"][] = [
  "read-only",
  "maintenance",
  "learning",
  "dangerous",
];
export const OUTPUT_MODE_OPTIONS: RoutineDetail["outputMode"][] = ["none", "optional", "required"];
export const ROUTINE_STATUS_OPTIONS: RoutineStatus[] = ["enabled", "disabled", "archived"];

export const BLANK_ROUTINE_FORM: RoutineFormValues = {
  id: "",
  name: "",
  description: "",
  status: "enabled",
  toolProfile: "maintenance",
  outputMode: "none",
  prompt: "",
  requiredSkills: "",
  inputSchema: '{\n  "type": "object"\n}',
  defaultInput: "",
  outputSchema: "",
  preRunSteps: "[]",
  publicationPolicy: '{\n  "mode": "artifact_only"\n}',
};

export function routineFormValues(routine: RoutineDetail): RoutineFormValues {
  return {
    id: routine.id,
    name: routine.name,
    description: routine.description,
    status: routine.status,
    toolProfile: routine.toolProfile,
    outputMode: routine.outputMode,
    prompt: routine.prompt,
    requiredSkills: routine.requiredSkills.join(", "),
    inputSchema: formatJson(routine.inputSchema),
    defaultInput: routine.defaultInput ? formatJson(routine.defaultInput) : "",
    outputSchema: routine.outputSchema ? formatJson(routine.outputSchema) : "",
    preRunSteps: formatJson(routine.preRunSteps),
    publicationPolicy: formatJson(routine.publicationPolicy),
  };
}

// --- Per-field zod validators (passed straight to TanStack Form via Standard Schema) ---

export const routineFieldSchemas = {
  name: requiredText("Name"),
  description: requiredText("Description"),
  prompt: requiredText("Prompt"),
  id: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._:-]*$/, "Use letters, numbers, and . _ : - only."),
  inputSchema: jsonObjectText("Input schema"),
  outputSchema: jsonObjectText("Output schema"),
  defaultInput: jsonObjectText("Default input"),
  preRunSteps: jsonArrayText("Pre-run steps"),
  publicationPolicy: jsonObjectText("Publication policy"),
} as const;

// --- Payload construction (parses JSON text into the server input shape) ---

export function buildRoutinePayload(
  values: RoutineFormValues,
  mode: RoutineFormMode,
): RoutineCreateInput {
  const inputSchema = parseJsonObject(values.inputSchema, "input schema") ?? {};
  const defaultInput = parseJsonObject(values.defaultInput, "default input");
  const outputSchema = parseJsonObject(values.outputSchema, "output schema");
  const preRunSteps = parseJsonArray(values.preRunSteps, "pre-run steps");
  const publicationPolicy = parseJsonObject(values.publicationPolicy, "publication policy") ?? {
    mode: "artifact_only",
  };

  const requiredSkills = values.requiredSkills
    .split(/[\n,]/)
    .map((skill) => skill.trim())
    .filter((skill) => skill !== "");

  const payload: RoutineCreateInput = {
    name: values.name.trim(),
    description: values.description.trim(),
    prompt: values.prompt.trim(),
    status: values.status,
    toolProfile: values.toolProfile,
    outputMode: values.outputMode,
    inputSchema,
    defaultInput,
    outputSchema,
    requiredSkills,
    preRunSteps: preRunSteps as RoutineCreateInput["preRunSteps"],
    publicationPolicy,
  };

  const id = values.id.trim();
  if (mode === "create" && id !== "") {
    payload.id = id;
  }
  return payload;
}

function parseJsonObject(raw: string, fieldLabel: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause: unknown) {
    throw new Error(`${fieldLabel} is not valid JSON: ${messageOf(cause)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseJsonArray(raw: string, fieldLabel: string): unknown[] {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause: unknown) {
    throw new Error(`${fieldLabel} is not valid JSON: ${messageOf(cause)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} must be a JSON array.`);
  }
  return parsed;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
