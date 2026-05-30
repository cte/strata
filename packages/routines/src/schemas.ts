import type { JsonObject, JsonValue } from "@strata/core";

export interface RoutineInputValidationResult {
  ok: boolean;
  errors: string[];
}

export function mergeRoutineInput(
  defaultInput: JsonObject | null,
  input: JsonObject | undefined,
): JsonObject {
  return {
    ...(defaultInput ?? {}),
    ...(input ?? {}),
  };
}

export function validateRoutineInput(
  input: JsonObject,
  schema: JsonObject,
): RoutineInputValidationResult {
  const errors = validateJsonValue(input, schema, "input");
  return { ok: errors.length === 0, errors };
}

export function validateRoutineOutput(
  output: JsonObject,
  schema: JsonObject,
): RoutineInputValidationResult {
  const errors = validateJsonValue(output, schema, "output");
  return { ok: errors.length === 0, errors };
}

function validateJsonValue(value: JsonValue, schema: JsonObject, path: string): string[] {
  const errors: string[] = [];
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => jsonEquals(candidate, value))) {
    errors.push(`${path} must be one of ${enumValues.map(formatJson).join(", ")}`);
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  if (type !== undefined && !matchesType(value, type)) {
    errors.push(`${path} must be ${type}`);
    return errors;
  }

  if (type === "object" || isPlainObject(value)) {
    const objectValue = isPlainObject(value) ? value : {};
    const required = stringArray(schema.required);
    for (const field of required) {
      if (objectValue[field] === undefined) {
        errors.push(`${path}.${field} is required`);
      }
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (objectValue[key] === undefined) {
        continue;
      }
      if (!isPlainObject(childSchema)) {
        continue;
      }
      errors.push(
        ...validateJsonValue(objectValue[key] as JsonValue, childSchema, `${path}.${key}`),
      );
    }
  }

  if (
    (type === "array" || Array.isArray(value)) &&
    Array.isArray(value) &&
    isPlainObject(schema.items)
  ) {
    value.forEach((item, index) => {
      errors.push(...validateJsonValue(item, schema.items as JsonObject, `${path}[${index}]`));
    });
  }

  return errors;
}

function matchesType(value: JsonValue, type: string): boolean {
  if (type === "object") {
    return isPlainObject(value);
  }
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "number" || type === "integer") {
    return (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (type !== "integer" || Number.isInteger(value))
    );
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "null") {
    return value === null;
  }
  return true;
}

function stringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEquals(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatJson(value: JsonValue): string {
  return JSON.stringify(value);
}
