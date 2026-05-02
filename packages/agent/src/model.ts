import type { ModelAdapter } from "./types.js";

export class ModelAdapterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelAdapterError";
    this.code = code;
  }
}

export type { ModelAdapter };
