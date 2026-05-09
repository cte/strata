import type { JsonValue } from "@strata/core";
import { PolicyViolationError } from "./policy.js";

export function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new PolicyViolationError("invalid_args", `${name} must be a string`);
  }
  return value;
}

export function requiredNonEmptyString(value: JsonValue | undefined, name: string): string {
  const stringValue = requiredString(value, name).trim();
  if (stringValue === "") {
    throw new PolicyViolationError("invalid_args", `${name} cannot be empty`);
  }
  return stringValue;
}

export function optionalString(
  value: JsonValue | undefined,
  fallback: string,
  name: string,
): string {
  if (value === undefined) {
    return fallback;
  }
  return requiredString(value, name);
}

export function optionalNullableString(
  value: JsonValue | undefined,
  fallback: string | null,
  name: string,
): string | null {
  if (value === undefined) {
    return fallback;
  }
  if (value === null) {
    return null;
  }
  return requiredString(value, name);
}

export function optionalBoolean(
  value: JsonValue | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    throw new PolicyViolationError("invalid_args", `${name} must be a boolean`);
  }
  return value;
}

export function optionalInteger(
  value: JsonValue | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PolicyViolationError("invalid_args", `${name} must be an integer ${min}-${max}`);
  }
  return value;
}

export function requiredStringArray(value: JsonValue | undefined, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PolicyViolationError("invalid_args", `${name} must be an array of strings`);
  }
  return value as string[];
}

export function optionalStringArray(
  value: JsonValue | undefined,
  fallback: string[],
  name: string,
): string[] {
  if (value === undefined) {
    return fallback;
  }
  return requiredStringArray(value, name);
}

export function requiredEnum<TValue extends string>(
  value: JsonValue | undefined,
  allowed: readonly TValue[],
  name: string,
): TValue {
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    throw new PolicyViolationError("invalid_args", `${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as TValue;
}

export function optionalEnum<TValue extends string>(
  value: JsonValue | undefined,
  fallback: TValue,
  allowed: readonly TValue[],
  name: string,
): TValue {
  if (value === undefined) {
    return fallback;
  }
  return requiredEnum(value, allowed, name);
}
