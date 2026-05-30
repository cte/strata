import { z } from "zod";

/** Shared zod field builders for TanStack Form validators (Standard Schema). */

export function requiredText(label: string) {
  return z.string().trim().min(1, `${label} is required.`);
}

export function urlText(label: string) {
  return z.string().trim().min(1, `${label} is required.`).refine(isUrl, "Enter a valid URL.");
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function jsonObjectText(label: string) {
  return z
    .string()
    .refine((value) => isJsonText(value, "object"), `${label} must be a JSON object.`);
}

export function jsonArrayText(label: string) {
  return z.string().refine((value) => isJsonText(value, "array"), `${label} must be a JSON array.`);
}

function isJsonText(value: string, kind: "object" | "array"): boolean {
  const trimmed = value.trim();
  if (trimmed === "") {
    return true;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (kind === "array") {
    return Array.isArray(parsed);
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
}
