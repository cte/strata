import { randomUUID } from "node:crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function createSessionId(): string {
  return `sess_${randomUUID()}`;
}

export function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 0);
}
