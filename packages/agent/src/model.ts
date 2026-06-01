import type { ModelAdapter } from "./types.js";

export interface ModelAdapterErrorDetails {
  retryAfterMs?: number;
}

export class ModelAdapterError extends Error {
  readonly code: string;
  readonly retryAfterMs?: number;

  constructor(code: string, message: string, details?: ModelAdapterErrorDetails) {
    super(message);
    this.name = "ModelAdapterError";
    this.code = code;
    if (details?.retryAfterMs !== undefined) {
      this.retryAfterMs = details.retryAfterMs;
    }
  }
}

export type { ModelAdapter };
